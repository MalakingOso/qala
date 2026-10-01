//! Port of `models/set.ts` (the `Reps_*` helpers).
//!
//! Set ids come from a caller supplied `UidSource`; nothing here reads a
//! clock or RNG. `Reps_findNextEntryAndSet*` need `Progress_getNextEntry`
//! (ported with the progress module), so they take it as a closure that
//! returns the index of the next entry in `record.entries`.
//!
//! JS strings built from possibly-undefined numbers (`${set.reps}`) print
//! "undefined"; `js_opt_num` reproduces that.

use serde::{Deserialize, Serialize};

use crate::js::{js_max_all, js_number_to_string, js_round};
use crate::types::{IHistoryEntry, IHistoryRecord, IProgressMode, ISet, IUnit, IWeight, ScriptValue, SetVtype};
use crate::util::collection::{group_by, in_groups_of};
use crate::util::generator::UidSource;
use crate::weight::{add, build, convert_to, display, eq_null, gte, multiply, print, print_null};

pub type IProgramReps = f64;

/// `ISetsStatus`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ISetsStatus {
    #[serde(rename = "success")]
    Success,
    #[serde(rename = "in-range")]
    InRange,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "not-finished")]
    NotFinished,
}

/// `IDisplaySet`
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IDisplaySet {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dim_reps: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dim_rpe: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dim_weight: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dim_timer: Option<bool>,
    pub reps: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rpe: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ask_weight: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_completed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_rpe_failed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_in_range: Option<bool>,
    #[serde(default, with = "crate::js::num_opt", skip_serializing_if = "Option::is_none")]
    pub timer: Option<f64>,
    #[serde(default, with = "crate::js::num_opt", skip_serializing_if = "Option::is_none")]
    pub set_timer: Option<f64>,
    #[serde(default, with = "crate::js::num_opt", skip_serializing_if = "Option::is_none")]
    pub set_timer_left: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_overflow_set_timer: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto: Option<bool>,
}

/// `${x}` for an optional number: "undefined" when absent.
fn js_opt_num(x: Option<f64>) -> String {
    match x {
        Some(n) => js_number_to_string(n),
        None => "undefined".to_string(),
    }
}

/// `${x}` for an optional bool.
fn js_opt_bool(x: Option<bool>) -> &'static str {
    match x {
        Some(true) => "true",
        Some(false) => "false",
        None => "undefined",
    }
}

fn truthy(x: Option<f64>) -> Option<f64> {
    x.filter(|n| *n != 0.0 && !n.is_nan())
}

/// `Reps_display`: "3x5" when all sets match, else "5/5/3/3/3".
pub fn display_sets(sets: &[ISet], is_next: bool) -> String {
    if are_same_reps(sets, is_next) {
        let first = &sets[0];
        let v = truthy(first.completed_reps).or(first.reps);
        format!("{}x{}", sets.len(), js_opt_num(v))
    } else {
        let arr: Vec<String> = sets
            .iter()
            .map(|s| if is_next { display_reps(s) } else { display_completed_reps(s) })
            .collect();
        in_groups_of(5, &arr).iter().map(|g| g.join("/")).collect::<Vec<_>>().join("/ ")
    }
}

fn is_same_display_set(a: &IDisplaySet, b: &IDisplaySet) -> bool {
    a.reps == b.reps
        && a.weight == b.weight
        && a.rpe == b.rpe
        && a.ask_weight == b.ask_weight
        && a.timer == b.timer
        && a.set_timer == b.set_timer
        && a.set_timer_left == b.set_timer_left
        && a.is_overflow_set_timer == b.is_overflow_set_timer
        && a.auto == b.auto
}

/// `Reps_groupDisplaySets`: groups consecutive display sets that look the same.
pub fn group_display_sets(display_sets: &[IDisplaySet]) -> Vec<Vec<IDisplaySet>> {
    group_by(display_sets, |last, set| !is_same_display_set(last, set))
}

/// `Reps_setToDisplaySet`
pub fn set_to_display_set(set: &ISet, is_next: bool, units: IUnit) -> IDisplaySet {
    let completed_or_required = set.completed_weight.or(set.weight);
    let weight = if is_next {
        match (set.weight, set.original_weight) {
            (Some(w), Some(_)) => Some(display(w, false)),
            _ => None,
        }
    } else {
        completed_or_required.map(|w| display(w, false))
    };
    IDisplaySet {
        reps: if is_next { display_reps(set) } else { display_completed_reps(set) },
        rpe: set.completed_rpe.or(set.rpe).map(js_number_to_string),
        weight,
        unit: Some(completed_or_required.map(|w| w.unit).unwrap_or(units).as_str().to_string()),
        ask_weight: set.ask_weight,
        is_completed: Some(is_completed_set(set)),
        is_rpe_failed: Some(set.completed_rpe.is_some_and(|c| c > set.rpe.unwrap_or(0.0))),
        is_in_range: set.min_reps.map(|m| set.completed_reps.is_some_and(|c| c >= m)),
        set_timer: if is_next { set.set_timer } else { set.completed_set_timer },
        set_timer_left: if is_next { None } else { set.completed_set_timer_left },
        is_overflow_set_timer: if is_next { set.is_overflow_set_timer } else { None },
        timer: if is_next { set.timer } else { None },
        auto: set.auto,
        ..Default::default()
    }
}

/// `Reps_addSet`: appends a copy of the last set (or of `last_set` when
/// `sets` is empty) with a fresh id and the next index.
pub fn add_set(
    sets: &[ISet],
    is_unilateral: bool,
    last_set: Option<&ISet>,
    is_warmup: bool,
    uid: &mut dyn UidSource,
) -> Vec<ISet> {
    let base: ISet = match sets.last().or(last_set) {
        None => new_set(is_unilateral, 0, uid),
        Some(last) => {
            let mut s = last.clone();
            if is_warmup {
                s.reps = last.completed_reps.or(last.reps);
                s.weight = last.completed_weight.or(last.weight);
            } else {
                s.reps = last.reps.or(last.completed_reps);
                s.weight = last.weight.or(last.completed_weight);
                s.original_weight = last
                    .original_weight
                    .or(last.weight.map(Into::into))
                    .or(last.completed_weight.map(Into::into));
                s.completed_reps = None;
                s.completed_reps_left = None;
                s.completed_weight = None;
                s.completed_rpe = None;
                s.completed_set_timer = None;
                s.completed_set_timer_left = None;
            }
            s
        }
    };
    let max_index = sets.iter().map(|s| s.index).max().unwrap_or(-1).max(-1);
    let mut next = base;
    next.id = uid.generate_uid(6);
    next.is_completed = Some(false);
    next.index = max_index + 1;
    let mut out = sets.to_vec();
    out.push(next);
    out
}

/// `Reps_isSameSet`
pub fn is_same_set(set1: &ISet, set2: &ISet) -> bool {
    eq_null(set1.weight.map(ScriptValue::from), set2.weight.map(ScriptValue::from))
        && set1.completed_reps == set2.completed_reps
        && set1.rpe == set2.rpe
}

/// `Reps_displayReps`: "5", "3-5", "5+".
pub fn display_reps(set: &ISet) -> String {
    let reps = match set.min_reps {
        Some(min) => format!("{}-{}", js_number_to_string(min), js_number_to_string(set.reps.unwrap_or(0.0))),
        None => js_number_to_string(set.reps.unwrap_or(0.0)),
    };
    if set.is_amrap == Some(true) {
        format!("{}+", reps)
    } else {
        reps
    }
}

/// `Reps_displayCompletedReps`: "5", "4/5" for unilateral, "-" when not done.
pub fn display_completed_reps(set: &ISet) -> String {
    match set.completed_reps {
        Some(c) => match set.completed_reps_left {
            Some(l) => format!("{}/{}", js_number_to_string(l), js_number_to_string(c)),
            None => js_number_to_string(c),
        },
        None => "-".to_string(),
    }
}

/// `Reps_areSameReps`. As in TS, completed reps are compared to the first
/// set's target `reps` when `is_next` is false.
pub fn are_same_reps(sets: &[ISet], is_next: bool) -> bool {
    let first_rep = sets.first().and_then(|s| s.reps);
    if sets.is_empty() {
        return false;
    }
    sets.iter().all(|s| {
        let v = if is_next { s.reps } else { s.completed_reps };
        v.is_some() && v == first_rep
    })
}

/// `Reps_isEmpty`: no set is completed.
pub fn is_empty(sets: &[ISet]) -> bool {
    sets.iter().all(|s| s.is_completed != Some(true))
}

/// `Reps_newSet`
pub fn new_set(is_unilateral: bool, index: i64, uid: &mut dyn UidSource) -> ISet {
    ISet {
        vtype: SetVtype,
        index,
        id: uid.generate_uid(6),
        original_weight: None,
        weight: None,
        is_unilateral: Some(is_unilateral),
        reps: None,
        is_amrap: Some(false),
        ask_weight: Some(false),
        is_completed: Some(false),
        ..Default::default()
    }
}

/// `Reps_isCompleted`
pub fn is_completed(sets: &[ISet]) -> bool {
    !sets.is_empty() && sets.iter().all(is_completed_set)
}

/// `Reps_setWarmupStatus`
pub fn set_warmup_status(sets: &[ISet]) -> ISetsStatus {
    if sets.is_empty() {
        return ISetsStatus::NotFinished;
    }
    if is_finished(sets) {
        ISetsStatus::Success
    } else {
        ISetsStatus::NotFinished
    }
}

/// `Reps_setsStatus`
pub fn sets_status(sets: &[ISet]) -> ISetsStatus {
    if is_completed(sets) {
        ISetsStatus::Success
    } else if is_in_range_completed(sets) {
        ISetsStatus::InRange
    } else if !is_finished(sets) {
        ISetsStatus::NotFinished
    } else {
        ISetsStatus::Failed
    }
}

/// `Reps_isCompletedSet`: finished, and reps and weight reach the targets.
pub fn is_completed_set(set: &ISet) -> bool {
    match (set.completed_reps, set.completed_weight) {
        (Some(cr), Some(cw)) => {
            set.is_completed == Some(true)
                && set.reps.is_none_or(|r| cr >= r)
                && set.weight.is_none_or(|w| gte(cw, w))
        }
        _ => false,
    }
}

/// `Reps_isInRangeCompletedSet`: like `is_completed_set` but against `minReps` when present.
pub fn is_in_range_completed_set(set: &ISet) -> bool {
    match (set.completed_reps, set.completed_weight) {
        (Some(cr), Some(cw)) => {
            set.weight.is_none_or(|w| gte(cw, w))
                && match set.min_reps {
                    Some(min) => cr >= min,
                    None => set.reps.is_none_or(|r| cr >= r),
                }
        }
        _ => false,
    }
}

/// `Reps_isStarted`
pub fn is_started(sets: &[ISet]) -> bool {
    !sets.is_empty() && sets.iter().any(is_finished_set)
}

/// `Reps_isFinished`
pub fn is_finished(sets: &[ISet]) -> bool {
    !sets.is_empty() && sets.iter().all(is_finished_set)
}

/// `Reps_isEmptyOrFinished`
pub fn is_empty_or_finished(sets: &[ISet]) -> bool {
    sets.is_empty() || is_finished(sets)
}

/// `Reps_isFinishedSet`
pub fn is_finished_set(s: &ISet) -> bool {
    s.is_completed == Some(true)
}

/// `Reps_toKey`: a string that changes whenever a displayed field changes.
pub fn to_key(set: &ISet) -> String {
    format!(
        "{}-{}-{}-{}-{}-{}-{}-{}-{}-{}-{}-{}-{}",
        print_null(set.weight.map(Into::into)),
        print_null(set.completed_weight.map(Into::into)),
        js_opt_num(set.reps),
        js_opt_num(set.min_reps),
        js_opt_bool(set.is_amrap),
        js_opt_num(set.rpe),
        js_opt_bool(set.ask_weight),
        js_opt_num(set.completed_reps),
        js_opt_num(set.completed_reps_left),
        js_opt_num(set.completed_rpe),
        js_opt_bool(set.is_completed),
        js_opt_num(set.completed_set_timer),
        js_opt_num(set.completed_set_timer_left),
    )
}

/// `Reps_isInRangeCompleted`
pub fn is_in_range_completed(sets: &[ISet]) -> bool {
    sets.iter().any(|s| s.min_reps.is_some()) && sets.iter().all(is_in_range_completed_set)
}

/// `Reps_enforceCompletedSet`: a set without completed reps and weight is not completed.
pub fn enforce_completed_set(set: &ISet) -> ISet {
    let mut s = set.clone();
    s.is_completed = Some(if set.completed_reps.is_none() || set.completed_weight.is_none() {
        false
    } else {
        set.is_completed == Some(true)
    });
    s
}

/// `Reps_maxUnilateralCompletedReps`
pub fn max_unilateral_completed_reps(set: &ISet) -> Option<f64> {
    if set.is_unilateral == Some(true) {
        Some(js_max_all(&[set.completed_reps.unwrap_or(0.0), set.completed_reps_left.unwrap_or(0.0)]))
    } else {
        set.completed_reps
    }
}

/// `Reps_avgUnilateralCompletedReps`
pub fn avg_unilateral_completed_reps(set: &ISet) -> Option<f64> {
    if set.is_unilateral == Some(true) {
        Some(js_round((set.completed_reps.unwrap_or(0.0) + set.completed_reps_left.unwrap_or(0.0)) / 2.0))
    } else {
        set.completed_reps
    }
}

/// `Reps_setVolume`: weight times total completed reps (both sides when unilateral).
pub fn set_volume(set: &ISet, unit: IUnit) -> IWeight {
    let total_reps = if set.is_unilateral == Some(true) || set.completed_reps_left.is_some() {
        set.completed_reps.unwrap_or(0.0) + set.completed_reps_left.unwrap_or(0.0)
    } else {
        set.completed_reps.unwrap_or(0.0)
    };
    multiply(set.completed_weight.or(set.weight).unwrap_or(build(0.0, unit)), total_reps)
}

fn opt_eq(a: Option<IWeight>, b: Option<IWeight>) -> bool {
    eq_null(a.map(Into::into), b.map(Into::into))
}

/// `Reps_group`: runs of consecutive sets that match on the displayed fields.
/// Like the TS, an empty input gives one empty group.
pub fn group(sets: &[ISet], is_next: Option<bool>) -> Vec<Vec<ISet>> {
    let is_next = is_next == Some(true);
    let mut memo: Vec<Vec<ISet>> = vec![vec![]];
    for set in sets {
        let differs = match memo.last().and_then(|g| g.last()) {
            None => false,
            Some(last) => {
                !opt_eq(last.weight, set.weight)
                    || last.reps != set.reps
                    || last.min_reps != set.min_reps
                    || last.completed_reps != set.completed_reps
                    || last.completed_reps_left != set.completed_reps_left
                    || !opt_eq(last.completed_weight, set.completed_weight)
                    || last.ask_weight != set.ask_weight
                    || (is_next && last.is_amrap != set.is_amrap)
                    || last.rpe != set.rpe
                    || last.completed_rpe != set.completed_rpe
                    || last.set_timer != set.set_timer
                    || (is_next && last.timer != set.timer)
                    || (is_next && last.is_overflow_set_timer != set.is_overflow_set_timer)
                    || last.auto != set.auto
                    || (!is_next && last.completed_set_timer != set.completed_set_timer)
                    || (!is_next && last.completed_set_timer_left != set.completed_set_timer_left)
            }
        };
        if differs {
            memo.push(vec![]);
        }
        if let Some(g) = memo.last_mut() {
            g.push(set.clone());
        }
    }
    memo
}

/// `Reps_findNextSet`: the first incomplete set, warmups first.
pub fn find_next_set(entry: &IHistoryEntry) -> Option<&ISet> {
    entry.warmup_sets.iter().chain(entry.sets.iter()).find(|s| s.is_completed != Some(true))
}

/// `Reps_findNextSetIndex`: position among warmups then sets, `-1` when none.
pub fn find_next_set_index(entry: &IHistoryEntry) -> i64 {
    entry
        .warmup_sets
        .iter()
        .chain(entry.sets.iter())
        .position(|s| s.is_completed != Some(true))
        .map(|i| i as i64)
        .unwrap_or(-1)
}

/// Result of `Reps_findNextEntryAndSet`.
#[derive(Debug, Clone, PartialEq)]
pub struct NextEntryAndSet<'a> {
    pub entry: &'a IHistoryEntry,
    pub set: &'a ISet,
}

/// Result of `Reps_findNextEntryAndSetIndex`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NextEntryAndSetIndex {
    pub entry_index: i64,
    pub set_index: i64,
}

/// `Reps_findNextEntryAndSet`. `get_next_entry(record, entry, mode, true)` is
/// `Progress_getNextEntry` returning the index of the next entry.
pub fn find_next_entry_and_set<'a, F>(
    history_record: &'a IHistoryRecord,
    entry_index: usize,
    mode: IProgressMode,
    get_next_entry: F,
) -> Option<NextEntryAndSet<'a>>
where
    F: Fn(&IHistoryRecord, &IHistoryEntry, IProgressMode, bool) -> Option<usize>,
{
    let entry = history_record.entries.get(entry_index)?;
    let next_index = get_next_entry(history_record, entry, mode, true)?;
    let next_entry = history_record.entries.get(next_index)?;
    let set = find_next_set(next_entry)?;
    Some(NextEntryAndSet { entry: next_entry, set })
}

/// `Reps_findNextEntryAndSetIndex`
pub fn find_next_entry_and_set_index<F>(
    history_record: &IHistoryRecord,
    entry_index: usize,
    mode: IProgressMode,
    get_next_entry: F,
) -> Option<NextEntryAndSetIndex>
where
    F: Fn(&IHistoryRecord, &IHistoryEntry, IProgressMode, bool) -> Option<usize>,
{
    let entry = history_record.entries.get(entry_index)?;
    let next_index = get_next_entry(history_record, entry, mode, true)?;
    let next_entry = history_record.entries.get(next_index)?;
    Some(NextEntryAndSetIndex {
        entry_index: next_index as i64,
        set_index: find_next_set_index(next_entry),
    })
}

/// `Reps_groupConsecutive`: collapses runs of equal keys into `(first item, run length)`.
pub fn group_consecutive<T: Clone>(items: &[T], key_fn: impl Fn(&T) -> String) -> Vec<(T, usize)> {
    let mut groups: Vec<(T, usize)> = Vec::new();
    let mut last_key: Option<String> = None;
    for item in items {
        let key = key_fn(item);
        if last_key.as_deref() != Some(key.as_str()) {
            groups.push((item.clone(), 0));
        }
        if let Some(g) = groups.last_mut() {
            g.1 += 1;
        }
        last_key = Some(key);
    }
    groups
}

/// `Reps_completedSetKey`
pub fn completed_set_key(set: &ISet) -> String {
    let reps = set.completed_reps.unwrap_or(0.0);
    let reps_left = if set.is_unilateral == Some(true) { set.completed_reps_left.unwrap_or(0.0) } else { -1.0 };
    let w = match set.completed_weight {
        Some(w) => print(w),
        None => "none".to_string(),
    };
    let rpe = set.completed_rpe.unwrap_or(-1.0);
    let label = set.label.clone().unwrap_or_default();
    format!(
        "{}-{}-{}-{}-{}",
        js_number_to_string(reps),
        js_number_to_string(reps_left),
        w,
        js_number_to_string(rpe),
        label
    )
}

/// `Reps_targetSetKey`
pub fn target_set_key(set: &ISet) -> String {
    let n = js_number_to_string;
    let w = match set.weight {
        Some(w) => print(w),
        None => "none".to_string(),
    };
    format!(
        "{}-{}-{}-{}-{}-{}-{}-{}-{}",
        n(set.reps.unwrap_or(0.0)),
        n(set.min_reps.unwrap_or(-1.0)),
        w,
        u8::from(set.ask_weight == Some(true)),
        n(set.rpe.unwrap_or(-1.0)),
        u8::from(set.log_rpe == Some(true)),
        n(set.timer.unwrap_or(-1.0)),
        u8::from(set.is_amrap == Some(true)),
        set.label.clone().unwrap_or_default(),
    )
}

/// `Reps_volume`: total volume of the sets in `unit`.
pub fn volume(sets: &[ISet], unit: IUnit) -> IWeight {
    convert_to(sets.iter().fold(build(0.0, unit), |memo, set| add(memo, set_volume(set, unit))), unit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::tests::{arg, check, parse_cases};
    use crate::util::generator::SequentialUid;
    use serde_json::Value;

    // Expected values come from the TS oracle (testdata/unit/gen_unit_cases.ts
    // over models/set.ts, results in cases_set.json). Set ids are random in TS
    // and sequential here, so ids are scrubbed before comparing.

    fn j<T: serde::Serialize>(x: T) -> Result<Value, String> {
        serde_json::to_value(x).map_err(|e| e.to_string())
    }

    fn run(f: &str, a: &[Value]) -> Option<Result<Value, String>> {
        let sets = |i: usize| arg::<Vec<ISet>>(&a[i]);
        let set = |i: usize| arg::<ISet>(&a[i]);
        let unit = |i: usize| arg::<IUnit>(&a[i]);
        let flag = |i: usize| a[i].as_bool().unwrap_or(false);
        Some(match f {
            "displaySets" => j(display_sets(&sets(0), flag(1))),
            "areSameReps" => j(are_same_reps(&sets(0), flag(1))),
            "group" => j(group(&sets(0), a[1].as_bool())),
            "isEmpty" => j(is_empty(&sets(0))),
            "isCompleted" => j(is_completed(&sets(0))),
            "setWarmupStatus" => j(set_warmup_status(&sets(0))),
            "setsStatus" => j(sets_status(&sets(0))),
            "isStarted" => j(is_started(&sets(0))),
            "isFinished" => j(is_finished(&sets(0))),
            "isEmptyOrFinished" => j(is_empty_or_finished(&sets(0))),
            "isInRangeCompleted" => j(is_in_range_completed(&sets(0))),
            "volume" => j(volume(&sets(0), unit(1))),
            "groupConsecutive" => j(group_consecutive(&sets(0), completed_set_key)),
            "groupDisplaySets" => j(group_display_sets(&arg::<Vec<IDisplaySet>>(&a[0]))),
            "setToDisplaySet" => j(set_to_display_set(&set(0), flag(1), unit(2))),
            "displayReps" => j(display_reps(&set(0))),
            "displayCompletedReps" => j(display_completed_reps(&set(0))),
            "isCompletedSet" => j(is_completed_set(&set(0))),
            "isInRangeCompletedSet" => j(is_in_range_completed_set(&set(0))),
            "isFinishedSet" => j(is_finished_set(&set(0))),
            "toKey" => j(to_key(&set(0))),
            "enforceCompletedSet" => j(enforce_completed_set(&set(0))),
            "maxUnilateralCompletedReps" => j(max_unilateral_completed_reps(&set(0))),
            "avgUnilateralCompletedReps" => j(avg_unilateral_completed_reps(&set(0))),
            "completedSetKey" => j(completed_set_key(&set(0))),
            "targetSetKey" => j(target_set_key(&set(0))),
            "setVolume" => j(set_volume(&set(0), unit(1))),
            "isSameSet" => j(is_same_set(&set(0), &set(1))),
            "findNextSet" => j(find_next_set(&arg::<IHistoryEntry>(&a[0]))),
            "findNextSetIndex" => j(find_next_set_index(&arg::<IHistoryEntry>(&a[0]))),
            "addSet" => {
                let last = arg::<Option<ISet>>(&a[2]);
                let mut uid = SequentialUid::new();
                j(add_set(&sets(0), flag(1), last.as_ref(), flag(3), &mut uid))
            }
            "newSet" => {
                let mut uid = SequentialUid::new();
                j(new_set(flag(0), a[1].as_i64().unwrap_or(0), &mut uid))
            }
            _ => return None,
        })
    }

    #[test]
    fn matches_oracle() {
        let cases = parse_cases(include_str!("../testdata/unit/cases_set.json"));
        let mut errors = Vec::new();
        let mut unknown = std::collections::BTreeSet::new();
        for c in &cases {
            match run(&c.f, &c.args) {
                Some(r) => check(c, &Value::Array(c.args.clone()).to_string(), r, true, &mut errors),
                None => {
                    unknown.insert(c.f.clone());
                }
            }
        }
        assert!(unknown.is_empty(), "unhandled fns: {unknown:?}");
        assert!(errors.is_empty(), "{} of {} cases differ, first:\n{}", errors.len(), cases.len(), errors.join("\n"));
    }

    #[test]
    fn add_set_generates_distinct_ids_with_given_source() {
        let mut uid = SequentialUid::new();
        let s1 = new_set(false, 0, &mut uid);
        let sets = add_set(std::slice::from_ref(&s1), false, None, false, &mut uid);
        assert_eq!(sets.len(), 2);
        assert_ne!(sets[0].id, sets[1].id);
        assert_eq!(sets[1].index, 1);
        assert_eq!(sets[1].id.len(), 6);
    }

    #[test]
    fn next_entry_and_set_uses_supplied_navigator() {
        let mut uid = SequentialUid::new();
        let mut done = new_set(false, 0, &mut uid);
        done.is_completed = Some(true);
        let todo = new_set(false, 0, &mut uid);
        let mk = |sets: Vec<ISet>| IHistoryEntry { sets, ..Default::default() };
        let rec = IHistoryRecord {
            vtype: crate::types::IHistoryRecordVtype::Progress,
            date: String::new(),
            program_id: String::new(),
            program_name: String::new(),
            day: 1,
            day_name: String::new(),
            entries: vec![mk(vec![done.clone()]), mk(vec![done.clone(), todo.clone()])],
            start_time: 0.0,
            id: 0,
            end_time: None,
            week: None,
            day_in_week: None,
            ui: None,
            intervals: None,
            deleted_program_exercises: None,
            user_prompted_state_vars: None,
            changes: None,
            timer_since: None,
            timer_mode: None,
            timer: None,
            timer_entry_index: None,
            timer_set_index: None,
            set_timer: None,
            set_timer_get_ready: None,
            amrap_modal: None,
            current_entry_index: None,
            notes: None,
            updated_at: None,
            source: None,
        };
        let next = |_: &IHistoryRecord, _: &IHistoryEntry, _: IProgressMode, _: bool| Some(1usize);
        let r = find_next_entry_and_set(&rec, 0, IProgressMode::Workout, next).expect("next");
        assert_eq!(r.set.id, todo.id);
        let r = find_next_entry_and_set_index(&rec, 0, IProgressMode::Workout, next).expect("idx");
        assert_eq!(r, NextEntryAndSetIndex { entry_index: 1, set_index: 1 });
        assert!(find_next_entry_and_set(&rec, 5, IProgressMode::Workout, next).is_none());
        let none = |_: &IHistoryRecord, _: &IHistoryEntry, _: IProgressMode, _: bool| None;
        assert!(find_next_entry_and_set(&rec, 0, IProgressMode::Workout, none).is_none());
    }
}
