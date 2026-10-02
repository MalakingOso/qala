//! The derived numbers the Today screen needs (docs/PLAN-m1-rust-core.md, "Derived numbers").
//!
//! None of these has a TS source, so every definition below is an assumption written down. The
//! goldens in `testdata/golden/derived/` are worked by hand from these definitions.
//!
//! - [`readiness_summary`]: readiness today, the 28 day mean of check-in scores, and per-muscle
//!   ready dates.
//! - [`session_load`], [`planned_week_load`], [`done_week_load`]: fatigue load per weekday.
//! - [`weight_trend`]: 7 day mean body weight, its week-over-week change and its current run.
//!
//! Pure functions: no clock (the caller passes `now` and `today`), no I/O, no panics. Dates that
//! do not parse are errors.

use crate::adapter::{
    apply_item, build_timeline, iso_local_date_key, parse_checkins, AdapterError, ParsedCheckin,
    TimelineFilter, TimelineItem,
};
use crate::engine::decay::{decay_value, muscle_tau, TAU_DAMAGE};
use crate::engine::readiness::{predict_readiness, Readiness};
use crate::engine::running::{run_set_equivalents, RunZone, ZONE_EASY, ZONE_HARD, ZONE_STEADY};
use crate::engine::session::set_factor;
use crate::engine::state::{Checkin, EngineState, LiftEntry, Workout};
use crate::js::{js_max, ser_opt_num};
use crate::records::{BodyWeightRecord, SessionRecord, SettingsRecord};
use crate::time::{
    days_between, days_from_date_key, local_date_key, parse_iso, weekday_of_days, TimeError,
    MS_PER_DAY,
};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

/// Why a derived number could not be computed.
#[derive(Debug, Clone, PartialEq)]
pub enum DerivedError {
    /// A date or instant did not parse.
    Time(TimeError),
    /// The history could not be turned into engine input.
    Adapter(AdapterError),
    /// A week start that is not a Monday. Carries the key.
    NotMonday(String),
    /// A number that must be finite was not. Carries what it was.
    NonFinite(String),
    /// A planned entry the math cannot use (negative sets, bad distance).
    Invalid(String),
}

impl fmt::Display for DerivedError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DerivedError::Time(e) => e.fmt(f),
            DerivedError::Adapter(e) => e.fmt(f),
            DerivedError::NotMonday(key) => write!(f, "week start {key:?} is not a Monday"),
            DerivedError::NonFinite(what) => write!(f, "{what} is not a finite number"),
            DerivedError::Invalid(what) => f.write_str(what),
        }
    }
}

impl std::error::Error for DerivedError {}

impl From<TimeError> for DerivedError {
    fn from(e: TimeError) -> Self {
        DerivedError::Time(e)
    }
}

impl From<AdapterError> for DerivedError {
    fn from(e: AdapterError) -> Self {
        DerivedError::Adapter(e)
    }
}

// ---------------------------------------------------------------------------------------------
// Readiness summary and ready dates
// ---------------------------------------------------------------------------------------------

/// A muscle is ready when its load drops to this many set-equivalents or fewer. 2.0 is
/// `fatigue_local` 0.25 (about 8 hard set-equivalents is 1.0).
pub const READY_THRESHOLD: f64 = 2.0;

/// A muscle still above [`READY_THRESHOLD`] after this many days is reported at this horizon
/// with `capped: true`.
pub const READY_CAP_DAYS: f64 = 21.0;

/// The bisection stops when the bracket is this narrow, in days (about 0.09 seconds).
pub const READY_TOLERANCE_DAYS: f64 = 1e-6;

/// The mean readiness covers check-ins from this many days before `now` up to `now`.
pub const AVERAGE_WINDOW_DAYS: i64 = 28;

/// The recovery (PRS) assumed for the readiness estimate when there is no check-in today and no
/// check-in in the last 28 days either.
pub const NEUTRAL_RECOVERY: f64 = 7.0;

/// With no check-in today the estimate uses the 28 day mean recovery, but never less than this.
/// It is above the PRS flag threshold of 4, so a day without a check-in cannot raise `prs-low`
/// from a check-in the user did not make.
pub const NEUTRAL_RECOVERY_FLOOR: f64 = 5.0;

/// The day a muscle is ready.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadyDate {
    /// Engine muscle id.
    pub muscle: String,
    /// Local `YYYY-MM-DD` at the caller's offset: the day the muscle's load crosses
    /// [`READY_THRESHOLD`], or the day of the cap.
    pub date: String,
    /// True when the load was still above the threshold at [`READY_CAP_DAYS`].
    pub capped: bool,
}

/// What [`readiness_summary`] returns.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessSummary {
    /// Readiness at `now`. See [`readiness_summary`] for which check-in it uses.
    pub today: Readiness,
    /// True when `today` used a check-in from today's local date; false when it is a
    /// fatigue-only estimate.
    pub checked_in_today: bool,
    /// Mean of the readiness scores of the check-ins in the 28 days up to `now`; `null` when
    /// there are none.
    #[serde(rename = "average28d", serialize_with = "ser_opt_num")]
    pub average_28d: Option<f64>,
    /// How many check-ins that mean covers.
    #[serde(rename = "checkinCount28d")]
    pub checkin_count_28d: usize,
    /// Muscles not yet ready, sorted by date then muscle id.
    pub ready_dates: Vec<ReadyDate>,
}

/// How long until a muscle's load falls to [`READY_THRESHOLD`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReadyIn {
    /// Days from the moment `g` and `d` were measured; 0 when already ready, and
    /// [`READY_CAP_DAYS`] when capped.
    pub days: f64,
    pub capped: bool,
}

/// `L(t) = G * exp(-t / tau_g) + D * exp(-t / tau_d)`: a muscle's load `t` days after `G` and
/// `D` were measured.
fn load_after(g: f64, d: f64, tau_g: f64, t: f64) -> f64 {
    g * (-t / tau_g).exp() + d * (-t / TAU_DAMAGE).exp()
}

/// The first `t >= 0` with `L(t) <= READY_THRESHOLD`, found by bisection to
/// [`READY_TOLERANCE_DAYS`] (the upper end of the final bracket is reported, so the muscle is
/// ready at the returned time). `L` only falls with `t` for non-negative `g` and `d`.
pub fn ready_in(g: f64, d: f64, tau_g: f64) -> ReadyIn {
    if load_after(g, d, tau_g, 0.0) <= READY_THRESHOLD {
        return ReadyIn {
            days: 0.0,
            capped: false,
        };
    }
    if load_after(g, d, tau_g, READY_CAP_DAYS) > READY_THRESHOLD {
        return ReadyIn {
            days: READY_CAP_DAYS,
            capped: true,
        };
    }
    let (mut lo, mut hi) = (0.0, READY_CAP_DAYS);
    while hi - lo > READY_TOLERANCE_DAYS {
        let mid = 0.5 * (lo + hi);
        if load_after(g, d, tau_g, mid) <= READY_THRESHOLD {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    ReadyIn {
        days: hi,
        capped: false,
    }
}

/// Per-muscle ready dates for `state` as of `now_iso`.
///
/// `G` is `fatigue_muscle` and `D` is `fatigue_damage`, each decayed from `state.updated` to
/// `now_iso` (no decay when `now_iso` is not later). A muscle whose load at `now` is already at
/// or under [`READY_THRESHOLD`] is left out. The date is the local date, at `offset_min`, of the
/// instant the load crosses the threshold (rounded up to the millisecond), or of `now` plus
/// [`READY_CAP_DAYS`] when capped. Sorted by date, then muscle id. `run_fatigue_*` are subsets
/// of `fatigue_*` and are not read.
pub fn ready_dates(
    state: &EngineState,
    now_iso: &str,
    offset_min: i64,
) -> Result<Vec<ReadyDate>, DerivedError> {
    let now_ms = parse_iso(now_iso)?;
    let dt = js_max(0.0, days_between(&state.updated, now_iso)?);
    let muscles: BTreeSet<&String> = state
        .fatigue_muscle
        .keys()
        .chain(state.fatigue_damage.keys())
        .collect();
    let mut out = Vec::new();
    for muscle in muscles {
        let tau = muscle_tau(muscle);
        let g = decay_value(
            state.fatigue_muscle.get(muscle).copied().unwrap_or(0.0),
            dt,
            tau,
        );
        let d = decay_value(
            state.fatigue_damage.get(muscle).copied().unwrap_or(0.0),
            dt,
            TAU_DAMAGE,
        );
        if !(g.is_finite() && d.is_finite()) {
            return Err(DerivedError::NonFinite(format!("fatigue of {muscle}")));
        }
        let r = ready_in(g, d, tau);
        if r.days == 0.0 && !r.capped {
            continue;
        }
        let at_ms = now_ms.saturating_add((r.days * MS_PER_DAY as f64).ceil() as i64);
        out.push(ReadyDate {
            muscle: muscle.clone(),
            date: local_date_key(at_ms, offset_min),
            capped: r.capped,
        });
    }
    out.sort_by(|a, b| (&a.date, &a.muscle).cmp(&(&b.date, &b.muscle)));
    Ok(out)
}

/// Readiness today, the 28 day mean, and the per-muscle ready dates.
///
/// The history is replayed chronologically through the adapter, using only records at or before
/// `now_iso` (a later record would move the state's clock past `now` and switch decay off).
///
/// - **Each check-in** in `[now - 28 d, now]` is scored with `predict_readiness` on the state
///   just before it (every replay step strictly earlier than the check-in), decayed to the
///   check-in's own instant. Session muscles are the check-in's own soreness keys, which is
///   `predict_readiness`'s default. Scoring before applying keeps the check-in's PRS out of its
///   own z-score window. `average_28d` is the plain mean of those scores.
/// - **Today** uses the latest check-in at or before `now` that falls on the same local date as
///   `now` at `offset_min`. The state is the full replay with that check-in left out (so its PRS
///   is not in its own window) and then decayed to `now`, so a session logged after the check-in
///   counts. `session_muscles` replaces the soreness keys as the muscles that matter today (for
///   example the muscles of the planned session). With no check-in today, `today` is a
///   fatigue-only estimate: a check-in with no soreness and a PRS equal to the mean recovery of
///   the 28 day window, raised to at least [`NEUTRAL_RECOVERY_FLOOR`] ([`NEUTRAL_RECOVERY`] when
///   the window is empty). A PRS at the window mean has a z-score of 0 and one above 4 never
///   raises the PRS flag, so the PRS term adds nothing. `checked_in_today` says which case it
///   is.
/// - **Ready dates** come from the full replay, see [`ready_dates`].
pub fn readiness_summary(
    records: &[SessionRecord],
    checkins: &[crate::records::CheckInRecord],
    settings: &SettingsRecord,
    now_iso: &str,
    offset_min: i64,
    session_muscles: Option<&[String]>,
) -> Result<ReadinessSummary, DerivedError> {
    let now_ms = parse_iso(now_iso)?;
    let today_key = local_date_key(now_ms, offset_min);
    let window_start = now_ms.saturating_sub(AVERAGE_WINDOW_DAYS * MS_PER_DAY);

    let parsed = parse_checkins(checkins)?;
    let in_window: Vec<&ParsedCheckin> = parsed
        .iter()
        .filter(|c| c.ms >= window_start && c.ms <= now_ms)
        .collect();

    // Score every check-in in the window against the state just before it.
    let full = build_timeline(
        records,
        checkins,
        settings,
        &TimelineFilter {
            until_ms: Some(now_ms),
            skip_checkin_id: None,
        },
    )?;
    let mut state = full.initial_state();
    let mut cursor = 0;
    let mut scores: Vec<f64> = Vec::with_capacity(in_window.len());
    for c in &in_window {
        while let Some(entry) = full.entries.get(cursor) {
            if entry.ms >= c.ms {
                break;
            }
            apply_item(&mut state, &entry.item)?;
            cursor += 1;
        }
        scores.push(predict_readiness(&state, &c.checkin, None, &c.at)?.score);
    }
    let average_28d = if scores.is_empty() {
        None
    } else {
        Some(scores.iter().fold(0.0, |a, b| a + b) / scores.len() as f64)
    };

    // Today.
    let today_checkin = parsed
        .iter()
        .rev()
        .filter(|c| c.ms <= now_ms)
        .find(|c| local_date_key(c.ms, offset_min) == today_key);
    let without_today;
    let timeline_now = match today_checkin {
        Some(c) => {
            without_today = build_timeline(
                records,
                checkins,
                settings,
                &TimelineFilter {
                    until_ms: Some(now_ms),
                    skip_checkin_id: Some(&c.id),
                },
            )?;
            &without_today
        }
        None => &full,
    };
    let state_now = timeline_now.replay()?;
    let checkin = match today_checkin {
        Some(c) => c.checkin.clone(),
        None => Checkin {
            prs: if in_window.is_empty() {
                NEUTRAL_RECOVERY
            } else {
                js_max(
                    in_window.iter().fold(0.0, |a, c| a + c.recovery) / in_window.len() as f64,
                    NEUTRAL_RECOVERY_FLOOR,
                )
            },
            soreness: BTreeMap::new(),
        },
    };
    let today = predict_readiness(&state_now, &checkin, session_muscles, now_iso)?;

    Ok(ReadinessSummary {
        today,
        checked_in_today: today_checkin.is_some(),
        average_28d,
        checkin_count_28d: in_window.len(),
        ready_dates: ready_dates(&state_now, now_iso, offset_min)?,
    })
}

// ---------------------------------------------------------------------------------------------
// Session and week load
// ---------------------------------------------------------------------------------------------

fn entry_load(e: &LiftEntry) -> f64 {
    // Each working set adds `set_factor` to every target and half of it to every synergist.
    let muscles = e.targets.len() as f64 + 0.5 * e.synergists.len() as f64;
    e.sets
        .iter()
        .filter(|s| s.completed && !s.warmup)
        .fold(0.0, |a, s| a + set_factor(s.rpe, s.target_rpe) * muscles)
}

/// Load of a run in set-equivalents: `run_set_equivalents(km, z)` summed over quads, calves,
/// glutes and hamstrings.
pub fn run_load(distance_m: f64, z: RunZone) -> f64 {
    let eq = run_set_equivalents(distance_m / 1000.0, z);
    eq.quads + eq.calves + eq.glutes + eq.hamstrings
}

/// The fatigue a workout adds, in set-equivalents, with the engine's accounting (`applyLift`,
/// `applyRun`).
///
/// A lift adds `set_factor(rpe, target_rpe)` for each working set (completed, not a warm-up) to
/// every target muscle and half of it to every synergist. A run adds [`run_load`] at `run_zone`;
/// the zone is ignored for a lift. Left out on purpose: the sRPE systemic load, and the eccentric
/// damage a run adds for its descent. The sum is over muscles, so a set that hits three targets
/// and two synergists weighs 4.
pub fn session_load(workout: &Workout, run_zone: RunZone) -> f64 {
    match workout {
        Workout::Lift(w) => w.entries.iter().fold(0.0, |a, e| a + entry_load(e)),
        Workout::Run(r) => run_load(r.distance_m, run_zone),
    }
}

/// A planned run's zone: easy 0.5, steady 1.0, hard 1.5. In JSON it is the number or its name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlannedZone {
    Easy,
    Steady,
    Hard,
}

impl PlannedZone {
    /// The zone weight the engine uses.
    pub fn z(self) -> RunZone {
        match self {
            PlannedZone::Easy => ZONE_EASY,
            PlannedZone::Steady => ZONE_STEADY,
            PlannedZone::Hard => ZONE_HARD,
        }
    }
}

impl<'de> Deserialize<'de> for PlannedZone {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            Num(f64),
            Name(String),
        }
        let bad = || {
            <D::Error as serde::de::Error>::custom(
                "zone must be 0.5, 1.0, 1.5, \"easy\", \"steady\" or \"hard\"",
            )
        };
        match Raw::deserialize(d)? {
            Raw::Num(x) if x == ZONE_EASY => Ok(PlannedZone::Easy),
            Raw::Num(x) if x == ZONE_STEADY => Ok(PlannedZone::Steady),
            Raw::Num(x) if x == ZONE_HARD => Ok(PlannedZone::Hard),
            Raw::Name(s) => match s.as_str() {
                "easy" => Ok(PlannedZone::Easy),
                "steady" => Ok(PlannedZone::Steady),
                "hard" => Ok(PlannedZone::Hard),
                _ => Err(bad()),
            },
            Raw::Num(_) => Err(bad()),
        }
    }
}

/// One planned exercise: `sets` working sets at `target_rpe` (8 when absent).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedExercise {
    /// Liftosaur exercise id.
    pub exercise_id: String,
    pub sets: f64,
    #[serde(default)]
    pub target_rpe: Option<f64>,
}

/// What is planned for one weekday.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PlannedDay {
    Rest,
    Lift {
        exercises: Vec<PlannedExercise>,
    },
    #[serde(rename_all = "camelCase")]
    Run {
        distance_m: f64,
        zone: PlannedZone,
    },
}

/// Load per weekday (index 0 is Monday, 6 is Sunday) and what could not be counted.
#[derive(Debug, Clone, PartialEq)]
pub struct WeekLoad {
    pub load: [f64; 7],
    /// One `unknown exercise: <id>` per distinct exercise id that is not in the library; such
    /// an exercise adds no load.
    pub warnings: Vec<String>,
}

fn require_non_negative(what: &str, x: f64) -> Result<f64, DerivedError> {
    if x.is_finite() && x >= 0.0 {
        Ok(x)
    } else {
        Err(DerivedError::Invalid(format!(
            "{what} must be a finite number of at least 0"
        )))
    }
}

/// The planned load for each weekday of a week (Monday first), in the same units as
/// [`session_load`].
///
/// A lift day adds, per exercise, `sets * set_factor(None, target_rpe) * (targets + 0.5 *
/// synergists)` with the muscles from the exercise library (`muscles::exercise_muscles`); a
/// missing target RPE counts as 8, which is a factor of 1. A run day adds [`run_load`] at the
/// planned zone. A rest day is 0. Errors with [`DerivedError::Invalid`] on negative or non-finite
/// sets, target RPE or distance.
pub fn planned_week_load(days: &[PlannedDay; 7]) -> Result<WeekLoad, DerivedError> {
    let mut load = [0.0; 7];
    let mut warnings = Vec::new();
    let mut unknown_seen = BTreeSet::new();
    for (i, day) in days.iter().enumerate() {
        match day {
            PlannedDay::Rest => {}
            PlannedDay::Run { distance_m, zone } => {
                load[i] = run_load(require_non_negative("distanceM", *distance_m)?, zone.z());
            }
            PlannedDay::Lift { exercises } => {
                for e in exercises {
                    let sets = require_non_negative("sets", e.sets)?;
                    if let Some(r) = e.target_rpe {
                        if !r.is_finite() {
                            return Err(DerivedError::Invalid(
                                "targetRpe must be a finite number".to_string(),
                            ));
                        }
                    }
                    match crate::muscles::exercise_muscles(&e.exercise_id) {
                        Some(m) => {
                            let muscles = m.targets.len() as f64 + 0.5 * m.synergists.len() as f64;
                            load[i] += sets * set_factor(None, e.target_rpe) * muscles;
                        }
                        None => {
                            if unknown_seen.insert(e.exercise_id.clone()) {
                                warnings.push(format!("unknown exercise: {}", e.exercise_id));
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(WeekLoad { load, warnings })
}

/// The load actually logged for each weekday of the week starting at `week_start` (Monday first).
///
/// `week_start` is a local `YYYY-MM-DD` key and must be a Monday ([`DerivedError::NotMonday`]
/// otherwise). The whole history is replayed through the adapter so a run gets the zone the
/// engine assigns it (from critical speed); each non-stub record then adds [`session_load`] to
/// the weekday of its local start date, taken in the offset the record's own `started_at`
/// carries. Records outside the week add nothing. Stubs add nothing. Check-ins play no part.
pub fn done_week_load(
    week_start: &str,
    records: &[SessionRecord],
    settings: &SettingsRecord,
) -> Result<WeekLoad, DerivedError> {
    let start_days = days_from_date_key(week_start)?;
    // `weekday_of_days` counts Sunday as 0, so Monday is 1.
    if weekday_of_days(start_days) != 1 {
        return Err(DerivedError::NotMonday(week_start.to_string()));
    }
    let timeline = build_timeline(records, &[], settings, &TimelineFilter::default())?;
    let mut state = timeline.initial_state();
    let mut load = [0.0; 7];
    for entry in &timeline.entries {
        apply_item(&mut state, &entry.item)?;
        let TimelineItem::Workout(w) = &entry.item else {
            continue;
        };
        let offset = days_from_date_key(&iso_local_date_key(w.date())?)? - start_days;
        if !(0..7).contains(&offset) {
            continue;
        }
        // The run just applied is the last entry of the run log.
        let z = state.runs.last().map_or(ZONE_STEADY, |r| r.z);
        load[offset as usize] += session_load(w, z);
    }
    Ok(WeekLoad {
        load,
        warnings: timeline.warnings,
    })
}

// ---------------------------------------------------------------------------------------------
// Weight trend
// ---------------------------------------------------------------------------------------------

/// Days in a trend window.
pub const TREND_WINDOW_DAYS: i64 = 7;

/// The latest 7 day window needs at least this many distinct days with a weight.
pub const TREND_MIN_DAYS: usize = 3;

/// A move of the rolling mean smaller than this, in kg, counts as flat.
pub const TREND_FLAT_KG: f64 = 0.05;

/// How far back the run of same-direction days is followed, in days.
pub const TREND_RUN_LOOKBACK_DAYS: i64 = 365;

/// Direction of the 7 day mean's latest daily move.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TrendDirection {
    Up,
    Down,
    Flat,
}

fn classify_move(delta_kg: f64) -> TrendDirection {
    if delta_kg.abs() < TREND_FLAT_KG {
        TrendDirection::Flat
    } else if delta_kg > 0.0 {
        TrendDirection::Up
    } else {
        TrendDirection::Down
    }
}

/// Body weight trend. No verdict and no goal: numbers only.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeightTrend {
    /// The most recent weight on or before `today` (the mean of that day's weights).
    pub latest_kg: f64,
    /// Mean of the day values in `[today - 6, today]`.
    #[serde(rename = "avg7Kg")]
    pub avg7_kg: f64,
    /// Mean of the day values in `[today - 13, today - 7]`; absent when that window is empty.
    #[serde(rename = "prevAvg7Kg", skip_serializing_if = "Option::is_none")]
    pub prev_avg7_kg: Option<f64>,
    /// `avg7_kg - prev_avg7_kg`. The two windows are 7 days apart, so this is kg per week.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta_per_week_kg: Option<f64>,
    /// Direction of the 7 day mean's move from yesterday to today ([`TREND_FLAT_KG`] threshold).
    pub direction: TrendDirection,
    /// How many consecutive days, ending today, the 7 day mean has moved in `direction`; 0 when
    /// `direction` is flat.
    pub run_days: u32,
}

/// Mean of the day values in `[end - 6, end]`, or `None` when fewer than `min_days` days have
/// one. Summed in date order.
fn window_mean(day_values: &BTreeMap<i64, f64>, end: i64, min_days: usize) -> Option<f64> {
    let (sum, n) = day_values
        .range(end - (TREND_WINDOW_DAYS - 1)..=end)
        .fold((0.0, 0usize), |(s, n), (_, v)| (s + v, n + 1));
    if n == 0 || n < min_days {
        None
    } else {
        Some(sum / n as f64)
    }
}

/// The body weight trend at local date `today`, or `None` when there is not enough data.
///
/// - **Day values.** Several weights on one date are averaged into one value for that date.
///   Weights dated after `today` are ignored. Windows are calendar days, `today` included:
///   the last window is `[today - 6, today]`, the previous one `[today - 13, today - 7]`.
/// - **Enough data.** The last window needs at least [`TREND_MIN_DAYS`] days with a value
///   (7 is not required); with fewer the result is `None`.
/// - **Means.** `avg7_kg` is the mean of the day values in the last window. `prev_avg7_kg` is
///   the mean of the previous window when at least one day in it has a value; without one,
///   `prev_avg7_kg` and `delta_per_week_kg` are absent and `latest_kg` and `avg7_kg` stay.
/// - **Rolling series.** For every date `d` the rolling mean is the window mean over
///   `[d - 6, d]`, defined when that window has at least [`TREND_MIN_DAYS`] days. `direction`
///   is the sign of today's rolling mean minus yesterday's, flat when its size is under
///   [`TREND_FLAT_KG`] or when either is undefined. `run_days` counts back from today while
///   each daily move has that same direction; a flat or undefined move ends the run, so a flat
///   direction gives 0. The count looks back at most [`TREND_RUN_LOOKBACK_DAYS`] days.
pub fn weight_trend(
    weights: &[BodyWeightRecord],
    today: &str,
) -> Result<Option<WeightTrend>, DerivedError> {
    let today_day = days_from_date_key(today)?;
    let mut sums: BTreeMap<i64, (f64, u32)> = BTreeMap::new();
    for w in weights {
        let day = days_from_date_key(&w.date)?;
        if !w.kg.is_finite() {
            return Err(DerivedError::NonFinite(format!("weight {}", w.id)));
        }
        if day <= today_day {
            let e = sums.entry(day).or_insert((0.0, 0));
            e.0 += w.kg;
            e.1 += 1;
        }
    }
    let day_values: BTreeMap<i64, f64> = sums
        .into_iter()
        .map(|(day, (sum, n))| (day, sum / f64::from(n)))
        .collect();

    let Some(avg7_kg) = window_mean(&day_values, today_day, TREND_MIN_DAYS) else {
        return Ok(None);
    };
    let Some((_, &latest_kg)) = day_values.range(..=today_day).next_back() else {
        return Ok(None);
    };
    let prev_avg7_kg = window_mean(&day_values, today_day - TREND_WINDOW_DAYS, 1);
    let delta_per_week_kg = prev_avg7_kg.map(|p| avg7_kg - p);

    let rolling = |d: i64| window_mean(&day_values, d, TREND_MIN_DAYS);
    let move_on = |d: i64| match (rolling(d), rolling(d - 1)) {
        (Some(now), Some(before)) => classify_move(now - before),
        _ => TrendDirection::Flat,
    };
    let direction = move_on(today_day);
    let mut run_days = 0u32;
    if direction != TrendDirection::Flat {
        for back in 0..TREND_RUN_LOOKBACK_DAYS {
            if move_on(today_day - back) != direction {
                break;
            }
            run_days += 1;
        }
    }
    Ok(Some(WeightTrend {
        latest_kg,
        avg7_kg,
        prev_avg7_kg,
        delta_per_week_kg,
        direction,
        run_days,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::records::{
        CheckInRecord, LiftEntryRecord, LiftSessionRecord, LiftSetRecord, RunRecord, Unit,
    };

    fn close(a: f64, e: f64, tol: f64) -> bool {
        (a - e).abs() <= tol * a.abs().max(e.abs()) + 1e-12
    }

    fn working_set(rpe: f64) -> LiftSetRecord {
        LiftSetRecord {
            weight: 225.0,
            unit: Unit::Lb,
            reps: 5.0,
            rpe: Some(rpe),
            target_rpe: None,
            completed: true,
            warmup: false,
            tested_1rm: false,
            joint_pain: false,
        }
    }

    fn lift(id: &str, at: &str, entries: Vec<(&str, Vec<LiftSetRecord>)>) -> SessionRecord {
        SessionRecord::Lift(LiftSessionRecord {
            id: id.to_string(),
            started_at: at.to_string(),
            program_day_index: None,
            stub: false,
            minutes: None,
            srpe: None,
            entries: entries
                .into_iter()
                .map(|(exercise_id, sets)| LiftEntryRecord {
                    exercise_id: exercise_id.to_string(),
                    sets,
                })
                .collect(),
        })
    }

    fn squats(id: &str, at: &str, sets: usize) -> SessionRecord {
        lift(id, at, vec![("squat", vec![working_set(8.0); sets])])
    }

    fn run(id: &str, at: &str, distance_m: f64, moving_sec: f64) -> SessionRecord {
        SessionRecord::Run(RunRecord {
            id: id.to_string(),
            started_at: at.to_string(),
            distance_m,
            moving_sec: Some(moving_sec),
            elapsed_sec: moving_sec,
            stub: false,
            srpe: None,
            minutes: None,
            hr_trimp: None,
            grade_profile: None,
            descent_m: None,
        })
    }

    fn checkin(id: &str, at: &str, recovery: f64, soreness: &[(&str, u8)]) -> CheckInRecord {
        CheckInRecord {
            id: id.to_string(),
            at: at.to_string(),
            recovery,
            soreness: soreness.iter().map(|(m, v)| (m.to_string(), *v)).collect(),
            note: None,
        }
    }

    fn lb() -> SettingsRecord {
        SettingsRecord::default()
    }

    // ---- ready_in and ready_dates ----

    #[test]
    fn ready_in_single_exponential_matches_the_closed_form() {
        // G = 8, tau 2.5: 8 exp(-t/2.5) = 2 at t = 2.5 ln 4.
        let r = ready_in(8.0, 0.0, 2.5);
        assert!(!r.capped);
        assert!((r.days - 2.5 * 4f64.ln()).abs() < 2e-6, "{}", r.days);
        // The reported time is on the ready side of the crossing.
        assert!(r.days >= 2.5 * 4f64.ln());
        // D only, tau 5: 8 exp(-t/5) = 2 at t = 5 ln 4.
        let r = ready_in(0.0, 8.0, 2.5);
        assert!((r.days - 5.0 * 4f64.ln()).abs() < 2e-6);
        // G = 4 with tau 2: 2 ln 2.
        let r = ready_in(4.0, 0.0, 2.0);
        assert!((r.days - 2.0 * 2f64.ln()).abs() < 2e-6);
    }

    #[test]
    fn ready_in_two_exponentials_lands_on_the_threshold() {
        let (g, d, tau) = (6.0, 5.0, 2.5);
        let r = ready_in(g, d, tau);
        assert!(!r.capped && r.days > 0.0);
        assert!(load_after(g, d, tau, r.days) <= READY_THRESHOLD);
        assert!(load_after(g, d, tau, r.days - 2.0 * READY_TOLERANCE_DAYS) > READY_THRESHOLD);
    }

    #[test]
    fn ready_in_edges() {
        // At or under the threshold already: ready now, not capped.
        assert_eq!(
            ready_in(2.0, 0.0, 2.5),
            ReadyIn {
                days: 0.0,
                capped: false
            }
        );
        assert_eq!(ready_in(0.0, 0.0, 2.0).days, 0.0);
        assert_eq!(ready_in(1.0, 1.0, 2.0).days, 0.0);
        // Just over: ready almost immediately.
        let r = ready_in(2.0001, 0.0, 2.5);
        assert!(r.days > 0.0 && r.days < 1e-3);
        // Still above 2 at day 21: capped. 1e4 exp(-21/2.5) = 2.25.
        let r = ready_in(1e4, 0.0, 2.5);
        assert_eq!(
            r,
            ReadyIn {
                days: READY_CAP_DAYS,
                capped: true
            }
        );
        // Just under that: found by bisection, not capped.
        let r = ready_in(8000.0, 0.0, 2.5);
        assert!(!r.capped && r.days < READY_CAP_DAYS && r.days > 20.0);
        // Damage decays slower than a 2 d muscle tau: 200 exp(-21/5) = 3.0 is capped.
        assert!(ready_in(0.0, 200.0, 2.0).capped);
    }

    #[test]
    fn ready_dates_sort_by_date_then_muscle_and_skip_ready_muscles() {
        let mut s = crate::engine::state::initial_state();
        s.updated = "2026-10-01T12:00:00Z".to_string();
        s.fatigue_muscle.insert("quads".to_string(), 8.0);
        s.fatigue_muscle.insert("glutes".to_string(), 4.0);
        s.fatigue_muscle.insert("calves".to_string(), 4.0);
        s.fatigue_muscle.insert("biceps".to_string(), 1.0);
        s.fatigue_muscle.insert("chest".to_string(), 8.0);
        let got = ready_dates(&s, "2026-10-01T12:00:00Z", 0).unwrap();
        let names: Vec<(&str, &str)> = got
            .iter()
            .map(|r| (r.date.as_str(), r.muscle.as_str()))
            .collect();
        // 2.5 ln 2 = 1.73 d -> Oct 3 (calves, glutes); chest tau 2: 2 ln 4 = 2.77 d -> Oct 4;
        // quads 2.5 ln 4 = 3.47 d -> Oct 4 (after chest by id).
        assert_eq!(
            names,
            vec![
                ("2026-10-03", "calves"),
                ("2026-10-03", "glutes"),
                ("2026-10-04", "chest"),
                ("2026-10-04", "quads"),
            ]
        );
        // Calves cross at 05:35 UTC on Oct 3 and quads at 23:11 UTC on Oct 4. At +14:00 the quads
        // date is Oct 5; at -14:00 the calves date is Oct 2.
        let east = ready_dates(&s, "2026-10-01T12:00:00Z", 14 * 60).unwrap();
        assert_eq!(
            east.iter().find(|r| r.muscle == "quads").unwrap().date,
            "2026-10-05"
        );
        let west = ready_dates(&s, "2026-10-01T12:00:00Z", -14 * 60).unwrap();
        assert_eq!(west[0].muscle, "calves");
        assert_eq!(west[0].date, "2026-10-02");
    }

    #[test]
    fn ready_dates_decay_to_now_and_never_backwards() {
        let mut s = crate::engine::state::initial_state();
        s.updated = "2026-10-01T12:00:00Z".to_string();
        s.fatigue_muscle.insert("quads".to_string(), 8.0);
        // Two days later quads is 8 exp(-0.8) = 3.59: ready 2.5 ln(3.59 / 2) = 1.46 d after now.
        let later = ready_dates(&s, "2026-10-03T12:00:00Z", 0).unwrap();
        assert_eq!(later.len(), 1);
        assert_eq!(later[0].date, "2026-10-04");
        // A `now` before `updated` reads the stored values: ready 3.47 d after `now`, which is
        // Oct 3 at 23:11 UTC.
        let before = ready_dates(&s, "2026-09-30T12:00:00Z", 0).unwrap();
        assert_eq!(before[0].date, "2026-10-03");
        // Once decayed under the threshold the muscle disappears.
        assert!(ready_dates(&s, "2026-10-09T12:00:00Z", 0)
            .unwrap()
            .is_empty());
        assert!(ready_dates(&s, "soon", 0).is_err());
    }

    #[test]
    fn ready_dates_report_the_cap() {
        let mut s = crate::engine::state::initial_state();
        s.updated = "2026-10-01T12:00:00Z".to_string();
        s.fatigue_muscle.insert("quads".to_string(), 1e5);
        let got = ready_dates(&s, "2026-10-01T12:00:00Z", 0).unwrap();
        assert_eq!(
            got,
            vec![ReadyDate {
                muscle: "quads".to_string(),
                date: "2026-10-22".to_string(),
                capped: true
            }]
        );
    }

    // ---- readiness_summary ----

    const NOW: &str = "2026-10-02T17:30:00-04:00";

    fn summary(
        records: &[SessionRecord],
        checkins: &[CheckInRecord],
        now: &str,
        muscles: Option<&[String]>,
    ) -> ReadinessSummary {
        readiness_summary(records, checkins, &lb(), now, -240, muscles).unwrap()
    }

    #[test]
    fn empty_history_is_fully_ready_with_no_average() {
        let s = summary(&[], &[], NOW, None);
        assert_eq!(s.today.score, 1.0);
        assert!(!s.checked_in_today);
        assert_eq!(s.average_28d, None);
        assert_eq!(s.checkin_count_28d, 0);
        assert!(s.ready_dates.is_empty());
        assert!(s.today.reasons.is_empty());
    }

    #[test]
    fn rest_day_checkins_average_their_scores() {
        let c = vec![
            checkin("c1", "2026-09-28T08:00:00-04:00", 7.0, &[]),
            checkin("c2", "2026-09-29T08:00:00-04:00", 7.0, &[]),
            checkin("c3", "2026-09-30T08:00:00-04:00", 3.0, &[]),
        ];
        // Scores 1.0, 1.0, 0.7: the third has a zero-spread history (z 0) and PRS <= 4.
        let s = summary(&[], &c, "2026-09-30T20:00:00-04:00", None);
        assert_eq!(s.checkin_count_28d, 3);
        assert!(close(s.average_28d.unwrap(), 0.9, 1e-12));
        assert!(s.checked_in_today);
        assert!(close(s.today.score, 0.7, 1e-12));
        assert_eq!(s.today.prs_z, Some(0.0));
        assert!(s.today.prs_flag);
        assert_eq!(s.today.reasons, vec!["prs-low"]);
        // The next day there is no check-in today: a fatigue-only estimate at the window's
        // mean recovery (17/3 = 5.67, above 4), so no PRS penalty.
        let next = summary(&[], &c, "2026-10-01T20:00:00-04:00", None);
        assert!(!next.checked_in_today);
        assert_eq!(next.today.score, 1.0);
        assert_eq!(next.checkin_count_28d, 3);
    }

    #[test]
    fn a_day_without_a_checkin_never_raises_the_prs_flag() {
        // Two earlier check-ins at 3 (each scores 0.7). With none today the estimate uses the
        // floor of 5 instead of the mean of 3, so there is no prs-low and no z-score flag.
        let c = vec![
            checkin("a", "2026-09-28T08:00:00-04:00", 3.0, &[]),
            checkin("b", "2026-09-29T08:00:00-04:00", 3.0, &[]),
        ];
        let s = summary(&[], &c, "2026-09-30T20:00:00-04:00", None);
        assert!(!s.checked_in_today);
        assert_eq!(s.today.score, 1.0);
        assert!(!s.today.prs_flag && s.today.reasons.is_empty());
        assert!(close(s.average_28d.unwrap(), 0.7, 1e-12));
        assert_eq!(s.checkin_count_28d, 2);
    }

    #[test]
    fn a_checkin_is_not_in_its_own_z_score_window() {
        // Three earlier check-ins at 7 and one today at 9. If today's own PRS were in the window
        // the history would be [7, 7, 7, 9] and z would be 1.5. Without it the history has no
        // spread, so z is 0.
        let c = vec![
            checkin("a", "2026-09-28T08:00:00-04:00", 7.0, &[]),
            checkin("b", "2026-09-29T08:00:00-04:00", 7.0, &[]),
            checkin("c", "2026-09-30T08:00:00-04:00", 7.0, &[]),
            checkin("d", "2026-10-02T08:00:00-04:00", 9.0, &[]),
        ];
        let s = summary(&[], &c, NOW, None);
        assert!(s.checked_in_today);
        assert_eq!(s.today.prs_z, Some(0.0));
        assert_eq!(s.today.score, 1.0);
    }

    #[test]
    fn today_decays_a_session_after_the_checkin_and_ignores_records_after_now() {
        // 8 working squat sets yesterday evening: quads 8, hamstrings/glutes/calves 4.
        let records = vec![squats("w", "2026-10-01T17:30:00-04:00", 8)];
        let muscles = vec!["quads".to_string()];
        let s = summary(&records, &[], NOW, Some(&muscles));
        // One day of decay: 8 exp(-1/2.5), local fatigue exp(-0.4), penalty 0.2 exp(-0.4).
        let g = 8.0 * (-0.4f64).exp();
        assert!(close(s.today.score, 1.0 - 0.2 * (g / 8.0), 1e-12));
        assert_eq!(s.today.reasons, vec!["local-fatigue"]);
        assert!(!s.checked_in_today);
        let names: Vec<&str> = s.ready_dates.iter().map(|r| r.muscle.as_str()).collect();
        assert_eq!(names, vec!["calves", "glutes", "hamstrings", "quads"]);
        // A session logged after `now` changes nothing, and does not switch decay off.
        let mut with_future = records.clone();
        with_future.push(squats("later", "2026-10-03T17:30:00-04:00", 8));
        assert_eq!(summary(&with_future, &[], NOW, Some(&muscles)), s);
    }

    #[test]
    fn checkin_with_soreness_blocks_and_uses_the_state_without_itself() {
        let records = vec![squats("w", "2026-10-01T17:30:00-04:00", 8)];
        let c = vec![checkin(
            "c",
            "2026-10-02T08:00:00-04:00",
            5.0,
            &[("quads", 4)],
        )];
        let s = summary(&records, &c, "2026-10-02T13:00:00-04:00", None);
        assert!(s.checked_in_today);
        assert_eq!(s.today.sore_blocked_muscles, vec!["quads"]);
        // 19.5 h after the session.
        let g = 8.0 * (-(19.5 / 24.0) / 2.5f64).exp();
        assert!(close(s.today.score, 1.0 - 0.2 - 0.2 * (g / 8.0), 1e-9));
        assert_eq!(s.today.reasons, vec!["sore-blocked:quads", "local-fatigue"]);
        // Its own score, 14.5 h after the session, is the 28 day average.
        let g_at = 8.0 * (-(14.5 / 24.0) / 2.5f64).exp();
        assert!(close(
            s.average_28d.unwrap(),
            1.0 - 0.2 - 0.2 * (g_at / 8.0),
            1e-9
        ));
        assert_eq!(s.checkin_count_28d, 1);
    }

    #[test]
    fn a_checkin_before_a_lift_is_scored_on_the_state_before_the_lift() {
        // Check-in 30 minutes before a heavy squat day: attached to the lift, but its score must
        // not include that day's fatigue.
        let records = vec![
            squats("w1", "2026-09-30T17:30:00-04:00", 8),
            squats("w2", "2026-10-02T17:30:00-04:00", 8),
        ];
        let c = vec![checkin(
            "c",
            "2026-10-02T17:00:00-04:00",
            8.0,
            &[("quads", 1)],
        )];
        let s = summary(&records, &c, "2026-10-02T18:30:00-04:00", None);
        let dt: f64 = 2.0 - 0.5 / 24.0;
        let g_before = 8.0 * (-dt / 2.5).exp();
        assert!(close(
            s.average_28d.unwrap(),
            1.0 - 0.2 * (g_before / 8.0),
            1e-9
        ));
        // Today at 18:30 does include the session: fatigue is higher, score lower.
        assert!(s.today.score < s.average_28d.unwrap());
        assert!(s.checked_in_today);
    }

    #[test]
    fn the_window_is_28_days_inclusive_and_ignores_the_future() {
        let now = "2026-10-29T12:00:00Z";
        let c = vec![
            checkin("edge", "2026-10-01T12:00:00Z", 7.0, &[]),
            checkin("old", "2026-10-01T11:59:59.999Z", 7.0, &[]),
            checkin("future", "2026-10-29T12:00:00.001Z", 7.0, &[]),
        ];
        let s = readiness_summary(&[], &c, &lb(), now, 0, None).unwrap();
        assert_eq!(s.checkin_count_28d, 1);
        assert!(!s.checked_in_today);
    }

    #[test]
    fn local_date_decides_what_today_is() {
        // 02:00 UTC on Oct 2 is still Oct 1 evening at -04:00, and the check-in (14:00 UTC on
        // Oct 1) is on Oct 1 in both zones.
        let c = vec![checkin("c", "2026-10-01T10:00:00-04:00", 7.0, &[])];
        let now = "2026-10-02T02:00:00Z";
        assert!(
            readiness_summary(&[], &c, &lb(), now, -240, None)
                .unwrap()
                .checked_in_today
        );
        assert!(
            !readiness_summary(&[], &c, &lb(), now, 0, None)
                .unwrap()
                .checked_in_today
        );
    }

    #[test]
    fn summary_errors_on_bad_dates() {
        assert!(readiness_summary(&[], &[], &lb(), "now", 0, None).is_err());
        let c = vec![checkin("c", "2026-02-30T08:00:00Z", 7.0, &[])];
        assert!(readiness_summary(&[], &c, &lb(), NOW, 0, None).is_err());
        let r = vec![squats("w", "2026-13-01T08:00:00Z", 3)];
        assert!(readiness_summary(&r, &[], &lb(), NOW, 0, None).is_err());
    }

    // ---- session and week load ----

    #[test]
    fn lift_session_load_counts_working_sets_only() {
        let mut warm = working_set(8.0);
        warm.warmup = true;
        let mut skipped = working_set(8.0);
        skipped.completed = false;
        let records = vec![lift(
            "a",
            "2026-10-01T17:30:00-04:00",
            vec![
                (
                    "squat",
                    vec![working_set(8.0), working_set(9.0), warm, skipped],
                ),
                ("benchPress", vec![working_set(7.0)]),
            ],
        )];
        let t = build_timeline(&records, &[], &lb(), &TimelineFilter::default()).unwrap();
        let TimelineItem::Workout(w) = &t.entries[0].item else {
            panic!("a workout")
        };
        // Squat: (1.0 + 1.1) per target-weight 1 + 3 * 0.5 = 2.5; bench: 0.9 * (1 + 2 * 0.5).
        assert!(close(
            session_load(w, ZONE_STEADY),
            2.1 * 2.5 + 0.9 * 2.0,
            1e-12
        ));
        // Cross-check against the fatigue the engine adds.
        let state = t.replay().unwrap();
        let total: f64 = state.fatigue_muscle.values().sum();
        assert!(close(total, session_load(w, ZONE_STEADY), 1e-12));
    }

    #[test]
    fn run_load_sums_the_four_muscles() {
        // 8 km at z 1: q = 1.44; calves 0.8 q, glutes 0.5 q, hamstrings 0.4 q.
        assert!(close(
            run_load(8000.0, ZONE_STEADY),
            1.44 * (1.0 + 0.8 + 0.5 + 0.4),
            1e-12
        ));
        // z 1.5 raises the hamstring share to 0.8: q = 0.18 * 1.5 * 12 = 3.24.
        assert!(close(
            run_load(12_000.0, ZONE_HARD),
            3.24 * (1.0 + 0.8 + 0.5 + 0.8),
            1e-12
        ));
        assert_eq!(run_load(0.0, ZONE_EASY), 0.0);
    }

    fn week(days: [PlannedDay; 7]) -> [PlannedDay; 7] {
        days
    }

    fn planned_lift(exercises: &[(&str, f64, Option<f64>)]) -> PlannedDay {
        PlannedDay::Lift {
            exercises: exercises
                .iter()
                .map(|(id, sets, rpe)| PlannedExercise {
                    exercise_id: id.to_string(),
                    sets: *sets,
                    target_rpe: *rpe,
                })
                .collect(),
        }
    }

    #[test]
    fn planned_week_load_per_weekday() {
        use PlannedDay::*;
        let planned = week([
            planned_lift(&[("squat", 3.0, None), ("benchPress", 3.0, Some(9.0))]),
            Rest,
            Run {
                distance_m: 8000.0,
                zone: PlannedZone::Steady,
            },
            Rest,
            planned_lift(&[("deadlift", 2.0, Some(8.0)), ("mysteryLift", 5.0, None)]),
            Run {
                distance_m: 12_000.0,
                zone: PlannedZone::Hard,
            },
            Rest,
        ]);
        let out = planned_week_load(&planned).unwrap();
        let expected = [
            3.0 * 2.5 + 3.0 * 1.1 * 2.0,
            0.0,
            1.44 * 2.7,
            0.0,
            2.0 * 2.5,
            3.24 * 3.1,
            0.0,
        ];
        for (a, e) in out.load.iter().zip(expected) {
            assert!(close(*a, e, 1e-12), "{a} vs {e}");
        }
        assert_eq!(out.warnings, vec!["unknown exercise: mysteryLift"]);
    }

    #[test]
    fn planned_week_load_rejects_unusable_numbers() {
        use PlannedDay::*;
        let with = |day: PlannedDay| {
            let mut days = [Rest, Rest, Rest, Rest, Rest, Rest, Rest];
            days[3] = day;
            planned_week_load(&days)
        };
        assert!(matches!(
            with(planned_lift(&[("squat", -1.0, None)])),
            Err(DerivedError::Invalid(_))
        ));
        assert!(matches!(
            with(planned_lift(&[("squat", f64::NAN, None)])),
            Err(DerivedError::Invalid(_))
        ));
        assert!(matches!(
            with(planned_lift(&[("squat", 3.0, Some(f64::INFINITY))])),
            Err(DerivedError::Invalid(_))
        ));
        assert!(matches!(
            with(Run {
                distance_m: -5.0,
                zone: PlannedZone::Easy
            }),
            Err(DerivedError::Invalid(_))
        ));
    }

    #[test]
    fn planned_json_shapes() {
        let days: Vec<PlannedDay> = serde_json::from_str(
            r#"[{"kind":"rest"},
                {"kind":"lift","exercises":[{"exerciseId":"squat","sets":3,"targetRpe":8.5},
                                            {"exerciseId":"benchPress","sets":4}]},
                {"kind":"run","distanceM":5000,"zone":0.5},
                {"kind":"run","distanceM":5000,"zone":1.0},
                {"kind":"run","distanceM":5000,"zone":"hard"},
                {"kind":"run","distanceM":5000,"zone":1.5,"extra":true},
                {"kind":"rest","note":"ignored"}]"#,
        )
        .unwrap();
        assert_eq!(days[0], PlannedDay::Rest);
        assert_eq!(
            days[1],
            planned_lift(&[("squat", 3.0, Some(8.5)), ("benchPress", 4.0, None)])
        );
        assert!(matches!(
            days[2],
            PlannedDay::Run {
                zone: PlannedZone::Easy,
                ..
            }
        ));
        assert!(matches!(
            days[3],
            PlannedDay::Run {
                zone: PlannedZone::Steady,
                ..
            }
        ));
        assert!(matches!(
            days[4],
            PlannedDay::Run {
                zone: PlannedZone::Hard,
                ..
            }
        ));
        assert!(matches!(
            days[5],
            PlannedDay::Run {
                zone: PlannedZone::Hard,
                ..
            }
        ));
        for bad in [
            r#"{"kind":"run","distanceM":5000,"zone":2.0}"#,
            r#"{"kind":"run","distanceM":5000,"zone":"fast"}"#,
            r#"{"kind":"run","distanceM":5000}"#,
            r#"{"kind":"swim"}"#,
            r#"{"kind":"lift"}"#,
            r#"{"exercises":[]}"#,
        ] {
            assert!(serde_json::from_str::<PlannedDay>(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn done_week_load_buckets_by_the_local_date_of_each_record() {
        let records = vec![
            // Sunday before the week: ignored.
            squats("before", "2026-09-13T20:00:00-04:00", 5),
            // Monday.
            squats("mon", "2026-09-14T17:30:00-04:00", 3),
            // Tuesday stub: nothing.
            SessionRecord::Lift(LiftSessionRecord {
                id: "stub".to_string(),
                started_at: "2026-09-15T08:00:00-04:00".to_string(),
                program_day_index: Some(1),
                stub: true,
                minutes: None,
                srpe: None,
                entries: vec![],
            }),
            // Sunday evening local, which is Monday 02:00 UTC: still the Sunday of this week.
            lift(
                "sun",
                "2026-09-20T22:00:00-04:00",
                vec![("deadlift", vec![working_set(7.0)])],
            ),
            // The Monday after: ignored.
            squats("after", "2026-09-21T00:30:00-04:00", 5),
        ];
        let out = done_week_load("2026-09-14", &records, &lb()).unwrap();
        let expected = [7.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.9 * 2.5];
        for (a, e) in out.load.iter().zip(expected) {
            assert!(close(*a, e, 1e-12), "{:?}", out.load);
        }
        assert!(out.warnings.is_empty());
    }

    #[test]
    fn done_runs_use_the_zone_the_engine_assigned() {
        // Critical speed needs best efforts at 400, 800 and 5000 m: here about 4.1 m/s. The first
        // three runs have no critical speed yet and count as steady; an 8 km run at 2 m/s is
        // easy; a 3 km run at 6.25 m/s is hard.
        let records = vec![
            run("r1", "2026-09-14T06:00:00-04:00", 400.0, 80.0),
            run("r2", "2026-09-15T06:00:00-04:00", 800.0, 170.0),
            run("r3", "2026-09-16T06:00:00-04:00", 5000.0, 1200.0),
            run("r4", "2026-09-17T06:00:00-04:00", 8000.0, 4000.0),
            run("r5", "2026-09-18T06:00:00-04:00", 3000.0, 480.0),
        ];
        let out = done_week_load("2026-09-14", &records, &lb()).unwrap();
        let state = build_timeline(&records, &[], &lb(), &TimelineFilter::default())
            .unwrap()
            .replay()
            .unwrap();
        let zones: Vec<f64> = state.runs.iter().map(|r| r.z).collect();
        assert_eq!(zones, vec![1.0, 1.0, 1.0, 0.5, 1.5]);
        let expected = [
            run_load(400.0, ZONE_STEADY),
            run_load(800.0, ZONE_STEADY),
            run_load(5000.0, ZONE_STEADY),
            run_load(8000.0, ZONE_EASY),
            run_load(3000.0, ZONE_HARD),
            0.0,
            0.0,
        ];
        for (a, e) in out.load.iter().zip(expected) {
            assert!(close(*a, e, 1e-12), "{:?}", out.load);
        }
    }

    #[test]
    fn done_week_load_checks_its_dates() {
        let r = vec![squats("a", "2026-09-14T17:30:00-04:00", 3)];
        // 2026-09-15 is a Tuesday, 2026-09-13 a Sunday.
        assert_eq!(
            done_week_load("2026-09-15", &r, &lb()),
            Err(DerivedError::NotMonday("2026-09-15".to_string()))
        );
        assert!(matches!(
            done_week_load("2026-09-13", &r, &lb()),
            Err(DerivedError::NotMonday(_))
        ));
        assert!(matches!(
            done_week_load("2026-09-31", &r, &lb()),
            Err(DerivedError::Time(_))
        ));
        let bad = vec![squats("a", "later", 3)];
        assert!(matches!(
            done_week_load("2026-09-14", &bad, &lb()),
            Err(DerivedError::Adapter(_))
        ));
        let none = done_week_load("2026-09-14", &[], &lb()).unwrap();
        assert_eq!(none.load, [0.0; 7]);
    }

    // ---- weight trend ----

    fn weights(start: &str, kgs: &[f64]) -> Vec<BodyWeightRecord> {
        kgs.iter()
            .enumerate()
            .map(|(i, kg)| BodyWeightRecord {
                id: format!("w{i}"),
                date: crate::time::try_add_days_key(start, i as i64).unwrap(),
                kg: *kg,
            })
            .collect()
    }

    #[test]
    fn steady_loss_has_means_delta_and_a_run() {
        // 14 daily weights, 0.15 kg lighter each day, ending on `today`.
        let kgs: Vec<f64> = (0..14).map(|k| 82.0 - 0.15 * f64::from(k)).collect();
        let t = weight_trend(&weights("2026-10-01", &kgs), "2026-10-14")
            .unwrap()
            .unwrap();
        assert!(close(t.latest_kg, 80.05, 1e-12));
        assert!(close(t.avg7_kg, 80.5, 1e-12));
        assert!(close(t.prev_avg7_kg.unwrap(), 81.55, 1e-12));
        assert!(close(t.delta_per_week_kg.unwrap(), -1.05, 1e-12));
        assert_eq!(t.direction, TrendDirection::Down);
        // Rolling means are defined from Oct 3 (3 weights); their moves from Oct 4 to Oct 14.
        assert_eq!(t.run_days, 11);
    }

    #[test]
    fn small_moves_are_flat_and_larger_ones_start_a_run() {
        let mut kgs = vec![80.0; 14];
        kgs[13] = 80.28;
        let t = weight_trend(&weights("2026-10-01", &kgs), "2026-10-14")
            .unwrap()
            .unwrap();
        // The mean moves 0.04 kg: flat, so no run, but the numbers are still reported.
        assert_eq!(t.direction, TrendDirection::Flat);
        assert_eq!(t.run_days, 0);
        assert!(close(t.delta_per_week_kg.unwrap(), 0.04, 1e-9));
        kgs[13] = 80.42;
        let t = weight_trend(&weights("2026-10-01", &kgs), "2026-10-14")
            .unwrap()
            .unwrap();
        assert_eq!(t.direction, TrendDirection::Up);
        // Yesterday's move was 0, so the run is today alone.
        assert_eq!(t.run_days, 1);
        assert!(close(t.avg7_kg, 80.06, 1e-9));
    }

    #[test]
    fn needs_three_days_in_the_last_week() {
        let two = vec![
            BodyWeightRecord {
                id: "a".into(),
                date: "2026-10-12".into(),
                kg: 80.0,
            },
            BodyWeightRecord {
                id: "b".into(),
                date: "2026-10-14".into(),
                kg: 80.2,
            },
        ];
        assert_eq!(weight_trend(&two, "2026-10-14").unwrap(), None);
        assert_eq!(weight_trend(&[], "2026-10-14").unwrap(), None);
        // Three weights on one day are one day.
        let same_day: Vec<BodyWeightRecord> = (0..3)
            .map(|i| BodyWeightRecord {
                id: format!("d{i}"),
                date: "2026-10-14".into(),
                kg: 80.0,
            })
            .collect();
        assert_eq!(weight_trend(&same_day, "2026-10-14").unwrap(), None);
        // Old weights do not count toward the last week.
        let old = weights("2026-09-01", &[80.0, 80.1, 80.2, 80.3]);
        assert_eq!(weight_trend(&old, "2026-10-14").unwrap(), None);
    }

    #[test]
    fn three_days_without_a_previous_window() {
        let w = vec![
            BodyWeightRecord {
                id: "a".into(),
                date: "2026-10-10".into(),
                kg: 80.0,
            },
            BodyWeightRecord {
                id: "b".into(),
                date: "2026-10-12".into(),
                kg: 80.6,
            },
            BodyWeightRecord {
                id: "c".into(),
                date: "2026-10-14".into(),
                kg: 80.4,
            },
        ];
        let t = weight_trend(&w, "2026-10-14").unwrap().unwrap();
        assert_eq!(t.latest_kg, 80.4);
        assert!(close(t.avg7_kg, 241.0 / 3.0, 1e-12));
        assert_eq!(t.prev_avg7_kg, None);
        assert_eq!(t.delta_per_week_kg, None);
        // Yesterday's rolling window has two weights: undefined, so flat.
        assert_eq!(t.direction, TrendDirection::Flat);
        assert_eq!(t.run_days, 0);
        let v = serde_json::to_value(&t).unwrap();
        assert!(v.get("prevAvg7Kg").is_none() && v.get("deltaPerWeekKg").is_none());
        assert_eq!(v["direction"], "flat");
    }

    #[test]
    fn a_single_weight_in_the_previous_window_is_enough() {
        let mut w = weights("2026-10-08", &[80.0, 80.0, 80.0]);
        w.push(BodyWeightRecord {
            id: "old".into(),
            date: "2026-10-02".into(),
            kg: 81.0,
        });
        let t = weight_trend(&w, "2026-10-14").unwrap().unwrap();
        assert_eq!(t.prev_avg7_kg, Some(81.0));
        assert!(close(t.delta_per_week_kg.unwrap(), -1.0, 1e-12));
    }

    #[test]
    fn same_day_weights_are_averaged_and_future_ones_ignored() {
        let mut w = weights("2026-10-12", &[80.0, 80.0, 80.0]);
        w.push(BodyWeightRecord {
            id: "x".into(),
            date: "2026-10-14".into(),
            kg: 82.0,
        });
        w.push(BodyWeightRecord {
            id: "future".into(),
            date: "2026-10-15".into(),
            kg: 99.0,
        });
        let t = weight_trend(&w, "2026-10-14").unwrap().unwrap();
        // Oct 14 is the mean of 80 and 82; Oct 15 is ignored.
        assert_eq!(t.latest_kg, 81.0);
        assert!(close(t.avg7_kg, (80.0 + 80.0 + 81.0) / 3.0, 1e-12));
    }

    #[test]
    fn weight_trend_errors() {
        let w = weights("2026-10-12", &[80.0, 80.0, 80.0]);
        assert!(weight_trend(&w, "tomorrow").is_err());
        assert!(weight_trend(&w, "2026-10-32").is_err());
        let mut bad = w.clone();
        bad[1].date = "2026-02-30".into();
        assert!(weight_trend(&bad, "2026-10-14").is_err());
        let mut nan = w;
        nan[0].kg = f64::NAN;
        assert!(matches!(
            weight_trend(&nan, "2026-10-14"),
            Err(DerivedError::NonFinite(_))
        ));
    }
}
