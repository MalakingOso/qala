//! How long to rest after a set (PLAN 6.6, DECISIONS D32). Pure: no clock, no storage.
//!
//! The rest is a base for the lift's class and rep range (or the program's own), times the lifter's learned pace, plus the
//! adjustments the set earned (effort, a miss, a late set or rep drift, low readiness), rounded to 15 s and kept inside the
//! class's range. The result carries reason codes and numbers, never prose: the app words each row of the "Why" ledger.
//!
//! The class's top is a cap the rows are summed against, in order: a row that crosses it counts only the part that fit and the
//! rows after it count nothing (`applied`), so the applied rows always add up to the rest. A program's own rest raises the cap
//! for its lift, up to [HARD_CAP]. The plan also says whether the set was a grind and whether the load should come down.

use serde::{Deserialize, Serialize};

use crate::js::js_round;

/// What a lift is for, which sets its base rest: the lifter's main lifts, one-muscle isolation work, everything else.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RestClass {
    Main,
    Secondary,
    Isolation,
}

/// The first work set of the exercise today, which later sets are compared with for drift.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirstSet {
    pub reps: f64,
    pub rpe: Option<f64>,
    pub weight: Option<f64>,
}

/// One rest the lifter took, seen again after the set that followed it. All seconds except `hit`.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    /// The rest actually taken.
    pub taken: f64,
    /// The plan's base for the exercise and the sum of its adjustments, both without the learned pace.
    pub base: f64,
    pub adjust: f64,
    /// The rest the plan asked for: a rest shorter than this was started early.
    pub planned: f64,
    /// The set after it reached its reps and its RPE target (within half a point).
    pub hit: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestInput {
    pub class: RestClass,
    /// The reps the set asked for: at 6 or fewer the lift counts as strength work, above as hypertrophy.
    pub target_reps: f64,
    pub logged_reps: f64,
    pub logged_rpe: Option<f64>,
    pub target_rpe: Option<f64>,
    /// 1-based number of the set just logged.
    #[serde(default = "one")]
    pub set_number: u32,
    #[serde(default)]
    pub amrap: bool,
    /// The bottom of the set's rep range (8 on an 8-12 set), when it has one: fewer reps than this is a miss.
    #[serde(default)]
    pub min_reps: Option<f64>,
    /// The work set before this one in the exercise was a grind, and the exercise's load was already lowered today.
    #[serde(default)]
    pub prev_grind: bool,
    #[serde(default)]
    pub lowered: bool,
    /// The program's own rest for the set, when it names one: it replaces the table's base.
    pub explicit_base: Option<i32>,
    /// The load of the set just logged, and the exercise's first work set today (rep drift needs both at one load).
    pub weight: Option<f64>,
    pub first: Option<FirstSet>,
    /// Today's readiness: the worst soreness (1 to 4) on the lift's target muscles, the check-in's recovery score
    /// (0 to 10), and the engine's local fatigue (0 to 1) for those muscles. Any may be absent.
    pub soreness: Option<u8>,
    pub prs: Option<f64>,
    pub fatigue_local: Option<f64>,
    /// Past rests of this exercise and of its class, oldest first. Empty turns the learned pace off.
    #[serde(default)]
    pub exercise_history: Vec<Observation>,
    #[serde(default)]
    pub class_history: Vec<Observation>,
}

fn one() -> u32 {
    1
}

/// Why a row of the ledger is there. The app words each one from its numbers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RestCode {
    RestBaseProgram,
    RestBaseMainHeavy,
    RestBaseMain,
    RestBaseSecond,
    RestBaseIsolation,
    /// The lifter's own pace: `value` is the multiplier.
    RestPace,
    /// A grind or a miss at RPE 9.5 and up: `value` is the logged RPE.
    RestFailure,
    /// Effort over or under the target: `value` is the logged RPE, `other` the target.
    RestEffortHigh,
    RestEffortLow,
    /// Reps short of the target: `value` is the target.
    RestRepsShort,
    /// Set 4 or later of a heavy main lift: `value` is the set number.
    RestLateSet,
    /// Reps or RPE slipped against the first set at the same load.
    RestDrift,
    RestLowReadiness,
    /// Rounded to 15 s.
    RestRound,
    /// Raised to the class's shortest rest: `value` is that rest in seconds.
    RestFloor,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RestRow {
    pub code: RestCode,
    /// What the row asks for.
    pub seconds: i32,
    /// The part of it that fit under the cap: less than `seconds` when the row crossed the cap, 0 when it came after it.
    pub applied: i32,
    pub value: Option<f64>,
    pub other: Option<f64>,
}

/// What a grind asks of the load of the sets still to come.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AutoregAction {
    /// Lower the remaining sets by `percent`, rounded down to loadable plates.
    Lower,
    /// Drop the remaining sets of the exercise.
    DropRemaining,
}

/// Why the load steps in: the rest would have run past the cap, or two work sets in a row were grinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AutoregWhy {
    CapOverflow,
    TwoInARow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Autoreg {
    pub action: AutoregAction,
    /// 5 or 10 for [AutoregAction::Lower], 0 for a drop.
    pub percent: u32,
    pub why: AutoregWhy,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestPlan {
    pub seconds: i32,
    pub base: i32,
    /// The sum of the adjustments, without the learned pace: what a later observation subtracts from the rest taken.
    pub adjust: i32,
    pub multiplier: f64,
    pub rows: Vec<RestRow>,
    /// The set was a grind: RPE 9.5 or more, or reps under the bottom of the range with no lower RPE logged. Never for an AMRAP.
    pub grind: bool,
    pub autoreg: Option<Autoreg>,
}

struct Cell {
    base: i32,
    min: i32,
    max: i32,
}

fn cell(strength: bool, class: RestClass) -> Cell {
    let (base, min, max) = match (class, strength) {
        (RestClass::Main, true) => (180, 120, 300),
        (RestClass::Main, false) => (150, 90, 240),
        (RestClass::Secondary, true) => (150, 90, 240),
        (RestClass::Secondary, false) => (120, 90, 180),
        (RestClass::Isolation, _) => (90, 60, 150),
    };
    Cell { base, min, max }
}

/// Seconds to the nearest 15, halves up.
pub fn round15(seconds: f64) -> i32 {
    (js_round(seconds / 15.0) * 15.0) as i32
}

/// No rest is planned past this, whatever the program asks for.
pub const HARD_CAP: i32 = 300;

const ALPHA: f64 = 0.1;
const M_MIN: f64 = 0.75;
const M_MAX: f64 = 1.5;
/// After this many rests of one exercise, its own pace replaces the class's.
const OWN_AFTER: usize = 20;

/// The learned pace after [history], oldest first, from a start of 1 (PLAN 6.6). A rest that was taken early before a set
/// that missed teaches nothing; one taken in full before a set that missed pushes the pace up.
pub fn learned_multiplier(history: &[Observation]) -> f64 {
    let mut m = 1.0_f64;
    for o in history {
        if o.base <= 0.0 {
            continue;
        }
        let early = o.taken < o.planned;
        let observed = ((o.taken - o.adjust) / o.base).clamp(M_MIN, M_MAX);
        if o.hit {
            m += ALPHA * (observed - m);
        } else if !early {
            m += ALPHA * ((1.15 * m).min(M_MAX) - m);
        }
    }
    m.clamp(M_MIN, M_MAX)
}

fn base_code(class: RestClass, strength: bool, explicit: bool) -> RestCode {
    match (explicit, class, strength) {
        (true, _, _) => RestCode::RestBaseProgram,
        (_, RestClass::Main, true) => RestCode::RestBaseMainHeavy,
        (_, RestClass::Main, false) => RestCode::RestBaseMain,
        (_, RestClass::Secondary, _) => RestCode::RestBaseSecond,
        (_, RestClass::Isolation, _) => RestCode::RestBaseIsolation,
    }
}

/// The rows of the ledger, summed against the cap as they come.
struct Ledger {
    rows: Vec<RestRow>,
    sum: i32,
    cap: i32,
}

impl Ledger {
    /// Adds a row asking for [seconds]; what counts is the part that fits under the cap (a cut is always taken in full).
    /// Returns what counted.
    fn add(&mut self, code: RestCode, seconds: i32, value: Option<f64>, other: Option<f64>) -> i32 {
        let applied = if seconds > 0 { seconds.min((self.cap - self.sum).max(0)) } else { seconds };
        self.sum += applied;
        self.rows.push(RestRow { code, seconds, applied, value, other });
        applied
    }
}

/// Whether the set was a grind, and whether it also missed its reps.
fn grind_of(input: &RestInput) -> (bool, bool) {
    if input.amrap {
        return (false, false);
    }
    let missed = input.logged_reps < input.min_reps.unwrap_or(input.target_reps);
    let hard = input.logged_rpe.is_some_and(|r| r >= 9.5);
    // A miss with no RPE counts as RPE 10; a miss with a lower RPE logged was just a short set.
    (hard || (missed && input.logged_rpe.is_none()), missed)
}

/// The rest after a set.
pub fn plan_rest(input: &RestInput) -> RestPlan {
    let strength = input.target_reps <= 6.0;
    let cell = cell(strength, input.class);
    let cap = input.explicit_base.map_or(cell.max, |e| cell.max.max(e)).min(HARD_CAP);
    let base = input.explicit_base.unwrap_or(cell.base).min(cap);
    let mut ledger = Ledger { rows: vec![], sum: 0, cap };
    ledger.add(base_code(input.class, strength, input.explicit_base.is_some()), base, None, None);

    let history = if input.exercise_history.len() >= OWN_AFTER { &input.exercise_history } else { &input.class_history };
    let m = learned_multiplier(history);
    let paced = js_round(base as f64 * m) as i32;
    if paced != base {
        ledger.add(RestCode::RestPace, paced - base, Some(m), None);
    }

    let mut adjust = 0;
    let rpe = input.logged_rpe;
    let failed = rpe.is_some_and(|r| r >= 10.0 || (input.logged_reps < input.target_reps && !input.amrap && r >= 9.5));
    if failed {
        let a = if input.class == RestClass::Isolation { 30 } else { 60 };
        adjust += ledger.add(RestCode::RestFailure, a, rpe, None);
    } else if let (Some(r), Some(t)) = (rpe, input.target_rpe) {
        let e = (30.0 * (r - t)).clamp(-30.0, 45.0) as i32;
        if e != 0 {
            adjust += ledger.add(if e > 0 { RestCode::RestEffortHigh } else { RestCode::RestEffortLow }, e, Some(r), Some(t));
        }
    }
    if !failed && !input.amrap && input.logged_reps < input.target_reps {
        adjust += ledger.add(RestCode::RestRepsShort, 30, Some(input.target_reps), None);
    }

    // Session fatigue is the larger of a late set on a heavy lift and drift against the first set, not the sum.
    if strength && input.class == RestClass::Main && input.set_number >= 4 {
        adjust += ledger.add(RestCode::RestLateSet, 30, Some(input.set_number as f64), None);
    } else if drifted(input, strength) {
        adjust += ledger.add(RestCode::RestDrift, 30, None, None);
    }

    let tired = input.soreness == Some(4) || input.prs.is_some_and(|p| p <= 4.0) || input.fatigue_local.is_some_and(|f| f >= 0.7);
    if tired {
        adjust += ledger.add(RestCode::RestLowReadiness, 30, None, None);
    }

    let overflow = ledger.rows.iter().any(|r| r.applied < r.seconds);
    let total = ledger.sum;
    // Rounded up past the cap goes back to it; below the class's shortest rest goes up to that.
    let rounded = round15(total as f64).min(cap);
    if rounded != total {
        ledger.add(RestCode::RestRound, rounded - total, None, None);
    }
    let seconds = rounded.max(cell.min);
    if seconds != rounded {
        ledger.add(RestCode::RestFloor, seconds - rounded, Some(cell.min as f64), None);
    }

    let (grind, missed) = grind_of(input);
    let autoreg = (grind && (overflow || input.prev_grind)).then(|| {
        let why = if overflow { AutoregWhy::CapOverflow } else { AutoregWhy::TwoInARow };
        if input.lowered {
            Autoreg { action: AutoregAction::DropRemaining, percent: 0, why }
        } else {
            let hard = missed || rpe.is_none_or(|r| r >= 10.0);
            Autoreg { action: AutoregAction::Lower, percent: if hard { 10 } else { 5 }, why }
        }
    });
    RestPlan { seconds, base, adjust, multiplier: m, rows: ledger.rows, grind, autoreg }
}

/// Reps fell 20% or more against the first set at the same load (hypertrophy), or RPE rose a full point (strength).
fn drifted(input: &RestInput, strength: bool) -> bool {
    let Some(first) = input.first else { return false };
    if input.set_number < 2 || first.weight != input.weight {
        return false;
    }
    if strength {
        matches!((input.logged_rpe, first.rpe), (Some(now), Some(then)) if now - then >= 1.0)
    } else {
        // Compared as reps lost, so 8 against 10 is exactly the 20% line, not 0.19999999999999996 of it.
        first.reps > 0.0 && first.reps - input.logged_reps >= 0.20 * first.reps - 1e-9
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(class: RestClass, target_reps: f64, logged_reps: f64) -> RestInput {
        RestInput {
            class,
            target_reps,
            logged_reps,
            logged_rpe: None,
            target_rpe: None,
            set_number: 1,
            amrap: false,
            min_reps: None,
            prev_grind: false,
            lowered: false,
            explicit_base: None,
            weight: Some(100.0),
            first: None,
            soreness: None,
            prs: None,
            fatigue_local: None,
            exercise_history: vec![],
            class_history: vec![],
        }
    }

    fn codes(p: &RestPlan) -> Vec<RestCode> {
        p.rows.iter().map(|r| r.code).collect()
    }

    #[test]
    fn the_base_is_the_table_cell_and_the_ledger_adds_up() {
        let p = plan_rest(&input(RestClass::Main, 5.0, 5.0));
        assert_eq!((p.seconds, p.base), (180, 180));
        assert_eq!(codes(&p), vec![RestCode::RestBaseMainHeavy]);
        assert_eq!(plan_rest(&input(RestClass::Secondary, 10.0, 10.0)).seconds, 120);
        assert_eq!(plan_rest(&input(RestClass::Isolation, 12.0, 12.0)).seconds, 90);
        let hard = RestInput { logged_rpe: Some(9.0), target_rpe: Some(8.0), ..input(RestClass::Main, 5.0, 5.0) };
        let p = plan_rest(&hard);
        assert_eq!(p.seconds, 210);
        assert_eq!(p.rows.iter().map(|r| r.applied).sum::<i32>(), 210);
    }

    #[test]
    fn effort_is_clamped_and_a_failure_replaces_it() {
        let low = RestInput { logged_rpe: Some(6.0), target_rpe: Some(8.0), ..input(RestClass::Main, 5.0, 5.0) };
        assert_eq!(plan_rest(&low).seconds, 150);                      // -30 at most
        let fail = RestInput { logged_rpe: Some(10.0), target_rpe: Some(8.0), ..input(RestClass::Main, 5.0, 5.0) };
        let p = plan_rest(&fail);
        assert_eq!(p.seconds, 240);
        assert_eq!(codes(&p), vec![RestCode::RestBaseMainHeavy, RestCode::RestFailure]);
        let iso = RestInput { logged_rpe: Some(10.0), ..input(RestClass::Isolation, 12.0, 12.0) };
        assert_eq!(plan_rest(&iso).seconds, 120);                      // +30 for isolation, not +60
    }

    #[test]
    fn short_reps_and_the_clamp() {
        let short = input(RestClass::Secondary, 10.0, 8.0);
        let p = plan_rest(&short);
        assert_eq!(p.seconds, 150);
        assert!(codes(&p).contains(&RestCode::RestRepsShort));
        let amrap = RestInput { amrap: true, ..short };
        assert_eq!(plan_rest(&amrap).seconds, 120);
        let grind = RestInput { logged_rpe: Some(10.0), set_number: 5, ..input(RestClass::Main, 3.0, 3.0) };
        let p = plan_rest(&grind);
        assert_eq!(p.seconds, 270);                                     // 180 + 60 + 30
        let capped = RestInput { soreness: Some(4), ..grind };
        let p = plan_rest(&capped);
        assert_eq!(p.seconds, 300);                                     // 180 + 60 + 30 + 30 = 300, the top of the range
    }

    #[test]
    fn a_late_set_and_drift_take_the_larger_not_the_sum() {
        let late = RestInput { set_number: 4, ..input(RestClass::Main, 5.0, 5.0) };
        assert_eq!(plan_rest(&late).seconds, 210);
        let first = FirstSet { reps: 10.0, rpe: Some(7.0), weight: Some(100.0) };
        // Hypertrophy drift: 10 reps then 8 at the same load.
        let drift = RestInput { first: Some(first), set_number: 3, ..input(RestClass::Secondary, 10.0, 8.0) };
        let p = plan_rest(&drift);
        assert!(codes(&p).contains(&RestCode::RestDrift));
        // Strength drift: RPE up a full point.
        let strength = RestInput { logged_rpe: Some(8.0), first: Some(FirstSet { reps: 5.0, rpe: Some(7.0), weight: Some(100.0) }), set_number: 3, ..input(RestClass::Secondary, 5.0, 5.0) };
        assert!(codes(&plan_rest(&strength)).contains(&RestCode::RestDrift));
        // Another load is not drift.
        let other = RestInput { first: Some(FirstSet { weight: Some(90.0), ..first }), set_number: 3, ..input(RestClass::Secondary, 10.0, 8.0) };
        assert!(!codes(&plan_rest(&other)).contains(&RestCode::RestDrift));
        // Both at once is one +30.
        let both = RestInput { set_number: 4, first: Some(FirstSet { reps: 5.0, rpe: Some(7.0), weight: Some(100.0) }), logged_rpe: Some(8.5), target_rpe: Some(8.5), ..input(RestClass::Main, 5.0, 5.0) };
        let p = plan_rest(&both);
        assert_eq!(p.adjust, 30);
        assert_eq!(codes(&p), vec![RestCode::RestBaseMainHeavy, RestCode::RestLateSet]);
    }

    #[test]
    fn low_readiness_adds_thirty_for_soreness_prs_or_fatigue() {
        let base = input(RestClass::Secondary, 10.0, 10.0);
        assert_eq!(plan_rest(&base).seconds, 120);
        for tired in [
            RestInput { soreness: Some(4), ..base.clone() },
            RestInput { prs: Some(4.0), ..base.clone() },
            RestInput { fatigue_local: Some(0.7), ..base.clone() },
        ] {
            let p = plan_rest(&tired);
            assert_eq!(p.seconds, 150);
            assert!(codes(&p).contains(&RestCode::RestLowReadiness));
        }
        let fine = RestInput { soreness: Some(3), prs: Some(7.0), fatigue_local: Some(0.69), ..base };
        assert_eq!(plan_rest(&fine).seconds, 120);
    }

    #[test]
    fn the_program_rest_raises_the_cap_up_to_five_minutes_and_rows_past_it_count_nothing() {
        // A program rest above the class's top is its own cap: 240 s on an isolation lift stays 240 s.
        let p = plan_rest(&RestInput { explicit_base: Some(240), ..input(RestClass::Isolation, 12.0, 12.0) });
        assert_eq!((p.seconds, p.base), (240, 240));
        assert_eq!(codes(&p), vec![RestCode::RestBaseProgram]);
        // At the 5:00 ceiling a grind's +60 does not fit: the row is kept, counts nothing, and the ledger still adds up.
        let top = RestInput { explicit_base: Some(300), logged_rpe: Some(10.0), ..input(RestClass::Main, 5.0, 5.0) };
        let p = plan_rest(&top);
        assert_eq!(p.seconds, 300);
        assert_eq!(p.rows.iter().map(|r| (r.seconds, r.applied)).collect::<Vec<_>>(), vec![(300, 300), (60, 0)]);
        assert_eq!(p.rows.iter().map(|r| r.applied).sum::<i32>(), 300);
        assert_eq!(p.autoreg.map(|a| (a.action, a.percent, a.why)), Some((AutoregAction::Lower, 10, AutoregWhy::CapOverflow)));
        // A row that crosses the cap counts only the part that fit.
        let near = RestInput { explicit_base: Some(270), logged_rpe: Some(10.0), ..input(RestClass::Main, 5.0, 5.0) };
        assert_eq!(plan_rest(&near).rows[1].applied, 30);
        // Below the class's shortest rest, the floor row says so.
        let short = plan_rest(&RestInput { explicit_base: Some(60), ..input(RestClass::Main, 5.0, 5.0) });
        assert_eq!((short.seconds, codes(&short)), (120, vec![RestCode::RestBaseProgram, RestCode::RestFloor]));
    }

    #[test]
    fn a_grind_lowers_the_load_when_the_rest_overflows_or_twice_in_a_row() {
        let rpe = |r: f64| RestInput { logged_rpe: Some(r), ..input(RestClass::Main, 5.0, 5.0) };
        // One grind with room in the rest does nothing.
        assert!(plan_rest(&rpe(10.0)).autoreg.is_none() && plan_rest(&rpe(10.0)).grind);
        // The second in a row steps in: 5% at RPE 9.5 with all reps, 10% at RPE 10 or a miss, then the rest of the sets go.
        let again = |r: RestInput| RestInput { prev_grind: true, ..r };
        assert_eq!(plan_rest(&again(rpe(9.5))).autoreg.map(|a| a.percent), Some(5));
        assert_eq!(plan_rest(&again(rpe(10.0))).autoreg.map(|a| a.percent), Some(10));
        let miss = RestInput { min_reps: Some(5.0), ..input(RestClass::Main, 5.0, 4.0) };
        assert!(plan_rest(&miss).grind);
        assert_eq!(plan_rest(&again(miss.clone())).autoreg.map(|a| a.percent), Some(10));
        let lowered = RestInput { lowered: true, ..again(rpe(10.0)) };
        assert_eq!(plan_rest(&lowered).autoreg.map(|a| (a.action, a.percent)), Some((AutoregAction::DropRemaining, 0)));
        // 10 reps on an 8-12 set is in the range, and a miss with a lower RPE logged is not a grind. AMRAP never is.
        let range = RestInput { min_reps: Some(8.0), ..input(RestClass::Secondary, 12.0, 10.0) };
        assert!(!plan_rest(&range).grind);
        assert!(!plan_rest(&RestInput { logged_rpe: Some(8.0), ..miss.clone() }).grind);
        assert!(!plan_rest(&RestInput { amrap: true, logged_rpe: Some(10.0), ..miss }).grind);
    }

    #[test]
    fn the_learned_pace_after_ten_early_on_target_taps_is_0_837() {
        let tap = Observation { taken: 90.0, base: 120.0, adjust: 0.0, planned: 120.0, hit: true };
        let m = learned_multiplier(&[tap; 10]);
        assert!((m - (0.75 + 0.25 * 0.9_f64.powi(10))).abs() < 1e-9);
        assert!((m - 0.837).abs() < 0.001);
        // It shortens the next rest: 120 * 0.837 = 100, to 105.
        let learned = RestInput { class_history: vec![tap; 10], ..input(RestClass::Secondary, 10.0, 10.0) };
        let p = plan_rest(&learned);
        assert_eq!(p.seconds, 105);
        assert!(codes(&p).contains(&RestCode::RestPace));
        assert_eq!(p.rows.iter().map(|r| r.applied).sum::<i32>(), 105);
    }

    #[test]
    fn an_early_start_that_missed_never_lowers_the_pace_and_a_full_rest_that_missed_raises_it() {
        let early_miss = Observation { taken: 60.0, base: 120.0, adjust: 0.0, planned: 120.0, hit: false };
        assert_eq!(learned_multiplier(&[early_miss; 5]), 1.0);
        let full_miss = Observation { taken: 120.0, base: 120.0, adjust: 0.0, planned: 120.0, hit: false };
        let m = learned_multiplier(&[full_miss; 3]);
        assert!(m > 1.0 && m <= 1.5);
        assert!((learned_multiplier(&[full_miss; 200]) - 1.5).abs() < 1e-9);
        // The adjustments are taken out of what was taken before it is read as pace.
        let padded = Observation { taken: 150.0, base: 120.0, adjust: 30.0, planned: 150.0, hit: true };
        assert!((learned_multiplier(&[padded]) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn an_exercise_with_twenty_rests_uses_its_own_pace() {
        let fast = Observation { taken: 90.0, base: 120.0, adjust: 0.0, planned: 120.0, hit: true };
        let slow = Observation { taken: 180.0, base: 120.0, adjust: 0.0, planned: 120.0, hit: true };
        let class_only = RestInput { class_history: vec![slow; 30], exercise_history: vec![fast; 19], ..input(RestClass::Secondary, 10.0, 10.0) };
        assert!(plan_rest(&class_only).multiplier > 1.0);
        let own = RestInput { exercise_history: vec![fast; 20], ..class_only };
        assert!(plan_rest(&own).multiplier < 1.0);
    }
}
