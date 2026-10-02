//! Engine state and input types: `packages/engine/state.ts`.
//!
//! Everything serializes to the TS JSON shape: camelCase keys, optional TS fields (`?`) omitted
//! when absent, `number | null` fields written as `null`, and numbers written the way
//! `JSON.stringify` writes them (integral values without a fraction). Field order follows the TS
//! declaration order, so `serde_json::to_string` matches `JSON.stringify` for a TS-produced
//! state. Deserializing is tolerant: unknown keys are ignored and missing `EngineState` fields
//! take their `initial_state` value.
//!
//! Records keyed by id (`Record<string, T>` in TS) are `BTreeMap`s so output order is stable.
//! No sum in the engine depends on map iteration order.

use crate::js::{ser_matrix3, ser_num, ser_num_map, ser_opt_num, ser_opt_num_map};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Default main lifts (PLAN 3/15, user-editable via `EngineState::main_lifts`).
pub const DEFAULT_MAIN_LIFTS: [&str; 4] = ["squat", "bench", "deadlift", "ohp"];

/// Lower-body lifts affected by the cross-modal run-before-lift rules.
pub const LOWER_BODY_PATTERNS: [&str; 6] = [
    "squat",
    "deadlift",
    "lunge",
    "legpress",
    "leg-press",
    "leg_press",
];

/// `new Date(0).toISOString()`, the `updated` stamp of a fresh state.
pub const EPOCH_ISO: &str = "1970-01-01T00:00:00.000Z";

/// True when the exercise id contains a lower-body pattern (case-insensitive substring).
pub fn is_lower_body_lift(exercise_id: &str) -> bool {
    let id = exercise_id.to_lowercase();
    LOWER_BODY_PATTERNS.iter().any(|p| id.contains(p))
}

fn is_false(b: &bool) -> bool {
    !*b
}

fn is_none_f64(x: &Option<f64>) -> bool {
    x.is_none()
}

/// One logged set. Weight is in the user's unit, consistent within a history.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetLog {
    /// Load.
    #[serde(serialize_with = "ser_num")]
    pub w: f64,
    /// Reps completed. Half reps are allowed.
    #[serde(serialize_with = "ser_num")]
    pub r: f64,
    /// Logged RPE on the RIR scale (10 = 0 RIR).
    #[serde(
        default,
        skip_serializing_if = "is_none_f64",
        serialize_with = "ser_opt_num"
    )]
    pub rpe: Option<f64>,
    /// Program target RPE (top of range).
    #[serde(
        default,
        skip_serializing_if = "is_none_f64",
        serialize_with = "ser_opt_num"
    )]
    pub target_rpe: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "is_none_f64",
        serialize_with = "ser_opt_num"
    )]
    pub target_reps_min: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "is_none_f64",
        serialize_with = "ser_opt_num"
    )]
    pub target_reps_max: Option<f64>,
    #[serde(default)]
    pub completed: bool,
    /// TS `warmup?: boolean`; absent and false behave the same, so this is a plain bool.
    #[serde(default, skip_serializing_if = "is_false")]
    pub warmup: bool,
    /// Flagged test or meet attempt.
    #[serde(default, skip_serializing_if = "is_false")]
    pub tested1rm: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub joint_pain: bool,
}

/// One exercise within a lift session.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiftEntry {
    pub exercise_id: String,
    #[serde(default)]
    pub targets: Vec<String>,
    /// TS `synergists?: MuscleId[]`; absent and empty behave the same.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub synergists: Vec<String>,
    #[serde(default)]
    pub sets: Vec<SetLog>,
    /// Overrides the `main_lifts` membership test when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_main: Option<bool>,
}

/// A pre-session check-in: PRS 0-10 and the 4-point soreness grid per muscle.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkin {
    #[serde(serialize_with = "ser_num")]
    pub prs: f64,
    /// Soreness 1..=4 per muscle id (stored as numbers; compared with `== 4` and `== 3`).
    #[serde(default, serialize_with = "ser_num_map")]
    pub soreness: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiftWorkout {
    #[serde(default)]
    pub id: String,
    /// ISO 8601 instant with an offset.
    pub date: String,
    #[serde(default)]
    pub entries: Vec<LiftEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkin: Option<Checkin>,
    /// Post-muscle-group performance taps. The engine ignores them.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "ser_opt_num_map"
    )]
    pub perf: Option<BTreeMap<String, f64>>,
    /// Session RPE, CR-10.
    #[serde(
        default,
        skip_serializing_if = "is_none_f64",
        serialize_with = "ser_opt_num"
    )]
    pub srpe: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "is_none_f64",
        serialize_with = "ser_opt_num"
    )]
    pub minutes: Option<f64>,
}

/// A grade segment of a run: grade as a fraction and the metres run at it.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradeSegment {
    #[serde(serialize_with = "ser_num")]
    pub grade: f64,
    #[serde(serialize_with = "ser_num")]
    pub meters: f64,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunWorkout {
    #[serde(default)]
    pub id: String,
    /// ISO 8601, the run's START. The end is `date + moving_sec`.
    pub date: String,
    #[serde(serialize_with = "ser_num")]
    pub distance_m: f64,
    #[serde(serialize_with = "ser_num")]
    pub moving_sec: f64,
    #[serde(default, serialize_with = "ser_num")]
    pub elapsed_sec: f64,
    /// Mean grade profile; flat when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grade_profile: Option<Vec<GradeSegment>>,
    /// Total metres descended on grades steeper than -5% (0 when unknown).
    #[serde(
        default,
        skip_serializing_if = "is_none_f64",
        serialize_with = "ser_opt_num"
    )]
    pub descent_m: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "is_none_f64",
        serialize_with = "ser_opt_num"
    )]
    pub srpe: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "is_none_f64",
        serialize_with = "ser_opt_num"
    )]
    pub minutes: Option<f64>,
    /// Banister TRIMP when HR was recorded.
    #[serde(
        default,
        skip_serializing_if = "is_none_f64",
        serialize_with = "ser_opt_num"
    )]
    pub hr_trimp: Option<f64>,
}

/// A logged workout, tagged by `kind` on the wire (`"lift"` or `"run"`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Workout {
    Lift(LiftWorkout),
    Run(RunWorkout),
}

impl Workout {
    /// The workout's ISO 8601 `date`.
    pub fn date(&self) -> &str {
        match self {
            Workout::Lift(w) => &w.date,
            Workout::Run(w) => &w.date,
        }
    }

    pub fn id(&self) -> &str {
        match self {
            Workout::Lift(w) => &w.id,
            Workout::Run(w) => &w.id,
        }
    }
}

/// Linear Kalman filter state over `[p0, k1, k2]` (kalman.ts).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KalmanState {
    #[serde(serialize_with = "ser_num")]
    pub p0: f64,
    #[serde(serialize_with = "ser_num")]
    pub k1: f64,
    #[serde(serialize_with = "ser_num")]
    pub k2: f64,
    #[serde(serialize_with = "ser_num")]
    pub theta_prior: f64,
    /// Covariance, `P` in TS.
    #[serde(rename = "P", serialize_with = "ser_matrix3")]
    pub p: [[f64; 3]; 3],
    /// Observations folded in so far.
    #[serde(serialize_with = "ser_num")]
    pub obs: f64,
    /// Observation variance for a normal e1RM observation, `R` in TS.
    #[serde(rename = "R", serialize_with = "ser_num")]
    pub r: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BestEffort {
    #[serde(serialize_with = "ser_num")]
    pub distance_m: f64,
    #[serde(serialize_with = "ser_num")]
    pub seconds: f64,
    pub date: String,
}

/// `{ date, value }` pairs: PRS history and e1RM observations.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatedValue {
    pub date: String,
    #[serde(serialize_with = "ser_num")]
    pub value: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLoad {
    pub date: String,
    #[serde(serialize_with = "ser_num")]
    pub load: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiftSessionLog {
    pub date: String,
    #[serde(serialize_with = "ser_num")]
    pub quad_set_eq: f64,
    pub heavy_lower: bool,
    #[serde(
        default,
        skip_serializing_if = "is_none_f64",
        serialize_with = "ser_opt_num"
    )]
    pub srpe: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunLog {
    pub date: String,
    #[serde(serialize_with = "ser_num")]
    pub distance_m: f64,
    #[serde(serialize_with = "ser_num")]
    pub moving_sec: f64,
    #[serde(default, serialize_with = "ser_num")]
    pub descent_m: f64,
    /// Zone weight: 0.5 easy, 1.0 steady, 1.5 hard.
    #[serde(serialize_with = "ser_num")]
    pub z: f64,
}

/// A paired sRPE load and rTSS for one run, used to fit the sRPE-per-rTSS ratio.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SrpeRtssPair {
    #[serde(serialize_with = "ser_num")]
    pub srpe_load: f64,
    #[serde(rename = "rTSS", serialize_with = "ser_num")]
    pub r_tss: f64,
}

/// Reference 1RM per lift. `source` is `"kalman"` or `"tested"`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceRm {
    #[serde(serialize_with = "ser_num")]
    pub weight: f64,
    pub date: String,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestStat {
    #[serde(serialize_with = "ser_num")]
    pub m: f64,
    #[serde(serialize_with = "ser_num")]
    pub samples: f64,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestProfile {
    #[serde(default)]
    pub by_class: BTreeMap<String, RestStat>,
    #[serde(default)]
    pub by_exercise: BTreeMap<String, RestStat>,
}

/// The last applied check-in: the check-in fields plus the session date (flat, as TS spreads it).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastCheckin {
    #[serde(serialize_with = "ser_num")]
    pub prs: f64,
    #[serde(default, serialize_with = "ser_num_map")]
    pub soreness: BTreeMap<String, f64>,
    pub date: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastRun {
    pub date: String,
    #[serde(serialize_with = "ser_num")]
    pub minutes: f64,
    #[serde(serialize_with = "ser_num")]
    pub distance_m: f64,
    #[serde(serialize_with = "ser_num")]
    pub z: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointPainEntry {
    pub date: String,
    pub exercise_id: String,
}

/// An injury note. `kind` is `"lifting"` or `"running"`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Injury {
    pub date: String,
    pub area: String,
    pub kind: String,
}

/// Everything the engine remembers. `P` rows, `rTSS` and `R` keep their TS spelling on the wire.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EngineState {
    /// ISO timestamp of the last applied input, kept verbatim.
    pub updated: String,
    pub main_lifts: Vec<String>,
    /// F_l per lift, tau 45 d.
    #[serde(serialize_with = "ser_num_map")]
    pub fitness: BTreeMap<String, f64>,
    /// G_m per muscle, tau 2.0 or 2.5 d.
    #[serde(serialize_with = "ser_num_map")]
    pub fatigue_muscle: BTreeMap<String, f64>,
    /// D_m per muscle, tau 5 d.
    #[serde(serialize_with = "ser_num_map")]
    pub fatigue_damage: BTreeMap<String, f64>,
    /// G_s, tau 10 d.
    #[serde(serialize_with = "ser_num")]
    pub fatigue_systemic: f64,
    /// F_run, tau 42 d.
    #[serde(serialize_with = "ser_num")]
    pub fitness_run: f64,
    pub kalman: BTreeMap<String, KalmanState>,
    pub kalman_run: KalmanState,
    /// Running-derived fatigue only (for the runFatigueHold rule).
    #[serde(serialize_with = "ser_num_map")]
    pub run_fatigue_muscle: BTreeMap<String, f64>,
    #[serde(serialize_with = "ser_num_map")]
    pub run_fatigue_damage: BTreeMap<String, f64>,
    /// For critical speed; the 90 d window is applied at read time.
    pub best_efforts: Vec<BestEffort>,
    pub prs_history: Vec<DatedValue>,
    /// sRPE-load per day (lifting and running).
    pub daily_load: Vec<DailyLoad>,
    pub lift_sessions: Vec<LiftSessionLog>,
    pub e1rm_obs: BTreeMap<String, Vec<DatedValue>>,
    pub runs: Vec<RunLog>,
    pub srpe_rtss_pairs: Vec<SrpeRtssPair>,
    pub reference_rm: BTreeMap<String, ReferenceRm>,
    pub rest_profile: RestProfile,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_checkin: Option<LastCheckin>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run: Option<LastRun>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "ser_opt_num_map"
    )]
    pub soreness_prev: Option<BTreeMap<String, f64>>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "ser_opt_num_map"
    )]
    pub soreness_prev_prev: Option<BTreeMap<String, f64>>,
    pub joint_pain_log: Vec<JointPainEntry>,
    pub injuries: Vec<Injury>,
    /// `"lifting"` or `"running"`.
    pub hybrid_priority: String,
}

impl Default for EngineState {
    fn default() -> Self {
        initial_state()
    }
}

/// `initialState()` with the default main lifts.
pub fn initial_state() -> EngineState {
    let lifts: Vec<String> = DEFAULT_MAIN_LIFTS
        .iter()
        .map(|s| (*s).to_string())
        .collect();
    initial_state_with(&lifts)
}

/// `initialState(mainLifts)`.
pub fn initial_state_with(main_lifts: &[String]) -> EngineState {
    EngineState {
        updated: EPOCH_ISO.to_string(),
        main_lifts: main_lifts.to_vec(),
        fitness: BTreeMap::new(),
        fatigue_muscle: BTreeMap::new(),
        fatigue_damage: BTreeMap::new(),
        fatigue_systemic: 0.0,
        fitness_run: 0.0,
        kalman: BTreeMap::new(),
        kalman_run: KalmanState {
            p0: 40.0,
            k1: 1.0,
            k2: 2.0,
            theta_prior: 2.0,
            p: [[1e4, 0.0, 0.0], [0.0, 1e3, 0.0], [0.0, 0.0, 1.0]],
            obs: 0.0,
            r: 1.0,
        },
        run_fatigue_muscle: BTreeMap::new(),
        run_fatigue_damage: BTreeMap::new(),
        best_efforts: Vec::new(),
        prs_history: Vec::new(),
        daily_load: Vec::new(),
        lift_sessions: Vec::new(),
        e1rm_obs: BTreeMap::new(),
        runs: Vec::new(),
        srpe_rtss_pairs: Vec::new(),
        reference_rm: BTreeMap::new(),
        rest_profile: RestProfile::default(),
        last_checkin: None,
        last_run: None,
        soreness_prev: None,
        soreness_prev_prev: None,
        joint_pain_log: Vec::new(),
        injuries: Vec::new(),
        hybrid_priority: "lifting".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `JSON.stringify(initialState())` from the TS engine, verbatim.
    const TS_INITIAL: &str = r#"{"updated":"1970-01-01T00:00:00.000Z","mainLifts":["squat","bench","deadlift","ohp"],"fitness":{},"fatigueMuscle":{},"fatigueDamage":{},"fatigueSystemic":0,"fitnessRun":0,"kalman":{},"kalmanRun":{"p0":40,"k1":1,"k2":2,"thetaPrior":2,"P":[[10000,0,0],[0,1000,0],[0,0,1]],"obs":0,"R":1},"runFatigueMuscle":{},"runFatigueDamage":{},"bestEfforts":[],"prsHistory":[],"dailyLoad":[],"liftSessions":[],"e1rmObs":{},"runs":[],"srpeRtssPairs":[],"referenceRm":{},"restProfile":{"byClass":{},"byExercise":{}},"jointPainLog":[],"injuries":[],"hybridPriority":"lifting"}"#;

    #[test]
    fn initial_state_serializes_exactly_like_ts() {
        assert_eq!(serde_json::to_string(&initial_state()).unwrap(), TS_INITIAL);
    }

    #[test]
    fn initial_state_round_trips() {
        let s: EngineState = serde_json::from_str(TS_INITIAL).unwrap();
        assert_eq!(s, initial_state());
        assert_eq!(serde_json::to_string(&s).unwrap(), TS_INITIAL);
    }

    #[test]
    fn empty_object_deserializes_to_initial_state() {
        let s: EngineState = serde_json::from_str("{}").unwrap();
        assert_eq!(s, initial_state());
    }

    #[test]
    fn unknown_keys_are_ignored_and_optionals_round_trip() {
        let text = r#"{"extra":1,"updated":"2026-01-01T00:00:00Z","fitness":{"squat":1.5},
            "lastCheckin":{"prs":7,"soreness":{"quads":3},"date":"2026-01-01T00:00:00Z"},
            "lastRun":{"date":"2026-01-01T00:00:00Z","minutes":45,"distanceM":8000,"z":1},
            "sorenessPrev":{"quads":2}}"#;
        let s: EngineState = serde_json::from_str(text).unwrap();
        assert_eq!(s.updated, "2026-01-01T00:00:00Z");
        assert_eq!(s.fitness["squat"], 1.5);
        assert_eq!(s.last_checkin.as_ref().unwrap().soreness["quads"], 3.0);
        assert_eq!(s.soreness_prev.as_ref().unwrap()["quads"], 2.0);
        assert!(s.soreness_prev_prev.is_none());
        let v: serde_json::Value = serde_json::to_value(&s).unwrap();
        assert!(v.get("sorenessPrevPrev").is_none());
        assert_eq!(v["lastCheckin"]["prs"], serde_json::json!(7));
        assert_eq!(v["lastCheckin"]["date"], "2026-01-01T00:00:00Z");
        assert_eq!(v["lastRun"]["distanceM"], serde_json::json!(8000));
    }

    #[test]
    fn workout_is_tagged_by_kind() {
        let lift: Workout = serde_json::from_str(
            r#"{"kind":"lift","id":"a","date":"2026-01-01T10:00:00-05:00",
                "entries":[{"exerciseId":"squat","targets":["quads"],
                "sets":[{"w":100,"r":5.5,"rpe":8.5,"completed":true}]}],
                "checkin":{"prs":7,"soreness":{"quads":2}},"srpe":6,"minutes":50}"#,
        )
        .unwrap();
        match &lift {
            Workout::Lift(w) => {
                assert_eq!(w.entries[0].sets[0].r, 5.5);
                assert_eq!(w.entries[0].sets[0].rpe, Some(8.5));
                assert!(!w.entries[0].sets[0].warmup);
                assert_eq!(w.srpe, Some(6.0));
            }
            Workout::Run(_) => panic!("expected a lift"),
        }
        let v = serde_json::to_value(&lift).unwrap();
        assert_eq!(v["kind"], "lift");
        assert!(v["entries"][0].get("synergists").is_none());
        assert!(v["entries"][0]["sets"][0].get("warmup").is_none());
        let run: Workout = serde_json::from_str(
            r#"{"kind":"run","id":"r","date":"2026-01-02T10:00:00Z","distanceM":5000,
                "movingSec":1500,"elapsedSec":1600}"#,
        )
        .unwrap();
        assert!(matches!(&run, Workout::Run(w) if w.descent_m.is_none() && w.distance_m == 5000.0));
        assert_eq!(run.date(), "2026-01-02T10:00:00Z");
        assert!(serde_json::from_str::<Workout>(r#"{"kind":"swim","date":"x"}"#).is_err());
    }

    #[test]
    fn lower_body_lift_matches_substrings_case_insensitively() {
        for id in [
            "squat",
            "Back-Squat",
            "romanianDeadlift",
            "walking_lunge",
            "legpress",
            "Leg-Press",
            "leg_press",
        ] {
            assert!(is_lower_body_lift(id), "{id}");
        }
        for id in ["bench", "ohp", "row", "curl", "leg press"] {
            assert!(!is_lower_body_lift(id), "{id}");
        }
    }
}
