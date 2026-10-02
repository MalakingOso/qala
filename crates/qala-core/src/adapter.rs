//! Stored records to engine state (docs/PLAN-m1-rust-core.md, "Adapter").
//!
//! The phone stores `SessionRecord`s and `CheckInRecord`s; the engine reads `Workout`s. This
//! module converts one into the other and replays the result. Everything here is pure: dates are
//! parsed with `time::parse_iso` and an unparseable one is an error, never a silent NaN.
//!
//! Choices beyond the plan doc, all deliberate:
//!
//! - Check-ins are separate records. A check-in is taken before training, so it attaches to the
//!   non-stub lift session whose start is the closest one at or after it, provided the gap is at
//!   most [`CHECKIN_ATTACH_WINDOW_MS`] (3 hours, compared in integer milliseconds, so exactly 3
//!   hours attaches and one millisecond more does not). The plan doc says "closest before"; the
//!   task text reverses it and this module follows the task.
//! - A check-in with no such lift (rest day, only a run nearby, only a stub nearby) is applied
//!   standalone, at its own time, through [`apply_standalone_checkin`]. When two check-ins pick
//!   the same lift, the later one (then the greater id) attaches and the other is standalone.
//! - The replay starts from `initial_state_with(settings.main_lifts)` and drives
//!   `log_session_mut` directly instead of `calibrate`, which would start from the TS default
//!   main lifts. Every entry carries an explicit `is_main`, so main-lift detection never reads
//!   `state.main_lifts`.
//! - Weights in the settings unit pass through untouched. A set in the other unit is converted
//!   with the exact factor 0.45359237 (kg to lb divides, it does not multiply by 2.2046226218 as
//!   `packages/core/units.ts` does) and rounded to 4 decimals.

use crate::engine::decay::decay_all;
use crate::engine::session::{apply_checkin, log_session_mut};
use crate::engine::state::{
    initial_state_with, Checkin, EngineState, GradeSegment, LiftEntry, LiftWorkout, RunWorkout,
    SetLog, Workout,
};
use crate::js::{js_max, js_round};
use crate::muscles::exercise_muscles;
use crate::records::{
    CheckInRecord, LiftSessionRecord, RunRecord, SessionRecord, SettingsRecord, Unit,
};
use crate::time::{days_between, local_date_key, parse_iso, TimeError};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

/// Kilograms per pound, exact by definition.
pub const KG_PER_LB: f64 = 0.45359237;

/// How far ahead of a lift session a check-in may be and still attach to it: 3 hours.
pub const CHECKIN_ATTACH_WINDOW_MS: i64 = 3 * 3_600_000;

/// Converted weights are rounded to this many steps per unit (4 decimals).
const WEIGHT_STEPS: f64 = 10_000.0;

/// Why a record could not be turned into engine input.
#[derive(Debug, Clone, PartialEq)]
pub enum AdapterError {
    /// A record's date did not parse.
    Time(TimeError),
    /// A numeric field was NaN or infinite. Carries `"<record id>: <field>"`.
    NonFinite(String),
}

impl fmt::Display for AdapterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AdapterError::Time(e) => e.fmt(f),
            AdapterError::NonFinite(what) => write!(f, "{what} is not a finite number"),
        }
    }
}

impl std::error::Error for AdapterError {}

impl From<TimeError> for AdapterError {
    fn from(e: TimeError) -> Self {
        AdapterError::Time(e)
    }
}

/// The engine state after replaying the history, plus anything the adapter could not map.
#[derive(Debug, Clone, PartialEq)]
pub struct AdapterOutput {
    pub state: EngineState,
    /// One `unknown exercise: <id>` per distinct exercise id missing from the library, in the
    /// order the ids first appear in the history.
    pub warnings: Vec<String>,
}

/// A weight converted between units: `lb` to `kg` multiplies by [`KG_PER_LB`], `kg` to `lb`
/// divides by it, and the result is rounded to 4 decimals with `js_round`. The same unit on both
/// sides returns the weight unchanged.
pub fn convert_weight(weight: f64, from: Unit, to: Unit) -> f64 {
    let converted = match (from, to) {
        (Unit::Lb, Unit::Kg) => weight * KG_PER_LB,
        (Unit::Kg, Unit::Lb) => weight / KG_PER_LB,
        _ => return weight,
    };
    js_round(converted * WEIGHT_STEPS) / WEIGHT_STEPS
}

fn finite(id: &str, field: &str, x: f64) -> Result<f64, AdapterError> {
    if x.is_finite() {
        Ok(x)
    } else {
        Err(AdapterError::NonFinite(format!("{id}: {field}")))
    }
}

fn finite_opt(id: &str, field: &str, x: Option<f64>) -> Result<Option<f64>, AdapterError> {
    x.map(|v| finite(id, field, v)).transpose()
}

/// The UTC offset in minutes written in an ISO instant: `Z` and a bare date are 0, `-04:00` is
/// -240. Errors when the instant does not parse.
pub fn iso_offset_minutes(iso: &str) -> Result<i64, TimeError> {
    parse_iso(iso)?;
    let b = iso.as_bytes();
    // A validated instant ends in `Z`, `+HH:MM` or `-HH:MM` after its `T`; a bare date has none.
    if !b.contains(&b'T') {
        return Ok(0);
    }
    let n = b.len();
    if b.last() == Some(&b'Z') {
        return Ok(0);
    }
    let digit = |i: usize| b.get(i).map(|c| i64::from(c.wrapping_sub(b'0')));
    let tail = n.checked_sub(6).and_then(|s| {
        let sign = *b.get(s)?;
        let minutes =
            (digit(s + 1)? * 10 + digit(s + 2)?) * 60 + digit(s + 4)? * 10 + digit(s + 5)?;
        Some(if sign == b'-' { -minutes } else { minutes })
    });
    // `None` cannot happen after `parse_iso` succeeded; it is an error rather than a guess.
    tail.ok_or_else(|| TimeError {
        input: iso.to_string(),
        reason: "unreadable UTC offset",
    })
}

/// The local `YYYY-MM-DD` date of an ISO instant in the offset the string itself carries.
pub fn iso_local_date_key(iso: &str) -> Result<String, TimeError> {
    let ms = parse_iso(iso)?;
    Ok(local_date_key(ms, iso_offset_minutes(iso)?))
}

/// A check-in applied on its own because no lift session claimed it.
#[derive(Debug, Clone, PartialEq)]
pub struct StandaloneCheckin {
    pub id: String,
    /// The check-in's own instant, kept verbatim.
    pub at: String,
    pub checkin: Checkin,
}

/// One step of the replay.
#[derive(Debug, Clone, PartialEq)]
pub enum TimelineItem {
    Workout(Workout),
    Checkin(StandaloneCheckin),
}

/// A replay step and its instant (epoch milliseconds).
#[derive(Debug, Clone, PartialEq)]
pub struct TimelineEntry {
    pub ms: i64,
    pub item: TimelineItem,
}

/// The history as a chronological list of replay steps.
///
/// Order: by instant; at equal instants a standalone check-in comes before a workout (a check-in
/// is taken before training), then by record id.
#[derive(Debug, Clone, PartialEq)]
pub struct Timeline {
    pub entries: Vec<TimelineEntry>,
    pub warnings: Vec<String>,
    /// `settings.main_lifts`, the starting point of every replay.
    pub main_lifts: Vec<String>,
}

/// Narrows the history before the timeline is built.
#[derive(Debug, Clone, Copy, Default)]
pub struct TimelineFilter<'a> {
    /// Drop sessions and check-ins that start after this instant.
    pub until_ms: Option<i64>,
    /// Drop the check-in with this id, as if it had never been recorded.
    pub skip_checkin_id: Option<&'a str>,
}

/// A parsed check-in record.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedCheckin {
    pub ms: i64,
    pub id: String,
    pub at: String,
    pub recovery: f64,
    pub checkin: Checkin,
}

/// Parses and orders check-in records by instant, then id. `recovery` becomes `Checkin.prs` and
/// the u8 soreness grades become f64.
pub fn parse_checkins(checkins: &[CheckInRecord]) -> Result<Vec<ParsedCheckin>, AdapterError> {
    let mut out = Vec::with_capacity(checkins.len());
    for c in checkins {
        let ms = parse_iso(&c.at)?;
        let prs = finite(&c.id, "recovery", c.recovery)?;
        out.push(ParsedCheckin {
            ms,
            id: c.id.clone(),
            at: c.at.clone(),
            recovery: prs,
            checkin: Checkin {
                prs,
                soreness: c
                    .soreness
                    .iter()
                    .map(|(m, v)| (m.clone(), f64::from(*v)))
                    .collect::<BTreeMap<_, _>>(),
            },
        });
    }
    out.sort_by(|a, b| (a.ms, &a.id).cmp(&(b.ms, &b.id)));
    Ok(out)
}

fn lift_to_workout(
    rec: &LiftSessionRecord,
    settings: &SettingsRecord,
    warnings: &mut Vec<String>,
    unknown_seen: &mut BTreeSet<String>,
) -> Result<LiftWorkout, AdapterError> {
    let mut entries = Vec::with_capacity(rec.entries.len());
    for e in &rec.entries {
        let muscles = match exercise_muscles(&e.exercise_id) {
            Some(m) => m,
            None => {
                if unknown_seen.insert(e.exercise_id.clone()) {
                    warnings.push(format!("unknown exercise: {}", e.exercise_id));
                }
                Default::default()
            }
        };
        let mut sets = Vec::with_capacity(e.sets.len());
        for s in &e.sets {
            let weight = finite(&rec.id, "weight", s.weight)?;
            sets.push(SetLog {
                w: convert_weight(weight, s.unit, settings.unit),
                r: finite(&rec.id, "reps", s.reps)?,
                rpe: finite_opt(&rec.id, "rpe", s.rpe)?,
                target_rpe: finite_opt(&rec.id, "targetRpe", s.target_rpe)?,
                target_reps_min: None,
                target_reps_max: None,
                completed: s.completed,
                warmup: s.warmup,
                tested1rm: s.tested_1rm,
                joint_pain: s.joint_pain,
            });
        }
        entries.push(LiftEntry {
            exercise_id: e.exercise_id.clone(),
            targets: muscles.targets,
            synergists: muscles.synergists,
            sets,
            is_main: Some(settings.main_lifts.iter().any(|m| m == &e.exercise_id)),
        });
    }
    Ok(LiftWorkout {
        id: rec.id.clone(),
        date: rec.started_at.clone(),
        entries,
        checkin: None,
        perf: None,
        srpe: finite_opt(&rec.id, "srpe", rec.srpe)?,
        minutes: finite_opt(&rec.id, "minutes", rec.minutes)?,
    })
}

fn run_to_workout(rec: &RunRecord) -> Result<RunWorkout, AdapterError> {
    let id = &rec.id;
    Ok(RunWorkout {
        id: id.clone(),
        date: rec.started_at.clone(),
        distance_m: finite(id, "distanceM", rec.distance_m)?,
        moving_sec: finite(id, "movingSec", rec.moving_or_elapsed_sec())?,
        elapsed_sec: finite(id, "elapsedSec", rec.elapsed_sec)?,
        grade_profile: match &rec.grade_profile {
            Some(profile) => {
                let mut out = Vec::with_capacity(profile.len());
                for g in profile {
                    out.push(GradeSegment {
                        grade: finite(id, "gradeProfile.grade", g.grade)?,
                        meters: finite(id, "gradeProfile.meters", g.meters)?,
                    });
                }
                Some(out)
            }
            None => None,
        },
        descent_m: finite_opt(id, "descentM", rec.descent_m)?,
        srpe: finite_opt(id, "srpe", rec.srpe)?,
        minutes: finite_opt(id, "minutes", rec.minutes)?,
        hr_trimp: finite_opt(id, "hrTrimp", rec.hr_trimp)?,
    })
}

/// Builds the replay timeline: converts the non-stub sessions, attaches or frees each check-in,
/// and merges the two in chronological order. See the module docs for the rules.
pub fn build_timeline(
    records: &[SessionRecord],
    checkins: &[CheckInRecord],
    settings: &SettingsRecord,
    filter: &TimelineFilter<'_>,
) -> Result<Timeline, AdapterError> {
    // Stubs add nothing to the engine, so their dates are never read.
    let mut sessions: Vec<(i64, &SessionRecord)> = Vec::new();
    for r in records.iter().filter(|r| !r.is_stub()) {
        let ms = parse_iso(r.started_at())?;
        if filter.until_ms.is_none_or(|limit| ms <= limit) {
            sessions.push((ms, r));
        }
    }
    sessions.sort_by(|a, b| (a.0, a.1.id()).cmp(&(b.0, b.1.id())));

    let mut warnings = Vec::new();
    let mut unknown_seen = BTreeSet::new();
    let mut workouts: Vec<(i64, Workout)> = Vec::with_capacity(sessions.len());
    for (ms, r) in sessions {
        let w = match r {
            SessionRecord::Lift(l) => Workout::Lift(lift_to_workout(
                l,
                settings,
                &mut warnings,
                &mut unknown_seen,
            )?),
            SessionRecord::Run(run) => Workout::Run(run_to_workout(run)?),
        };
        workouts.push((ms, w));
    }

    let parsed: Vec<ParsedCheckin> = parse_checkins(checkins)?
        .into_iter()
        .filter(|c| filter.until_ms.is_none_or(|limit| c.ms <= limit))
        .filter(|c| filter.skip_checkin_id != Some(c.id.as_str()))
        .collect();

    // Lift sessions in order, as positions into `workouts`, for the attach search.
    let lifts: Vec<usize> = workouts
        .iter()
        .enumerate()
        .filter(|(_, (_, w))| matches!(w, Workout::Lift(_)))
        .map(|(i, _)| i)
        .collect();
    // workout position -> check-in position. Check-ins arrive in ascending order, so a later
    // claim is closer (or equal and later by id) and replaces the earlier one.
    let mut claims: BTreeMap<usize, usize> = BTreeMap::new();
    for (ci, c) in parsed.iter().enumerate() {
        let first = lifts.partition_point(|&wi| workouts[wi].0 < c.ms);
        if let Some(&wi) = lifts.get(first) {
            if workouts[wi].0 - c.ms <= CHECKIN_ATTACH_WINDOW_MS {
                claims.insert(wi, ci);
            }
        }
    }
    let attached: BTreeSet<usize> = claims.values().copied().collect();
    for (wi, ci) in &claims {
        if let Workout::Lift(l) = &mut workouts[*wi].1 {
            l.checkin = Some(parsed[*ci].checkin.clone());
        }
    }

    // Rank 0 for a standalone check-in, 1 for a workout: at one instant the check-in goes first.
    let mut keyed: Vec<(i64, u8, String, TimelineItem)> = Vec::new();
    for (ms, w) in workouts {
        keyed.push((ms, 1, w.id().to_string(), TimelineItem::Workout(w)));
    }
    for (ci, c) in parsed.into_iter().enumerate() {
        if attached.contains(&ci) {
            continue;
        }
        keyed.push((
            c.ms,
            0,
            c.id.clone(),
            TimelineItem::Checkin(StandaloneCheckin {
                id: c.id,
                at: c.at,
                checkin: c.checkin,
            }),
        ));
    }
    keyed.sort_by(|a, b| (a.0, a.1, &a.2).cmp(&(b.0, b.1, &b.2)));

    Ok(Timeline {
        entries: keyed
            .into_iter()
            .map(|(ms, _, _, item)| TimelineEntry { ms, item })
            .collect(),
        warnings,
        main_lifts: settings.main_lifts.clone(),
    })
}

/// A check-in that no lift session claimed: decay the state to the check-in's instant (never
/// backwards) exactly like a workout does, record the check-in, and stamp `updated`. Errors, with
/// `s` untouched, when `s.updated` or `at` does not parse.
pub fn apply_standalone_checkin(
    s: &mut EngineState,
    at: &str,
    checkin: &Checkin,
) -> Result<(), TimeError> {
    let dt = days_between(&s.updated, at)?;
    decay_all(s, js_max(0.0, dt));
    apply_checkin(s, at, checkin);
    s.updated = at.to_string();
    Ok(())
}

/// Applies one replay step to `s`.
pub fn apply_item(s: &mut EngineState, item: &TimelineItem) -> Result<(), AdapterError> {
    match item {
        TimelineItem::Workout(w) => log_session_mut(s, w)?,
        TimelineItem::Checkin(c) => apply_standalone_checkin(s, &c.at, &c.checkin)?,
    }
    Ok(())
}

impl Timeline {
    /// The state a replay starts from: `initial_state_with(main_lifts)`.
    pub fn initial_state(&self) -> EngineState {
        initial_state_with(&self.main_lifts)
    }

    /// Replays every step from the initial state.
    pub fn replay(&self) -> Result<EngineState, AdapterError> {
        let mut s = self.initial_state();
        for entry in &self.entries {
            apply_item(&mut s, &entry.item)?;
        }
        Ok(s)
    }
}

/// Replays the stored history into an engine state.
///
/// Sessions are ordered by start instant (ties by id), stubs are dropped, check-ins are attached
/// to the lift they precede or applied standalone, and the result is the state after the last
/// step. An empty history gives `initial_state_with(settings.main_lifts)`.
pub fn build_engine_state(
    records: &[SessionRecord],
    checkins: &[CheckInRecord],
    settings: &SettingsRecord,
) -> Result<AdapterOutput, AdapterError> {
    let timeline = build_timeline(records, checkins, settings, &TimelineFilter::default())?;
    let state = timeline.replay()?;
    Ok(AdapterOutput {
        state,
        warnings: timeline.warnings,
    })
}

/// The `program_day_index` of every lift record that has one, stubs included, in chronological
/// order (ties by id). Today's sequencing counts a stub as a logged day. Records carry no
/// deleted flag, so the caller removes deleted ones first. Errors on an unparseable date.
pub fn logged_program_days(records: &[SessionRecord]) -> Result<Vec<u32>, AdapterError> {
    let mut days: Vec<(i64, &str, u32)> = Vec::new();
    for r in records {
        if let SessionRecord::Lift(l) = r {
            if let Some(index) = l.program_day_index {
                days.push((parse_iso(&l.started_at)?, &l.id, index));
            }
        }
    }
    days.sort_by(|a, b| (a.0, a.1).cmp(&(b.0, b.1)));
    Ok(days.into_iter().map(|(_, _, index)| index).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::session::calibrate;
    use crate::engine::state::initial_state_with;
    use crate::records::{GradeSegment as RecordGrade, LiftEntryRecord, LiftSetRecord};
    use crate::time::try_add_days_key;

    fn set(weight: f64, unit: Unit, reps: f64, rpe: Option<f64>) -> LiftSetRecord {
        LiftSetRecord {
            weight,
            unit,
            reps,
            rpe,
            target_rpe: None,
            completed: true,
            warmup: false,
            tested_1rm: false,
            joint_pain: false,
        }
    }

    fn entry(exercise_id: &str, sets: Vec<LiftSetRecord>) -> LiftEntryRecord {
        LiftEntryRecord {
            exercise_id: exercise_id.to_string(),
            sets,
        }
    }

    fn lift(id: &str, started_at: &str, entries: Vec<LiftEntryRecord>) -> SessionRecord {
        SessionRecord::Lift(LiftSessionRecord {
            id: id.to_string(),
            started_at: started_at.to_string(),
            program_day_index: None,
            stub: false,
            minutes: None,
            srpe: None,
            entries,
        })
    }

    fn run(id: &str, started_at: &str, distance_m: f64) -> RunRecord {
        RunRecord {
            id: id.to_string(),
            started_at: started_at.to_string(),
            distance_m,
            moving_sec: Some(distance_m * 0.3),
            elapsed_sec: distance_m * 0.3 + 30.0,
            stub: false,
            srpe: None,
            minutes: None,
            hr_trimp: None,
            grade_profile: None,
            descent_m: None,
        }
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

    fn squat_session(id: &str, at: &str) -> SessionRecord {
        lift(
            id,
            at,
            vec![entry("squat", vec![set(225.0, Unit::Lb, 5.0, Some(8.0))])],
        )
    }

    fn timeline(records: &[SessionRecord], checkins: &[CheckInRecord]) -> Timeline {
        build_timeline(records, checkins, &lb(), &TimelineFilter::default()).unwrap()
    }

    fn workout_of(t: &Timeline, id: &str) -> LiftWorkout {
        t.entries
            .iter()
            .find_map(|e| match &e.item {
                TimelineItem::Workout(Workout::Lift(w)) if w.id == id => Some(w.clone()),
                _ => None,
            })
            .expect("workout in timeline")
    }

    fn standalone_ids(t: &Timeline) -> Vec<String> {
        t.entries
            .iter()
            .filter_map(|e| match &e.item {
                TimelineItem::Checkin(c) => Some(c.id.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn weights_convert_both_ways_with_the_exact_factor() {
        // 225 * 0.45359237 = 102.05828325, rounded to 4 decimals.
        assert_eq!(convert_weight(225.0, Unit::Lb, Unit::Kg), 102.0583);
        // 100 / 0.45359237 = 220.462262185, not 100 * 2.2046226218.
        assert_eq!(convert_weight(100.0, Unit::Kg, Unit::Lb), 220.4623);
        // The same unit is untouched, even past 4 decimals.
        assert_eq!(convert_weight(102.123456, Unit::Kg, Unit::Kg), 102.123456);
        assert_eq!(convert_weight(135.0, Unit::Lb, Unit::Lb), 135.0);
        // A half step rounds up (js_round), here 0.5 lb = 0.226796185 kg.
        assert_eq!(convert_weight(0.5, Unit::Lb, Unit::Kg), 0.2268);
        assert_eq!(convert_weight(0.0, Unit::Kg, Unit::Lb), 0.0);
    }

    #[test]
    fn sets_are_converted_into_the_settings_unit() {
        let records = vec![lift(
            "a",
            "2026-09-14T17:30:00-04:00",
            vec![entry(
                "squat",
                vec![
                    set(225.0, Unit::Lb, 5.0, None),
                    set(100.0, Unit::Kg, 5.0, None),
                ],
            )],
        )];
        let kg = SettingsRecord {
            unit: Unit::Kg,
            ..lb()
        };
        let t = build_timeline(&records, &[], &kg, &TimelineFilter::default()).unwrap();
        let w = workout_of(&t, "a");
        assert_eq!(w.entries[0].sets[0].w, 102.0583);
        assert_eq!(w.entries[0].sets[1].w, 100.0);
        let t = build_timeline(&records, &[], &lb(), &TimelineFilter::default()).unwrap();
        let w = workout_of(&t, "a");
        assert_eq!(w.entries[0].sets[0].w, 225.0);
        assert_eq!(w.entries[0].sets[1].w, 220.4623);
    }

    #[test]
    fn lift_fields_pass_through() {
        let mut s = set(100.0, Unit::Lb, 4.5, Some(8.5));
        s.target_rpe = Some(8.0);
        s.warmup = true;
        s.tested_1rm = true;
        s.joint_pain = true;
        s.completed = false;
        let mut rec = match lift(
            "a",
            "2026-09-14T17:30:00-04:00",
            vec![entry("benchPress", vec![s])],
        ) {
            SessionRecord::Lift(l) => l,
            SessionRecord::Run(_) => unreachable!(),
        };
        rec.srpe = Some(7.5);
        rec.minutes = Some(62.0);
        let t = timeline(&[SessionRecord::Lift(rec)], &[]);
        let w = workout_of(&t, "a");
        assert_eq!(w.date, "2026-09-14T17:30:00-04:00");
        assert_eq!((w.srpe, w.minutes), (Some(7.5), Some(62.0)));
        let e = &w.entries[0];
        assert_eq!(e.targets, vec!["chest"]);
        assert_eq!(e.synergists, vec!["frontdelts", "triceps"]);
        assert_eq!(e.is_main, Some(true));
        let s = &e.sets[0];
        assert_eq!(
            (s.w, s.r, s.rpe, s.target_rpe),
            (100.0, 4.5, Some(8.5), Some(8.0))
        );
        assert!(!s.completed && s.warmup && s.tested1rm && s.joint_pain);
    }

    #[test]
    fn main_lifts_come_from_the_settings() {
        let records = vec![lift(
            "a",
            "2026-09-14T17:30:00-04:00",
            vec![
                entry("squat", vec![set(225.0, Unit::Lb, 5.0, Some(8.0))]),
                entry("benchPress", vec![set(135.0, Unit::Lb, 5.0, Some(8.0))]),
            ],
        )];
        let settings = SettingsRecord {
            main_lifts: vec!["squat".to_string()],
            ..lb()
        };
        let out = build_engine_state(&records, &[], &settings).unwrap();
        assert_eq!(out.state.main_lifts, vec!["squat"]);
        assert!(out.state.fitness.contains_key("squat"));
        assert!(!out.state.fitness.contains_key("benchPress"));
        assert!(out.state.kalman.contains_key("squat"));
        // Bench still adds fatigue: it is only not tracked as a main lift.
        assert!(out.state.fatigue_muscle["chest"] > 0.0);
    }

    #[test]
    fn unknown_exercise_has_no_muscles_and_one_warning_per_id() {
        let records = vec![
            lift(
                "b",
                "2026-09-15T17:30:00-04:00",
                vec![entry(
                    "zercherSquat9000",
                    vec![set(100.0, Unit::Lb, 5.0, None)],
                )],
            ),
            lift(
                "a",
                "2026-09-14T17:30:00-04:00",
                vec![
                    entry("mysteryMachine", vec![set(50.0, Unit::Lb, 10.0, None)]),
                    entry("zercherSquat9000", vec![set(100.0, Unit::Lb, 5.0, None)]),
                    entry("squat", vec![set(225.0, Unit::Lb, 5.0, None)]),
                ],
            ),
        ];
        let out = build_engine_state(&records, &[], &lb()).unwrap();
        // Chronological first appearance: session a comes first.
        assert_eq!(
            out.warnings,
            vec![
                "unknown exercise: mysteryMachine".to_string(),
                "unknown exercise: zercherSquat9000".to_string(),
            ]
        );
        let t = timeline(&records, &[]);
        let w = workout_of(&t, "a");
        assert!(w.entries[0].targets.is_empty() && w.entries[0].synergists.is_empty());
        // Only the known squat adds fatigue.
        assert!(out.state.fatigue_muscle["quads"] > 0.0);
        assert_eq!(out.state.fatigue_muscle.len(), 4);
    }

    #[test]
    fn stubs_are_dropped() {
        let stub = SessionRecord::Lift(LiftSessionRecord {
            id: "stub".to_string(),
            started_at: "not even a date".to_string(),
            program_day_index: Some(3),
            stub: true,
            minutes: None,
            srpe: None,
            entries: vec![],
        });
        let stub_run = SessionRecord::Run(RunRecord {
            stub: true,
            ..run("stubrun", "2026-09-16T08:00:00-04:00", 0.0)
        });
        let real = vec![squat_session("a", "2026-09-14T17:30:00-04:00")];
        let with_stubs = vec![real[0].clone(), stub, stub_run];
        let a = build_engine_state(&real, &[], &lb()).unwrap();
        let b = build_engine_state(&with_stubs, &[], &lb()).unwrap();
        assert_eq!(a, b);
        assert_eq!(b.state.lift_sessions.len(), 1);
        assert!(b.state.runs.is_empty());
    }

    #[test]
    fn empty_history_is_the_initial_state() {
        let out = build_engine_state(&[], &[], &lb()).unwrap();
        assert_eq!(out.state, initial_state_with(&lb().main_lifts));
        assert!(out.warnings.is_empty());
        let custom = SettingsRecord {
            main_lifts: vec!["squat".to_string(), "rowing".to_string()],
            ..lb()
        };
        let out = build_engine_state(&[], &[], &custom).unwrap();
        assert_eq!(out.state.main_lifts, vec!["squat", "rowing"]);
    }

    #[test]
    fn checkin_attaches_to_the_closest_lift_after_it_within_three_hours() {
        let lifts = vec![
            squat_session("early", "2026-09-14T10:00:00-04:00"),
            squat_session("late", "2026-09-14T11:00:00-04:00"),
        ];
        let c = vec![checkin(
            "c",
            "2026-09-14T08:30:00-04:00",
            7.0,
            &[("quads", 2)],
        )];
        let t = timeline(&lifts, &c);
        let attached = workout_of(&t, "early")
            .checkin
            .expect("attached to the first");
        assert_eq!(attached.prs, 7.0);
        assert_eq!(attached.soreness["quads"], 2.0);
        assert_eq!(workout_of(&t, "late").checkin, None);
        assert!(standalone_ids(&t).is_empty());
    }

    #[test]
    fn checkin_window_edges() {
        let lift_at = |at: &str| vec![squat_session("w", at)];
        // Exactly 3 hours before the lift: attached.
        let t = timeline(
            &lift_at("2026-09-14T10:00:00-04:00"),
            &[checkin("c", "2026-09-14T07:00:00-04:00", 7.0, &[])],
        );
        assert!(workout_of(&t, "w").checkin.is_some());
        assert!(standalone_ids(&t).is_empty());
        // One millisecond over: standalone.
        let t = timeline(
            &lift_at("2026-09-14T10:00:00-04:00"),
            &[checkin("c", "2026-09-14T06:59:59.999-04:00", 7.0, &[])],
        );
        assert!(workout_of(&t, "w").checkin.is_none());
        assert_eq!(standalone_ids(&t), vec!["c"]);
        // The same instant: attached.
        let t = timeline(
            &lift_at("2026-09-14T10:00:00-04:00"),
            &[checkin("c", "2026-09-14T14:00:00Z", 7.0, &[])],
        );
        assert!(workout_of(&t, "w").checkin.is_some());
        // One millisecond after the lift: standalone, a check-in is taken before training.
        let t = timeline(
            &lift_at("2026-09-14T10:00:00-04:00"),
            &[checkin("c", "2026-09-14T10:00:00.001-04:00", 7.0, &[])],
        );
        assert!(workout_of(&t, "w").checkin.is_none());
        assert_eq!(standalone_ids(&t), vec!["c"]);
    }

    #[test]
    fn checkin_near_only_a_stub_or_a_run_is_standalone() {
        let stub = SessionRecord::Lift(LiftSessionRecord {
            id: "stub".to_string(),
            started_at: "2026-09-14T10:00:00-04:00".to_string(),
            program_day_index: Some(1),
            stub: true,
            minutes: None,
            srpe: None,
            entries: vec![],
        });
        let c = vec![checkin("c", "2026-09-14T09:00:00-04:00", 7.0, &[])];
        let t = timeline(&[stub], &c);
        assert_eq!(standalone_ids(&t), vec!["c"]);
        let r = SessionRecord::Run(run("r", "2026-09-14T10:00:00-04:00", 5000.0));
        let t = timeline(&[r], &c);
        assert_eq!(standalone_ids(&t), vec!["c"]);
        // A run between the check-in and the lift does not stop the lift from claiming it.
        let r = SessionRecord::Run(run("r", "2026-09-14T09:30:00-04:00", 5000.0));
        let l = squat_session("w", "2026-09-14T11:00:00-04:00");
        let t = timeline(&[r, l], &c);
        assert!(standalone_ids(&t).is_empty());
        assert!(workout_of(&t, "w").checkin.is_some());
    }

    #[test]
    fn two_checkins_for_one_lift_the_later_attaches_and_the_other_is_standalone() {
        let l = vec![squat_session("w", "2026-09-14T10:00:00-04:00")];
        let c = vec![
            checkin("late", "2026-09-14T09:30:00-04:00", 8.0, &[]),
            checkin("early", "2026-09-14T08:00:00-04:00", 5.0, &[]),
        ];
        let t = timeline(&l, &c);
        assert_eq!(workout_of(&t, "w").checkin.unwrap().prs, 8.0);
        assert_eq!(standalone_ids(&t), vec!["early"]);
        // The standalone one is applied first, at its own time.
        assert!(matches!(t.entries[0].item, TimelineItem::Checkin(_)));
        let out = build_engine_state(&l, &c, &lb()).unwrap();
        let history: Vec<(&str, f64)> = out
            .state
            .prs_history
            .iter()
            .map(|h| (h.date.as_str(), h.value))
            .collect();
        assert_eq!(
            history,
            vec![
                ("2026-09-14T08:00:00-04:00", 5.0),
                ("2026-09-14T10:00:00-04:00", 8.0)
            ]
        );
    }

    #[test]
    fn standalone_checkin_on_a_rest_day_decays_then_records() {
        let l = vec![squat_session("w", "2026-09-14T17:30:00-04:00")];
        let c = vec![checkin(
            "c",
            "2026-09-16T17:30:00-04:00",
            6.0,
            &[("quads", 3), ("glutes", 2)],
        )];
        let out = build_engine_state(&l, &c, &lb()).unwrap();
        let s = &out.state;
        // Two days of decay at the 2.5 d tau; the workout added 1.0 to quads.
        assert_eq!(s.fatigue_muscle["quads"], 1.0 * (-2.0f64 / 2.5).exp());
        assert_eq!(s.updated, "2026-09-16T17:30:00-04:00");
        assert_eq!(s.prs_history.len(), 1);
        assert_eq!(s.prs_history[0].date, "2026-09-16T17:30:00-04:00");
        assert_eq!(s.prs_history[0].value, 6.0);
        let last = s.last_checkin.as_ref().expect("last check-in");
        assert_eq!(last.prs, 6.0);
        assert_eq!(last.soreness["quads"], 3.0);
        assert_eq!(last.date, "2026-09-16T17:30:00-04:00");
        assert_eq!(s.soreness_prev.as_ref().unwrap()["glutes"], 2.0);
        assert_eq!(s.soreness_prev_prev, None);
        // The check-in is not a session: nothing else was logged.
        assert_eq!(s.lift_sessions.len(), 1);
        // A second rest-day check-in rolls the soreness snapshots.
        let c2 = vec![
            c[0].clone(),
            checkin("c2", "2026-09-17T08:00:00-04:00", 8.0, &[("quads", 1)]),
        ];
        let s2 = build_engine_state(&l, &c2, &lb()).unwrap().state;
        assert_eq!(s2.soreness_prev.as_ref().unwrap()["quads"], 1.0);
        assert_eq!(s2.soreness_prev_prev.as_ref().unwrap()["quads"], 3.0);
        assert_eq!(s2.prs_history.len(), 2);
    }

    #[test]
    fn standalone_checkin_decays_to_its_date_before_the_next_workout() {
        // Day 0 lift, day 2 check-in, day 4 lift: the second lift's decay starts at the check-in.
        let l = vec![
            squat_session("w1", "2026-09-14T12:00:00Z"),
            squat_session("w2", "2026-09-18T12:00:00Z"),
        ];
        let c = vec![checkin("c", "2026-09-16T12:00:00Z", 7.0, &[])];
        let with = build_engine_state(&l, &c, &lb()).unwrap().state;
        let without = build_engine_state(&l, &[], &lb()).unwrap().state;
        let a = with.fatigue_muscle["quads"];
        let b = without.fatigue_muscle["quads"];
        assert!((a - b).abs() < 1e-12, "{a} vs {b}");
        assert_eq!(with.updated, without.updated);
    }

    #[test]
    fn records_at_equal_instants_are_ordered_by_id_and_input_order_does_not_matter() {
        let at = "2026-09-14T17:30:00-04:00";
        let a = lift(
            "a",
            at,
            vec![entry("squat", vec![set(225.0, Unit::Lb, 5.0, Some(8.0))])],
        );
        let b = lift(
            "b",
            at,
            vec![entry(
                "benchPress",
                vec![set(135.0, Unit::Lb, 5.0, Some(8.0))],
            )],
        );
        let r = SessionRecord::Run(run("a-run", at, 5000.0));
        let forward = vec![a.clone(), b.clone(), r.clone()];
        let backward = vec![r, b, a];
        let t = timeline(&forward, &[]);
        let ids: Vec<String> = t
            .entries
            .iter()
            .map(|e| match &e.item {
                TimelineItem::Workout(w) => w.id().to_string(),
                TimelineItem::Checkin(c) => c.id.clone(),
            })
            .collect();
        assert_eq!(ids, vec!["a", "a-run", "b"]);
        assert_eq!(
            build_engine_state(&forward, &[], &lb()).unwrap(),
            build_engine_state(&backward, &[], &lb()).unwrap()
        );
    }

    #[test]
    fn a_checkin_goes_before_a_run_at_the_same_instant() {
        let at = "2026-09-14T08:00:00-04:00";
        let t = timeline(
            &[SessionRecord::Run(run("a-run", at, 5000.0))],
            &[checkin("z-checkin", at, 7.0, &[])],
        );
        assert!(matches!(t.entries[0].item, TimelineItem::Checkin(_)));
        assert!(matches!(
            t.entries[1].item,
            TimelineItem::Workout(Workout::Run(_))
        ));
    }

    #[test]
    fn runs_convert_with_the_moving_time_fallback() {
        let mut r = run("r", "2026-09-14T07:00:00-04:00", 10_000.0);
        r.moving_sec = None;
        r.elapsed_sec = 3200.0;
        r.srpe = Some(6.0);
        r.minutes = Some(54.0);
        r.hr_trimp = Some(88.0);
        r.descent_m = Some(120.0);
        r.grade_profile = Some(vec![
            RecordGrade {
                grade: 0.02,
                meters: 4000.0,
            },
            RecordGrade {
                grade: -0.02,
                meters: 6000.0,
            },
        ]);
        let out = build_engine_state(&[SessionRecord::Run(r)], &[], &lb()).unwrap();
        let log = &out.state.runs[0];
        assert_eq!(log.moving_sec, 3200.0);
        assert_eq!(log.descent_m, 120.0);
        assert_eq!(out.state.last_run.as_ref().unwrap().minutes, 54.0);
        assert_eq!(out.state.srpe_rtss_pairs.len(), 1);
        // With a moving time the fallback is not used.
        let mut r2 = run("r2", "2026-09-15T07:00:00-04:00", 10_000.0);
        r2.moving_sec = Some(3000.0);
        r2.elapsed_sec = 3200.0;
        let out = build_engine_state(&[SessionRecord::Run(r2)], &[], &lb()).unwrap();
        assert_eq!(out.state.runs[0].moving_sec, 3000.0);
    }

    #[test]
    fn bad_dates_and_non_finite_numbers_are_errors() {
        let bad = vec![squat_session("a", "2026-09-31T17:30:00-04:00")];
        assert!(matches!(
            build_engine_state(&bad, &[], &lb()),
            Err(AdapterError::Time(_))
        ));
        let no_offset = vec![squat_session("a", "2026-09-14T17:30:00")];
        assert!(build_engine_state(&no_offset, &[], &lb()).is_err());
        let ok = vec![squat_session("a", "2026-09-14T17:30:00-04:00")];
        let c = vec![checkin("c", "yesterday", 7.0, &[])];
        assert!(matches!(
            build_engine_state(&ok, &c, &lb()),
            Err(AdapterError::Time(_))
        ));
        let nan = vec![lift(
            "n",
            "2026-09-14T17:30:00-04:00",
            vec![entry("squat", vec![set(f64::NAN, Unit::Lb, 5.0, None)])],
        )];
        assert_eq!(
            build_engine_state(&nan, &[], &lb()),
            Err(AdapterError::NonFinite("n: weight".to_string()))
        );
        let inf_checkin = vec![checkin(
            "i",
            "2026-09-14T08:00:00-04:00",
            f64::INFINITY,
            &[],
        )];
        assert!(matches!(
            build_engine_state(&[], &inf_checkin, &lb()),
            Err(AdapterError::NonFinite(_))
        ));
        assert!(logged_program_days(&[squat_session("a", "bad")]).is_ok());
    }

    #[test]
    fn logged_program_days_include_stubs_in_chronological_order() {
        let mk = |id: &str, at: &str, day: Option<u32>, stub: bool| {
            SessionRecord::Lift(LiftSessionRecord {
                id: id.to_string(),
                started_at: at.to_string(),
                program_day_index: day,
                stub,
                minutes: None,
                srpe: None,
                entries: vec![],
            })
        };
        let records = vec![
            mk("c", "2026-09-18T09:00:00-04:00", Some(2), false),
            mk("a", "2026-09-14T09:00:00-04:00", Some(0), true),
            SessionRecord::Run(run("r", "2026-09-15T09:00:00-04:00", 5000.0)),
            mk("none", "2026-09-16T09:00:00-04:00", None, false),
            mk("b", "2026-09-16T21:00:00Z", Some(1), true),
            // Same instant as "b" (17:00 EDT is 21:00Z): id breaks the tie, "b" before "d".
            mk("d", "2026-09-16T17:00:00-04:00", Some(7), false),
        ];
        assert_eq!(logged_program_days(&records).unwrap(), vec![0, 1, 7, 2]);
        assert_eq!(logged_program_days(&[]).unwrap(), Vec::<u32>::new());
        let bad = vec![mk("x", "soon", Some(1), false)];
        assert!(logged_program_days(&bad).is_err());
    }

    #[test]
    fn iso_offsets_and_local_dates() {
        assert_eq!(iso_offset_minutes("2026-10-02T17:30:00-04:00"), Ok(-240));
        assert_eq!(iso_offset_minutes("2026-10-02T17:30:00+05:30"), Ok(330));
        assert_eq!(iso_offset_minutes("2026-10-02T17:30:00.250Z"), Ok(0));
        assert_eq!(iso_offset_minutes("2026-10-02"), Ok(0));
        assert_eq!(iso_offset_minutes("2026-10-02T17:30-09:30"), Ok(-570));
        assert!(iso_offset_minutes("2026-10-02T17:30:00").is_err());
        assert!(iso_offset_minutes("").is_err());
        // The local date is the one written in the string, not the UTC date.
        assert_eq!(
            iso_local_date_key("2026-10-02T23:30:00-04:00").unwrap(),
            "2026-10-02"
        );
        assert_eq!(
            iso_local_date_key("2026-10-02T00:30:00+05:30").unwrap(),
            "2026-10-02"
        );
        assert_eq!(
            iso_local_date_key("2026-10-02T23:30:00Z").unwrap(),
            "2026-10-02"
        );
        assert_eq!(iso_local_date_key("2026-10-02").unwrap(), "2026-10-02");
    }

    // ---- A three week history against a direct `calibrate` ----

    /// (exercise id, targets, synergists, main) as the library lists them, typed out here so the
    /// expected workouts do not depend on the adapter.
    const MUSCLES: [(&str, &[&str], &[&str], bool); 5] = [
        (
            "squat",
            &["quads"],
            &["hamstrings", "glutes", "calves"],
            true,
        ),
        ("benchPress", &["chest"], &["frontdelts", "triceps"], true),
        (
            "deadlift",
            &["glutes"],
            &["hamstrings", "quads", "calves"],
            true,
        ),
        (
            "overheadPress",
            &["frontdelts"],
            &["sidedelts", "chest", "upperback", "triceps"],
            true,
        ),
        (
            "bentOverRow",
            &["lats", "upperback"],
            &["biceps", "forearms", "reardelts", "chest"],
            false,
        ),
    ];

    /// One planned set: (weight lb, reps, rpe).
    type PlanSet = (f64, f64, Option<f64>);

    /// One session: start, (exercise id, sets) per entry, and the check-in's recovery.
    type PlanSession = (String, Vec<(&'static str, Vec<PlanSet>)>, f64);

    fn three_week_plan() -> Vec<PlanSession> {
        let mut plan = Vec::new();
        for week in 0..3u32 {
            let w = f64::from(week);
            let day = |n: u32| try_add_days_key("2026-09-14", i64::from(n)).expect("valid key");
            let mon = 7 * week;
            // Monday: squat and bench. Wednesday: deadlift and press. Friday: squat and row.
            plan.push((
                format!("{}T17:30:00-04:00", day(mon)),
                vec![
                    ("squat", vec![(225.0 + 5.0 * w, 5.0, Some(8.0)); 3]),
                    ("benchPress", vec![(155.0 + 2.5 * w, 5.0, Some(8.5)); 3]),
                ],
                7.0,
            ));
            plan.push((
                format!("{}T17:30:00-04:00", day(mon + 2)),
                vec![
                    ("deadlift", vec![(275.0 + 5.0 * w, 3.0, Some(8.0)); 2]),
                    ("overheadPress", vec![(95.0, 6.0, Some(9.0)); 3]),
                ],
                6.5,
            ));
            plan.push((
                format!("{}T17:30:00-04:00", day(mon + 4)),
                vec![
                    (
                        "squat",
                        vec![
                            (205.0, 8.0, Some(7.5)),
                            (205.0, 8.0, Some(8.0)),
                            (245.0 + 5.0 * w, 1.0, Some(9.5)),
                        ],
                    ),
                    ("bentOverRow", vec![(135.0, 10.0, None); 3]),
                ],
                8.0,
            ));
        }
        plan
    }

    #[test]
    fn three_weeks_of_gzclp_match_a_direct_calibrate() {
        let plan = three_week_plan();
        let mut records = Vec::new();
        let mut checkins = Vec::new();
        let mut workouts = Vec::new();
        for (i, (at, entries, recovery)) in plan.iter().enumerate() {
            records.push(lift(
                &format!("s{i}"),
                at,
                entries
                    .iter()
                    .map(|(id, sets)| {
                        entry(
                            id,
                            sets.iter()
                                .map(|(w, r, rpe)| set(*w, Unit::Lb, *r, *rpe))
                                .collect(),
                        )
                    })
                    .collect(),
            ));
            // Taken 45 minutes before training, so it attaches to the session.
            let checkin_at = at.replace("17:30", "16:45");
            checkins.push(checkin(
                &format!("c{i}"),
                &checkin_at,
                *recovery,
                &[("quads", 2), ("chest", 1)],
            ));
            workouts.push(Workout::Lift(LiftWorkout {
                id: format!("s{i}"),
                date: at.clone(),
                entries: entries
                    .iter()
                    .map(|(id, sets)| {
                        let (_, targets, synergists, main) =
                            MUSCLES.iter().find(|m| m.0 == *id).expect("known exercise");
                        LiftEntry {
                            exercise_id: id.to_string(),
                            targets: targets.iter().map(|s| s.to_string()).collect(),
                            synergists: synergists.iter().map(|s| s.to_string()).collect(),
                            sets: sets
                                .iter()
                                .map(|(w, r, rpe)| SetLog {
                                    w: *w,
                                    r: *r,
                                    rpe: *rpe,
                                    completed: true,
                                    ..SetLog::default()
                                })
                                .collect(),
                            is_main: Some(*main),
                        }
                    })
                    .collect(),
                checkin: Some(Checkin {
                    prs: *recovery,
                    soreness: [("quads".to_string(), 2.0), ("chest".to_string(), 1.0)]
                        .into_iter()
                        .collect(),
                }),
                perf: None,
                srpe: None,
                minutes: None,
            }));
        }
        let settings = SettingsRecord {
            main_lifts: ["squat", "benchPress", "deadlift", "overheadPress"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
            ..lb()
        };
        let out = build_engine_state(&records, &checkins, &settings).unwrap();
        assert!(out.warnings.is_empty());
        let mut expected = calibrate(&workouts).unwrap();
        expected.main_lifts = settings.main_lifts.clone();
        assert_eq!(out.state, expected);

        let s = &out.state;
        assert!(!s.fatigue_muscle.is_empty());
        assert!(!s.fitness.is_empty());
        assert_eq!(s.lift_sessions.len(), 9);
        assert_eq!(s.prs_history.len(), 9);
        // The row is not a main lift: no fitness entry, but its fatigue counts.
        assert!(!s.fitness.contains_key("bentOverRow"));
        assert!(s.fatigue_muscle["lats"] > 0.0);
        assert!(s.fitness["squat"] > 0.0 && s.fitness["deadlift"] > 0.0);
        assert_eq!(s.kalman["squat"].obs, 6.0);
        assert_eq!(s.updated, "2026-10-02T17:30:00-04:00");
    }
}
