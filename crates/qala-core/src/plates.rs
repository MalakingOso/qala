//! Plate calculator (docs/rust-core.md R2), ported from `packages/core/plates.ts` and
//! `packages/core/rounding.ts`, which the web app still uses; the frozen vectors in `testdata/golden/plates` pin the port.
//!
//! The per-side picker is a bounded knapsack in 0.25 units minimising, in order:
//! `|achieved - t|`, plate count, then heavier plates. Greedy is wrong once pair
//! counts are limited. All rounding goes through `js::js_round`: JS `Math.round`
//! rounds halves toward +infinity, Rust's `f64::round` away from zero.

use qala_lspp::js::js_number_to_string;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::js::{js_max, js_round};

/// Plate-math granularity (`PLATE_MATH_GRANULARITY` in `packages/core/units.ts`).
pub const GRAN: f64 = 0.25;

/// How many pairs of a plate the inventory holds: a count, or `"enough"`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Pairs {
    Count(f64),
    Enough,
}

impl Serialize for Pairs {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Pairs::Count(n) => serializer.serialize_f64(*n),
            Pairs::Enough => serializer.serialize_str("enough"),
        }
    }
}

impl<'de> Deserialize<'de> for Pairs {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let v = serde_json::Value::deserialize(deserializer)?;
        match &v {
            serde_json::Value::Number(n) => n
                .as_f64()
                .map(Pairs::Count)
                .ok_or_else(|| serde::de::Error::custom("pairs count out of range")),
            serde_json::Value::String(s) if s == "enough" => Ok(Pairs::Enough),
            other => Err(serde::de::Error::custom(format!(
                "pairs must be a count or \"enough\", got {other}"
            ))),
        }
    }
}

/// One inventory row: a plate weight and how many pairs are available.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlateEntry {
    pub weight: f64,
    pub pairs: Pairs,
    #[serde(default)]
    pub color: String,
}

/// Plates on one side, heaviest innermost (descending).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlateLoad {
    pub per_side: Vec<f64>,
    pub per_side_total: f64,
    /// Bar + collars + both sides.
    pub total: f64,
    pub bar_weight: f64,
    pub collar_weight: f64,
}

/// The plan for a requested total: the exact load when there is one, and the
/// nearest loadable totals strictly below and above.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatePlan {
    pub requested_total: f64,
    pub bar_weight: f64,
    pub collar_weight: f64,
    pub per_side_target: f64,
    pub exact: Option<PlateLoad>,
    pub below: Option<PlateLoad>,
    pub above: Option<PlateLoad>,
}

/// A between-set move to the next load.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NextPlateChoice {
    pub load: PlateLoad,
    /// E.g. "add 10 + 2.5 each side", "take off 5, add 25", "no change".
    pub instruction: String,
    /// Length of the kept inner (heaviest-first) run.
    pub kept_inner: usize,
    /// Plates added plus plates removed, per side.
    pub plates_moved: usize,
}

/// `toUnits` as the double TS computes it: `Math.round(w / GRAN)`. It is a whole number for
/// every finite input, but can be astronomically large or infinite for a huge target.
fn to_units_f(w: f64) -> f64 {
    js_round(w / GRAN)
}

/// [`to_units_f`] as an integer, for plate sizes and sums (saturating; plate weights stay far
/// below 2^53 units, about 2e15 lb).
fn to_units(w: f64) -> i64 {
    to_units_f(w) as i64
}

pub fn from_units(u: i64) -> f64 {
    u as f64 * GRAN
}

/// `String(Math.round(n * 100) / 100)`, JS number formatting included (`Infinity`, exponents
/// from 1e21).
fn fmt(n: f64) -> String {
    js_number_to_string(js_round(n * 100.0) / 100.0)
}

/// `Math.max(...plates with weight > 0 as units, toUnits(0.25))`, a double like in TS.
fn max_plate_units(plates: &[PlateEntry]) -> f64 {
    plates
        .iter()
        .filter(|p| p.weight > 0.0)
        .map(|p| to_units_f(p.weight))
        .fold(to_units_f(0.25), js_max)
}

fn desc(xs: &[f64]) -> Vec<f64> {
    let mut out = xs.to_vec();
    out.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    out
}

/// Heavier-first comparison of two descending combos. >0 means `a` is heavier.
fn compare_heavier(a: &[f64], b: &[f64]) -> f64 {
    let n = a.len().max(b.len());
    for i in 0..n {
        let x = a.get(i).copied().unwrap_or(f64::NEG_INFINITY);
        let y = b.get(i).copied().unwrap_or(f64::NEG_INFINITY);
        if x != y {
            return x - y;
        }
    }
    0.0
}

struct PlateType {
    weight: f64,
    units: i64,
    limit: i64,
}

/// `plateTypes`: the usable plate rows, heaviest first, with their size in units and how many
/// copies one side may hold. `max_units` is the DP cap, which sets the copy count of an
/// `"enough"` row (`ceil(cap / units)`).
fn plate_types(plates: &[PlateEntry], max_units: f64) -> Vec<PlateType> {
    let mut types: Vec<PlateType> = plates
        .iter()
        .filter(|p| p.weight > 0.0)
        .filter_map(|p| {
            let units = to_units_f(p.weight);
            if !(units > 0.0) {
                return None;
            }
            let limit = match p.pairs {
                Pairs::Enough => js_max(0.0, (max_units / units).ceil()),
                Pairs::Count(n) => js_max(0.0, n.floor()),
            };
            // `NaN > 0` is false, so a NaN count drops the row, as in TS.
            if !(limit > 0.0) {
                return None;
            }
            Some(PlateType {
                weight: p.weight,
                units: units as i64,
                limit: limit as i64,
            })
        })
        .collect();
    types.sort_by(|a, b| {
        b.weight
            .partial_cmp(&a.weight)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    types
}

#[derive(Clone)]
struct DpEntry {
    count: usize,
    combo: Vec<f64>,
}

fn better_combo(count_a: usize, a: &[f64], count_b: usize, b: &[f64]) -> bool {
    if count_a != count_b {
        return count_a < count_b;
    }
    compare_heavier(a, b) > 0.0
}

/// Best (fewest plates, then heavier) combo for every achievable sum.
fn build_dp(types: &[PlateType], cap_units: f64) -> std::collections::BTreeMap<i64, DpEntry> {
    let mut dp: std::collections::BTreeMap<i64, DpEntry> = [(
        0,
        DpEntry {
            count: 0,
            combo: Vec::new(),
        },
    )]
    .into_iter()
    .collect();
    for t in types {
        for _copy in 0..t.limit {
            let snapshot: Vec<(i64, DpEntry)> = dp.iter().map(|(s, e)| (*s, e.clone())).collect();
            for (s, e) in &snapshot {
                let ns = s.saturating_add(t.units);
                if ns as f64 > cap_units {
                    continue;
                }
                let nc = e.count + 1;
                let mut raw = e.combo.clone();
                raw.push(t.weight);
                let combo = desc(&raw);
                let replace = match dp.get(&ns) {
                    None => true,
                    Some(prev) => better_combo(nc, &combo, prev.count, &prev.combo),
                };
                if replace {
                    dp.insert(ns, DpEntry { count: nc, combo });
                }
            }
        }
    }
    dp
}

fn make_load(per_side: &[f64], bar_weight: f64, collar_weight: f64) -> PlateLoad {
    let side = desc(per_side);
    let side_sum: f64 = side.iter().sum();
    let per_side_total = js_round(side_sum * 100.0) / 100.0;
    let total = js_round((bar_weight + 2.0 * collar_weight + 2.0 * per_side_total) * 100.0) / 100.0;
    PlateLoad {
        per_side: side,
        per_side_total,
        total,
        bar_weight,
        collar_weight,
    }
}

/// The achievable sum minimising `key`, then plate count, then heavier plates.
/// `key` is a distance in units, so smaller is nearer. Both are doubles, as in TS: for a
/// target beyond 2^53 units (or infinite) distinct sums can share a key, and a NaN difference
/// never replaces the current best.
fn rank_sums(
    dp: &std::collections::BTreeMap<i64, DpEntry>,
    keep: impl Fn(f64) -> bool,
    key: impl Fn(f64) -> f64,
) -> Option<i64> {
    let mut best: Option<i64> = None;
    for (s, e) in dp {
        if !keep(*s as f64) {
            continue;
        }
        let Some(b) = best else {
            best = Some(*s);
            continue;
        };
        let prev = &dp[&b];
        let dk = key(*s as f64) - key(b as f64);
        let take = if dk != 0.0 {
            dk < 0.0
        } else if e.count != prev.count {
            e.count < prev.count
        } else {
            compare_heavier(&e.combo, &prev.combo) > 0.0
        };
        if take {
            best = Some(*s);
        }
    }
    best
}

/// Plan plates for a requested total. Per-side target
/// `t = (W - bar - 2 * collar) / 2`.
pub fn plan_plates(
    requested_total: f64,
    bar_weight: f64,
    plates: &[PlateEntry],
    collar_weight: f64,
) -> PlatePlan {
    let per_side_target = (requested_total - bar_weight - 2.0 * collar_weight) / 2.0;
    let mut base = PlatePlan {
        requested_total,
        bar_weight,
        collar_weight,
        per_side_target: js_round(per_side_target * 100.0) / 100.0,
        exact: None,
        below: None,
        above: None,
    };
    if !(per_side_target > 0.0) {
        // At or below bar (+ collars): the bar alone is the only sensible load.
        let bar = make_load(&[], bar_weight, collar_weight);
        if (requested_total - bar.total).abs() < 1e-9 {
            base.exact = Some(bar);
        } else if requested_total < bar.total {
            base.above = Some(bar);
        } else {
            base.below = Some(bar);
        }
        return base;
    }
    let target_units = to_units_f(per_side_target);
    let cap_units = target_units + max_plate_units(plates);
    let types = plate_types(plates, cap_units);
    if types.is_empty() {
        return base;
    }
    let dp = build_dp(&types, cap_units);
    // Every sum is a small whole number, so the target can only be one of them when it is
    // small enough to be an exact `i64`.
    if target_units.abs() < 9.0e18 {
        if let Some(e) = dp.get(&(target_units as i64)) {
            base.exact = Some(make_load(&e.combo.clone(), bar_weight, collar_weight));
        }
    }
    // rank over `<` / `>` excludes exact; neighbours surface even when exact exists.
    if let Some(u) = rank_sums(&dp, |s| s < target_units, |s| target_units - s) {
        base.below = Some(make_load(&dp[&u].combo.clone(), bar_weight, collar_weight));
    }
    if let Some(u) = rank_sums(&dp, |s| s > target_units, |s| s - target_units) {
        base.above = Some(make_load(&dp[&u].combo.clone(), bar_weight, collar_weight));
    }
    base
}

/// Nearest loadable total: exact, else nearer of below/above (ties to below).
pub fn nearest_loadable(plan: &PlatePlan) -> Option<PlateLoad> {
    if let Some(exact) = &plan.exact {
        return Some(exact.clone());
    }
    match (&plan.below, &plan.above) {
        (Some(below), Some(above)) => {
            let d_below = (below.total - plan.requested_total).abs();
            let d_above = (above.total - plan.requested_total).abs();
            Some(if d_above < d_below {
                above.clone()
            } else {
                below.clone()
            })
        }
        (Some(below), None) => Some(below.clone()),
        (None, Some(above)) => Some(above.clone()),
        (None, None) => None,
    }
}

fn shared_prefix_len(a: &[f64], b: &[f64]) -> usize {
    let mut n = 0;
    while n < a.len() && n < b.len() && (a[n] - b[n]).abs() < 1e-9 {
        n += 1;
    }
    n
}

/// All multisets of limited plates summing to `sum_units` (heaviest-first).
fn enumerate_combos(types: &[PlateType], sum_units: i64) -> Vec<Vec<f64>> {
    fn rec(
        types: &[PlateType],
        i: usize,
        rest: i64,
        combo: &mut Vec<f64>,
        out: &mut Vec<Vec<f64>>,
    ) {
        if out.len() >= 5000 {
            return;
        }
        if rest == 0 {
            out.push(desc(combo));
            return;
        }
        if i >= types.len() {
            return;
        }
        let t = &types[i];
        let max = t.limit.min(rest / t.units);
        for k in (0..=max).rev() {
            for _ in 0..k {
                combo.push(t.weight);
            }
            rec(types, i + 1, rest - k * t.units, combo, out);
            for _ in 0..k {
                combo.pop();
            }
            if out.len() >= 5000 {
                return;
            }
        }
    }
    let mut out = Vec::new();
    rec(types, 0, sum_units, &mut Vec::new(), &mut out);
    out
}

pub fn describe_change(current_per_side: &[f64], next_per_side: &[f64]) -> String {
    let cur = desc(current_per_side);
    let next = desc(next_per_side);
    let kept = shared_prefix_len(&cur, &next);
    let removed = &cur[kept..];
    let added = &next[kept..];
    if removed.is_empty() && added.is_empty() {
        return "no change".to_string();
    }
    let mut parts: Vec<String> = Vec::new();
    if !removed.is_empty() {
        parts.push(format!(
            "take off {}",
            removed
                .iter()
                .map(|w| fmt(*w))
                .collect::<Vec<_>>()
                .join(" + ")
        ));
    }
    if !added.is_empty() {
        parts.push(format!(
            "add {}",
            added
                .iter()
                .map(|w| fmt(*w))
                .collect::<Vec<_>>()
                .join(" + ")
        ));
    }
    format!("{} each side", parts.join(", "))
}

/// Between-set chooser. Candidates are ranked by fewest plates, then longest
/// shared run of inner plates, then fewest plates moved, then heavier plates.
///
/// Fewest-plates outranks keep-inner because PLAN 6.8's own ramp demands it:
/// 100 -> 125 goes 25+2.5 -> 35+5 (a full swap, 2 plates) rather than
/// 25+10+5 (keeps the 25, but 3 plates).
pub fn choose_next_plates(
    current_per_side: &[f64],
    next_total: f64,
    bar_weight: f64,
    plates: &[PlateEntry],
    collar_weight: f64,
) -> Option<NextPlateChoice> {
    let plan = plan_plates(next_total, bar_weight, plates, collar_weight);
    let target = nearest_loadable(&plan)?;
    let side_sum: f64 = target.per_side.iter().sum();
    let target_units = to_units(side_sum);
    let types = plate_types(plates, target_units as f64 + max_plate_units(plates));
    let combos = enumerate_combos(&types, target_units);
    let cur = desc(current_per_side);
    let mut best: Option<Vec<f64>> = None;
    for combo in &combos {
        let take = match &best {
            None => true,
            Some(b) => {
                let kept_c = shared_prefix_len(&cur, combo);
                let kept_b = shared_prefix_len(&cur, b);
                let moved_c = (cur.len() - kept_c) + (combo.len() - kept_c);
                let moved_b = (cur.len() - kept_b) + (b.len() - kept_b);
                combo.len() < b.len()
                    || (combo.len() == b.len()
                        && (kept_c > kept_b
                            || (kept_c == kept_b
                                && (moved_c < moved_b
                                    || (moved_c == moved_b && compare_heavier(combo, b) > 0.0)))))
            }
        };
        if take {
            best = Some(combo.clone());
        }
    }
    let per_side = best.unwrap_or_else(|| target.per_side.clone());
    let load = make_load(&per_side, bar_weight, collar_weight);
    let kept = shared_prefix_len(&cur, &per_side);
    Some(NextPlateChoice {
        instruction: describe_change(&cur, &per_side),
        kept_inner: kept,
        plates_moved: (cur.len() - kept) + (per_side.len() - kept),
        load,
    })
}

/// One-line logging-screen shorthand: "per side 45 · 45 · 10", or "bar".
pub fn plates_shorthand(per_side: &[f64]) -> String {
    let side = desc(per_side);
    if side.is_empty() {
        "bar".to_string()
    } else {
        format!(
            "per side {}",
            side.iter()
                .map(|w| fmt(*w))
                .collect::<Vec<_>>()
                .join(" \u{b7} ")
        )
    }
}

/// Smallest barbell step: twice the smallest available plate pair (PLAN 6.8).
pub fn default_barbell_step(plates: &[PlateEntry], fallback: Option<f64>) -> f64 {
    let mut smallest: Option<f64> = None;
    for p in plates {
        if p.weight <= 0.0 {
            continue;
        }
        let available = match p.pairs {
            Pairs::Enough => true,
            Pairs::Count(n) => n >= 1.0,
        };
        if available && smallest.map_or(true, |s| p.weight < s) {
            smallest = Some(p.weight);
        }
    }
    match smallest {
        None => fallback.unwrap_or(5.0),
        Some(s) => js_round(2.0 * s * 100.0) / 100.0,
    }
}

/// Round a bare target total (in the inventory unit) to a loadable total
/// (`roundWeight` in `packages/core/rounding.ts`).
pub fn round_weight(
    target_weight: f64,
    bar_weight: f64,
    plates: &[PlateEntry],
    collar_weight: f64,
) -> f64 {
    let plan = plan_plates(target_weight, bar_weight, plates, collar_weight);
    match nearest_loadable(&plan) {
        None => js_round((bar_weight + 2.0 * collar_weight) * 100.0) / 100.0,
        Some(load) => load.total,
    }
}

/// Round to an arbitrary step (e.g. dumbbell steps), halves up.
/// Panics when `step` is not positive, mirroring the TS `RangeError`.
pub fn round_to_step(value: f64, step: f64) -> f64 {
    assert!(step > 0.0, "step must be positive");
    js_round(value / step) * step
}

/// True when the total can be loaded exactly with the inventory.
pub fn is_loadable(total: f64, bar_weight: f64, plates: &[PlateEntry], collar_weight: f64) -> bool {
    plan_plates(total, bar_weight, plates, collar_weight)
        .exact
        .is_some()
}
