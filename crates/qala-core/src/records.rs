//! The stored record types: what Room holds on the phone and what the adapter reads
//! (docs/archive/completed.md, M1 as built, "Records").
//!
//! All JSON is camelCase, `Option` fields are omitted when `None`, and unknown fields are
//! ignored on read so a newer client's records still load. Instants are ISO 8601 strings with an
//! explicit offset (`2026-10-02T17:30:00-04:00`); parsing them is `time.rs`'s job. Dates that
//! mean a calendar day (`BodyWeightRecord.date`) are local `YYYY-MM-DD` keys.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub use crate::availability::{Availability, DaySkip};
pub use qala_lspp::exercise::Unit;

/// One logged set. Weight is in `unit`; the adapter converts every set to the user's unit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiftSetRecord {
    pub weight: f64,
    pub unit: Unit,
    /// Half reps are allowed.
    pub reps: f64,
    /// Logged RPE (RIR scale: 10 is zero reps in reserve), half steps allowed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rpe: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_rpe: Option<f64>,
    /// Defaults to false: a set that does not say it was completed does not count as work.
    #[serde(default)]
    pub completed: bool,
    #[serde(default)]
    pub warmup: bool,
    /// Flagged test or meet attempt.
    #[serde(default, rename = "tested1rm")]
    pub tested_1rm: bool,
    #[serde(default)]
    pub joint_pain: bool,
}

/// One exercise of a lift session. `exercise_id` is a liftosaur library id (`squat`,
/// `benchPress`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiftEntryRecord {
    pub exercise_id: String,
    #[serde(default)]
    pub sets: Vec<LiftSetRecord>,
}

/// A lifting session. A `stub` session is a "Mark done" placeholder with no sets.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiftSessionRecord {
    pub id: String,
    /// ISO 8601 with offset.
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub program_day_index: Option<u32>,
    #[serde(default)]
    pub stub: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minutes: Option<f64>,
    /// Session RPE, CR-10.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub srpe: Option<f64>,
    #[serde(default)]
    pub entries: Vec<LiftEntryRecord>,
}

/// A mean-grade segment of a run: grade as a fraction (0.05 is 5%), length in meters.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradeSegment {
    pub grade: f64,
    pub meters: f64,
}

/// A run. A stub run has no distance or times, so those fields default to 0 on read.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub id: String,
    /// ISO 8601 with offset: the run's start.
    pub started_at: String,
    #[serde(default)]
    pub distance_m: f64,
    /// Missing means the watch did not report it; use [`RunRecord::moving_or_elapsed_sec`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub moving_sec: Option<f64>,
    #[serde(default)]
    pub elapsed_sec: f64,
    #[serde(default)]
    pub stub: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub srpe: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minutes: Option<f64>,
    /// Banister TRIMP when heart rate was recorded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hr_trimp: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grade_profile: Option<Vec<GradeSegment>>,
    /// Meters descended on grades steeper than -5%.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub descent_m: Option<f64>,
}

impl RunRecord {
    /// Moving time, falling back to elapsed time when the record has none.
    pub fn moving_or_elapsed_sec(&self) -> f64 {
        self.moving_sec.unwrap_or(self.elapsed_sec)
    }
}

/// A stored session of either kind, tagged on `kind` (`"lift"` or `"run"`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SessionRecord {
    Lift(LiftSessionRecord),
    Run(RunRecord),
}

impl SessionRecord {
    pub fn id(&self) -> &str {
        match self {
            SessionRecord::Lift(s) => &s.id,
            SessionRecord::Run(r) => &r.id,
        }
    }

    /// ISO 8601 with offset.
    pub fn started_at(&self) -> &str {
        match self {
            SessionRecord::Lift(s) => &s.started_at,
            SessionRecord::Run(r) => &r.started_at,
        }
    }

    pub fn is_stub(&self) -> bool {
        match self {
            SessionRecord::Lift(s) => s.stub,
            SessionRecord::Run(r) => r.stub,
        }
    }
}

/// A morning check-in. The engine's `Checkin.prs` is this record's `recovery`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckInRecord {
    pub id: String,
    /// ISO 8601 with offset.
    pub at: String,
    /// 0 to 10.
    pub recovery: f64,
    /// Muscle id to soreness, 1 to 4.
    #[serde(default)]
    pub soreness: BTreeMap<String, u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BodyWeightRecord {
    pub id: String,
    /// Local `YYYY-MM-DD` key.
    pub date: String,
    pub kg: f64,
}

/// The settings the core reads. Missing fields take the defaults below, so `{}` is valid.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsRecord {
    /// Display and engine weight unit.
    pub unit: Unit,
    /// Liftosaur ids of the lifts the engine tracks as main lifts.
    pub main_lifts: Vec<String>,
    /// 0 is Monday, 6 is Sunday.
    pub training_weekdays: Vec<u8>,
}

impl Default for SettingsRecord {
    fn default() -> Self {
        SettingsRecord {
            unit: Unit::Lb,
            main_lifts: ["squat", "benchPress", "deadlift", "overheadPress"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
            training_weekdays: vec![0, 2, 4, 5],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    /// Every number as f64, so `135` in a sample equals the `135.0` a typed f64 writes back.
    fn norm(v: Value) -> Value {
        match v {
            Value::Number(n) => json!(n.as_f64()),
            Value::Array(a) => Value::Array(a.into_iter().map(norm).collect()),
            Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k, norm(v))).collect()),
            other => other,
        }
    }

    /// Parse, check the typed value, serialize back, and compare with the input as JSON values.
    fn round_trip<T>(sample: Value) -> T
    where
        T: Serialize + for<'de> Deserialize<'de>,
    {
        let typed: T = serde_json::from_value(sample.clone()).expect("sample parses");
        let back = serde_json::to_value(&typed).expect("serializes");
        assert_eq!(
            norm(back),
            norm(sample.clone()),
            "round trip changed the JSON"
        );
        // And through a string, which is how Room hands records over.
        let text = serde_json::to_string(&typed).expect("serializes to text");
        let again: T = serde_json::from_str(&text).expect("text parses");
        assert_eq!(
            norm(serde_json::to_value(&again).expect("serializes")),
            norm(sample)
        );
        typed
    }

    fn lift_sample() -> Value {
        json!({
            "kind": "lift",
            "id": "6f0c3a52-7c0e-4b8f-9d1b-2a5e1d0c9a11",
            "startedAt": "2026-10-02T17:30:00-04:00",
            "programDayIndex": 2,
            "stub": false,
            "minutes": 74.5,
            "srpe": 7.5,
            "entries": [
                {
                    "exerciseId": "squat",
                    "sets": [
                        { "weight": 135, "unit": "lb", "reps": 5, "completed": true, "warmup": true,
                          "tested1rm": false, "jointPain": false },
                        { "weight": 225.5, "unit": "lb", "reps": 4.5, "rpe": 8.5, "targetRpe": 8,
                          "completed": true, "warmup": false, "tested1rm": false, "jointPain": false },
                        { "weight": 102.5, "unit": "kg", "reps": 1, "rpe": 10, "completed": true,
                          "warmup": false, "tested1rm": true, "jointPain": true }
                    ]
                },
                { "exerciseId": "benchPress", "sets": [] }
            ]
        })
    }

    #[test]
    fn lift_session_round_trips() {
        let rec: SessionRecord = round_trip(lift_sample());
        let SessionRecord::Lift(s) = &rec else {
            panic!("expected a lift session");
        };
        assert_eq!(s.program_day_index, Some(2));
        assert_eq!(s.entries.len(), 2);
        let sets = &s.entries[0].sets;
        assert_eq!(sets[1].reps, 4.5);
        assert_eq!(sets[1].rpe, Some(8.5));
        assert_eq!(sets[1].target_rpe, Some(8.0));
        assert_eq!(sets[0].rpe, None);
        assert_eq!(sets[2].unit, Unit::Kg);
        assert!(sets[2].tested_1rm && sets[2].joint_pain && !sets[2].warmup);
        assert_eq!(rec.id(), "6f0c3a52-7c0e-4b8f-9d1b-2a5e1d0c9a11");
        assert_eq!(rec.started_at(), "2026-10-02T17:30:00-04:00");
        assert!(!rec.is_stub());
    }

    #[test]
    fn run_round_trips() {
        let rec: SessionRecord = round_trip(json!({
            "kind": "run",
            "id": "run-0001",
            "startedAt": "2026-10-03T07:05:00-04:00",
            "distanceM": 8046.7,
            "movingSec": 2580,
            "elapsedSec": 2711.5,
            "stub": false,
            "srpe": 6,
            "minutes": 45.2,
            "hrTrimp": 71.3,
            "gradeProfile": [
                { "grade": 0.012, "meters": 4000 },
                { "grade": -0.06, "meters": 1500.5 }
            ],
            "descentM": 90.03
        }));
        let SessionRecord::Run(r) = &rec else {
            panic!("expected a run");
        };
        assert_eq!(r.distance_m, 8046.7);
        assert_eq!(r.moving_or_elapsed_sec(), 2580.0);
        assert_eq!(r.grade_profile.as_ref().map(Vec::len), Some(2));
        assert_eq!(rec.id(), "run-0001");
        assert_eq!(rec.started_at(), "2026-10-03T07:05:00-04:00");
    }

    #[test]
    fn minimal_run_omits_every_optional_field() {
        let rec: RunRecord = round_trip(json!({
            "id": "r1",
            "startedAt": "2026-10-03T07:05:00-04:00",
            "distanceM": 5000.0,
            "elapsedSec": 1700.0,
            "stub": false
        }));
        assert_eq!(rec.moving_sec, None);
        assert_eq!(
            rec.moving_or_elapsed_sec(),
            1700.0,
            "missing movingSec falls back to elapsed"
        );
    }

    #[test]
    fn check_in_body_weight_and_settings_round_trip() {
        let c: CheckInRecord = round_trip(json!({
            "id": "c1",
            "at": "2026-10-02T07:10:00-04:00",
            "recovery": 7.5,
            "soreness": { "quads": 2, "lats": 1 },
            "note": "slept badly"
        }));
        assert_eq!(c.soreness.get("quads"), Some(&2));
        let bare: CheckInRecord = round_trip(json!({
            "id": "c2", "at": "2026-10-03T07:10:00-04:00", "recovery": 4, "soreness": {}
        }));
        assert_eq!(bare.note, None);

        let w: BodyWeightRecord =
            round_trip(json!({ "id": "w1", "date": "2026-10-02", "kg": 81.35 }));
        assert_eq!(w.kg, 81.35);

        let s: SettingsRecord = round_trip(json!({
            "unit": "kg",
            "mainLifts": ["squat", "benchPress", "deadlift", "overheadPress", "bentOverRow"],
            "trainingWeekdays": [1, 3, 5]
        }));
        assert_eq!(s.unit, Unit::Kg);
        assert_eq!(s.training_weekdays, vec![1, 3, 5]);
    }

    #[test]
    fn availability_types_are_reexported() {
        let a: Availability = round_trip(json!({ "status": "vacation", "since": "2026-10-05" }));
        assert_eq!(a.until, None);
        let s: DaySkip =
            round_trip(json!({ "date": "2026-10-04", "reason": "sick", "note": "flu" }));
        assert_eq!(s.note.as_deref(), Some("flu"));
    }

    #[test]
    fn defaults_apply() {
        // A "Mark done" stub: no sets, no distance, no times.
        let stub: SessionRecord = serde_json::from_value(json!({
            "kind": "lift", "id": "s1", "startedAt": "2026-10-02T17:30:00-04:00",
            "programDayIndex": 0, "stub": true
        }))
        .expect("stub lift parses");
        assert!(stub.is_stub());
        let SessionRecord::Lift(l) = &stub else {
            panic!("expected a lift session");
        };
        assert!(l.entries.is_empty());
        assert_eq!((l.minutes, l.srpe), (None, None));

        let stub_run: SessionRecord = serde_json::from_value(json!({
            "kind": "run", "id": "s2", "startedAt": "2026-10-02T17:30:00-04:00", "stub": true
        }))
        .expect("stub run parses");
        assert!(stub_run.is_stub());
        let SessionRecord::Run(r) = &stub_run else {
            panic!("expected a run");
        };
        assert_eq!(
            (r.distance_m, r.elapsed_sec, r.moving_sec),
            (0.0, 0.0, None)
        );

        // `stub` defaults to false, set flags default to false.
        let lift: SessionRecord = serde_json::from_value(json!({
            "kind": "lift", "id": "s3", "startedAt": "2026-10-02T17:30:00-04:00",
            "entries": [ { "exerciseId": "squat",
                           "sets": [ { "weight": 100, "unit": "kg", "reps": 5 } ] } ]
        }))
        .expect("sparse lift parses");
        assert!(!lift.is_stub());
        let SessionRecord::Lift(l) = &lift else {
            panic!("expected a lift session");
        };
        let set = &l.entries[0].sets[0];
        assert!(!set.completed && !set.warmup && !set.tested_1rm && !set.joint_pain);
        assert_eq!((set.rpe, set.target_rpe), (None, None));

        let entry: LiftEntryRecord =
            serde_json::from_value(json!({ "exerciseId": "squat" })).expect("entry parses");
        assert!(entry.sets.is_empty());

        let run: RunRecord = serde_json::from_value(
            json!({ "id": "r", "startedAt": "2026-10-02T07:00:00Z", "distanceM": 1000 }),
        )
        .expect("sparse run parses");
        assert!(!run.stub && run.grade_profile.is_none() && run.descent_m.is_none());

        let check: CheckInRecord = serde_json::from_value(
            json!({ "id": "c", "at": "2026-10-02T07:00:00Z", "recovery": 5 }),
        )
        .expect("check-in without soreness parses");
        assert!(check.soreness.is_empty());
    }

    #[test]
    fn settings_defaults() {
        let from_empty: SettingsRecord = serde_json::from_str("{}").expect("empty object parses");
        assert_eq!(from_empty, SettingsRecord::default());
        assert_eq!(from_empty.unit, Unit::Lb);
        assert_eq!(
            from_empty.main_lifts,
            ["squat", "benchPress", "deadlift", "overheadPress"]
        );
        assert_eq!(
            from_empty.training_weekdays,
            vec![0, 2, 4, 5],
            "Mon, Wed, Fri, Sat"
        );

        // A partial object keeps what it sets and defaults the rest.
        let partial: SettingsRecord =
            serde_json::from_str(r#"{"unit":"kg"}"#).expect("partial settings parse");
        assert_eq!(partial.unit, Unit::Kg);
        assert_eq!(partial.main_lifts, SettingsRecord::default().main_lifts);
        assert_eq!(
            partial.training_weekdays,
            SettingsRecord::default().training_weekdays
        );
        let days: SettingsRecord =
            serde_json::from_str(r#"{"trainingWeekdays":[]}"#).expect("empty weekdays parse");
        assert!(
            days.training_weekdays.is_empty(),
            "an explicit empty list is kept"
        );
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let rec: SessionRecord = serde_json::from_value(json!({
            "kind": "run", "id": "r", "startedAt": "2026-10-02T07:00:00Z", "distanceM": 1000,
            "trackBlobId": "abc", "futureField": { "a": 1 }
        }))
        .expect("unknown fields tolerated");
        assert_eq!(rec.id(), "r");
        let s: SettingsRecord =
            serde_json::from_str(r#"{"unit":"kg","theme":"dark"}"#).expect("tolerated");
        assert_eq!(s.unit, Unit::Kg);
        let set: LiftSetRecord = serde_json::from_value(
            json!({ "weight": 1, "unit": "lb", "reps": 1, "completed": true, "tempo": "3010" }),
        )
        .expect("tolerated");
        assert!(set.completed);
    }

    #[test]
    fn bad_records_are_errors_not_panics() {
        for bad in [
            json!({ "kind": "swim", "id": "x", "startedAt": "2026-10-02T07:00:00Z" }),
            json!({ "id": "x", "startedAt": "2026-10-02T07:00:00Z" }),
            json!({ "kind": "lift", "startedAt": "2026-10-02T07:00:00Z" }),
            json!({ "kind": "lift", "id": "x" }),
            json!({ "kind": "lift", "id": "x", "startedAt": "t", "entries": [ { "sets": [] } ] }),
            json!({ "kind": "lift", "id": "x", "startedAt": "t",
                    "entries": [ { "exerciseId": "squat",
                                   "sets": [ { "weight": 1, "unit": "stone", "reps": 1 } ] } ] }),
            json!({ "kind": "run", "id": "x", "startedAt": "t", "distanceM": "far" }),
        ] {
            assert!(
                serde_json::from_value::<SessionRecord>(bad.clone()).is_err(),
                "{bad}"
            );
        }
        assert!(serde_json::from_str::<SettingsRecord>(r#"{"unit":"stone"}"#).is_err());
        assert!(serde_json::from_str::<SettingsRecord>(r#"{"trainingWeekdays":[300]}"#).is_err());
    }

    #[test]
    fn session_tag_is_the_lowercase_kind() {
        let rec = SessionRecord::Run(RunRecord {
            id: "r".to_string(),
            started_at: "2026-10-02T07:00:00Z".to_string(),
            distance_m: 1000.0,
            moving_sec: None,
            elapsed_sec: 300.0,
            stub: false,
            srpe: None,
            minutes: None,
            hr_trimp: None,
            grade_profile: None,
            descent_m: None,
        });
        let v = serde_json::to_value(&rec).expect("serializes");
        assert_eq!(v["kind"], "run");
        assert_eq!(
            v,
            json!({ "kind": "run", "id": "r", "startedAt": "2026-10-02T07:00:00Z",
                    "distanceM": 1000.0, "elapsedSec": 300.0, "stub": false })
        );
    }
}
