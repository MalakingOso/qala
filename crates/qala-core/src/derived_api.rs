//! JSON entry points for the adapter and the derived numbers (docs/archive/completed.md, M1 as built, API
//! table). `api.rs` re-exports the four functions.
//!
//! Every request is a JSON object with `"v": 1` and camelCase fields; unknown fields are
//! ignored. Every success is the envelope `{"v":1,"result":...}`. A request that is not JSON,
//! has a missing or wrong `v`, or lacks a field is `ApiError::InvalidInput`; so is a planned
//! value the math cannot use (a negative number of sets). A date or instant that does not parse,
//! a week start that is not a Monday, or a non-finite number anywhere in a result is
//! `ApiError::Evaluation`.
//!
//! Record shapes (`SessionRecord`, `CheckInRecord`, `SettingsRecord`, `BodyWeightRecord`) are the
//! serde types in `records.rs`. A session record is `{"kind":"lift", ...}` or `{"kind":"run",
//! ...}`.
//!
//! | function | request | result |
//! |---|---|---|
//! | `build_engine_state` | `{records, checkins, settings}` | `{state, warnings}` |
//! | `readiness_summary` | `{records, checkins, settings, now, offsetMin, sessionMuscles?}` | `{today, checkedInToday, average28d, checkinCount28d, readyDates}` |
//! | `week_load` | `{planned, records, settings, weekStart}` | `{planned, done, warnings}` |
//! | `weight_trend` | `{weights, today}` | the trend object, or `null` |
//!
//! `build_engine_state`: `state` is the TS-shaped `EngineState`; `warnings` is a list of
//! `unknown exercise: <id>` strings.
//!
//! `readiness_summary`: `now` is an ISO instant with offset, `offsetMin` the caller's UTC offset
//! in minutes (`-240` for EDT) used to turn instants into local dates. `today` is a `Readiness`
//! (`score`, `prsZ` or `null`, `prsFlag`, `soreBlockedMuscles`, `reasons`); `average28d` is a
//! number or `null`; `readyDates` is `[{muscle, date, capped}]` with `date` a local
//! `YYYY-MM-DD` key.
//!
//! `week_load` planned input: `planned` is an array of exactly 7 entries, Monday first. Each
//! entry is one of
//!
//! ```json
//! {"kind":"rest"}
//! {"kind":"lift","exercises":[{"exerciseId":"squat","sets":3,"targetRpe":8}]}
//! {"kind":"run","distanceM":8000,"zone":1.0}
//! ```
//!
//! `targetRpe` is optional (8 when absent). `zone` is `0.5`, `1.0` or `1.5`, or the string
//! `"easy"`, `"steady"` or `"hard"`. `weekStart` is a local `YYYY-MM-DD` Monday. The result's
//! `planned` and `done` are arrays of 7 numbers (Monday first); `warnings` lists
//! `unknown exercise: <id>` for exercise ids that are not in the library.
//!
//! `weight_trend` result (when not `null`): `{latestKg, avg7Kg, prevAvg7Kg?, deltaPerWeekKg?,
//! direction: "up"|"down"|"flat", runDays}`; the two optional fields are omitted when the
//! previous window has no weights.

use crate::adapter::{self, AdapterError};
use crate::api::{ok, ApiError, ApiResult, VERSION};
use crate::derived::{self, DerivedError, PlannedDay};
use crate::records::{BodyWeightRecord, CheckInRecord, SessionRecord, SettingsRecord};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

/// Parses a request, checking `"v"` first so a version mismatch reads clearly.
fn parse_request<T: DeserializeOwned>(request: &str) -> Result<T, ApiError> {
    let value: Value = serde_json::from_str(request)
        .map_err(|e| ApiError::InvalidInput(format!("request is not valid JSON: {e}")))?;
    match value.get("v").and_then(Value::as_u64) {
        Some(v) if v == u64::from(VERSION) => {}
        Some(v) => {
            return Err(ApiError::InvalidInput(format!(
                "unsupported request version {v}, expected {VERSION}"
            )))
        }
        None => {
            return Err(ApiError::InvalidInput(
                "request needs a numeric \"v\" field".to_string(),
            ))
        }
    }
    serde_json::from_value(value).map_err(|e| ApiError::InvalidInput(format!("bad request: {e}")))
}

fn adapter_err(e: AdapterError) -> ApiError {
    ApiError::Evaluation(e.to_string())
}

fn derived_err(e: DerivedError) -> ApiError {
    match e {
        DerivedError::Invalid(m) => ApiError::InvalidInput(m),
        other => ApiError::Evaluation(other.to_string()),
    }
}

fn require_finite(x: f64, what: &str) -> Result<(), ApiError> {
    if x.is_finite() {
        Ok(())
    } else {
        Err(ApiError::Evaluation(format!(
            "{what} is not a finite number"
        )))
    }
}

/// `serde_json` writes a non-finite `f64` as `null`, and an `EngineState` has no legitimate
/// `null` (absent optionals are omitted), so any `null` in it is a non-finite number.
fn reject_nulls(v: &Value, path: &str) -> Result<(), ApiError> {
    match v {
        Value::Null => Err(ApiError::Evaluation(format!("non-finite number at {path}"))),
        Value::Array(items) => items
            .iter()
            .enumerate()
            .try_for_each(|(i, x)| reject_nulls(x, &format!("{path}[{i}]"))),
        Value::Object(map) => map
            .iter()
            .try_for_each(|(k, x)| reject_nulls(x, &format!("{path}.{k}"))),
        _ => Ok(()),
    }
}

fn to_value<T: serde::Serialize>(v: &T) -> Result<Value, ApiError> {
    serde_json::to_value(v).map_err(|e| ApiError::Internal(format!("cannot write result: {e}")))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildEngineStateRequest {
    records: Vec<SessionRecord>,
    checkins: Vec<CheckInRecord>,
    settings: SettingsRecord,
}

/// `{records, checkins, settings}` to `{state, warnings}`: see [`adapter::build_engine_state`].
pub fn build_engine_state(request: &str) -> ApiResult {
    let req: BuildEngineStateRequest = parse_request(request)?;
    let out = adapter::build_engine_state(&req.records, &req.checkins, &req.settings)
        .map_err(adapter_err)?;
    let state = to_value(&out.state)?;
    reject_nulls(&state, "state")?;
    ok(json!({ "state": state, "warnings": out.warnings }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadinessSummaryRequest {
    records: Vec<SessionRecord>,
    checkins: Vec<CheckInRecord>,
    settings: SettingsRecord,
    now: String,
    offset_min: i32,
    #[serde(default)]
    session_muscles: Option<Vec<String>>,
}

/// UTC offsets are within a day either way.
const MAX_OFFSET_MIN: i32 = 24 * 60;

/// `{records, checkins, settings, now, offsetMin, sessionMuscles?}` to the readiness summary:
/// see [`derived::readiness_summary`].
pub fn readiness_summary(request: &str) -> ApiResult {
    let req: ReadinessSummaryRequest = parse_request(request)?;
    if req.offset_min.abs() > MAX_OFFSET_MIN {
        return Err(ApiError::InvalidInput(format!(
            "offsetMin {} is out of range",
            req.offset_min
        )));
    }
    let summary = derived::readiness_summary(
        &req.records,
        &req.checkins,
        &req.settings,
        &req.now,
        i64::from(req.offset_min),
        req.session_muscles.as_deref(),
    )
    .map_err(derived_err)?;
    require_finite(summary.today.score, "today.score")?;
    if let Some(z) = summary.today.prs_z {
        require_finite(z, "today.prsZ")?;
    }
    if let Some(a) = summary.average_28d {
        require_finite(a, "average28d")?;
    }
    ok(to_value(&summary)?)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WeekLoadRequest {
    planned: [PlannedDay; 7],
    records: Vec<SessionRecord>,
    settings: SettingsRecord,
    week_start: String,
}

/// `{planned, records, settings, weekStart}` to `{planned, done, warnings}`: see
/// [`derived::planned_week_load`] and [`derived::done_week_load`].
pub fn week_load(request: &str) -> ApiResult {
    let req: WeekLoadRequest = parse_request(request)?;
    let planned = derived::planned_week_load(&req.planned).map_err(derived_err)?;
    let done = derived::done_week_load(&req.week_start, &req.records, &req.settings)
        .map_err(derived_err)?;
    for (name, load) in [("planned", &planned.load), ("done", &done.load)] {
        for (i, x) in load.iter().enumerate() {
            require_finite(*x, &format!("{name}[{i}]"))?;
        }
    }
    let mut warnings = planned.warnings;
    for w in done.warnings {
        if !warnings.contains(&w) {
            warnings.push(w);
        }
    }
    ok(json!({ "planned": planned.load, "done": done.load, "warnings": warnings }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WeightTrendRequest {
    weights: Vec<BodyWeightRecord>,
    today: String,
}

/// `{weights, today}` to the weight trend or `null`: see [`derived::weight_trend`].
pub fn weight_trend(request: &str) -> ApiResult {
    let req: WeightTrendRequest = parse_request(request)?;
    match derived::weight_trend(&req.weights, &req.today).map_err(derived_err)? {
        None => ok(Value::Null),
        Some(t) => {
            require_finite(t.latest_kg, "latestKg")?;
            require_finite(t.avg7_kg, "avg7Kg")?;
            if let Some(p) = t.prev_avg7_kg {
                require_finite(p, "prevAvg7Kg")?;
            }
            if let Some(d) = t.delta_per_week_kg {
                require_finite(d, "deltaPerWeekKg")?;
            }
            ok(to_value(&t)?)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    type EntryPoint = fn(&str) -> ApiResult;

    /// Calls `f` and returns the envelope's `result`.
    fn call(f: EntryPoint, request: Value) -> Result<Value, ApiError> {
        let text = f(&request.to_string())?;
        let envelope: Value = serde_json::from_str(&text).expect("envelope is JSON");
        assert_eq!(envelope["v"], 1);
        Ok(envelope["result"].clone())
    }

    fn kind(r: Result<Value, ApiError>) -> &'static str {
        r.expect_err("expected an error").kind()
    }

    fn squat_record(id: &str, at: &str, sets: usize) -> Value {
        let set = json!({"weight": 225, "unit": "lb", "reps": 5, "rpe": 8, "completed": true});
        json!({"kind": "lift", "id": id, "startedAt": at,
               "entries": [{"exerciseId": "squat", "sets": vec![set; sets]}]})
    }

    fn close(a: &Value, e: f64) -> bool {
        a.as_f64()
            .is_some_and(|a| (a - e).abs() <= 1e-9 * a.abs().max(e.abs()) + 1e-12)
    }

    // ---- shared request handling ----

    #[test]
    fn every_function_rejects_bad_json_and_versions() {
        let fns: [(&str, EntryPoint); 4] = [
            ("build_engine_state", build_engine_state),
            ("readiness_summary", readiness_summary),
            ("week_load", week_load),
            ("weight_trend", weight_trend),
        ];
        for (name, f) in fns {
            for bad in [
                "",
                "not json",
                "[]",
                "{}",
                r#"{"v":"1"}"#,
                r#"{"v":1.5}"#,
                r#"{"v":2}"#,
            ] {
                let e = f(bad).expect_err(name);
                assert_eq!(e.kind(), "invalid_input", "{name}: {bad}");
            }
        }
        let e = weight_trend(r#"{"v":2,"weights":[],"today":"2026-10-14"}"#).unwrap_err();
        assert!(e.message().contains("version 2"), "{}", e.message());
    }

    // ---- build_engine_state ----

    fn build_request() -> Value {
        json!({
            "v": 1,
            "records": [squat_record("a", "2026-10-01T17:30:00-04:00", 3)],
            "checkins": [{"id": "c", "at": "2026-10-01T17:00:00-04:00", "recovery": 7,
                          "soreness": {"quads": 2}}],
            "settings": {"unit": "lb"}
        })
    }

    #[test]
    fn build_engine_state_happy_path() {
        let r = call(build_engine_state, build_request()).unwrap();
        assert_eq!(r["warnings"], json!([]));
        let s = &r["state"];
        assert_eq!(s["updated"], "2026-10-01T17:30:00-04:00");
        assert!(close(&s["fatigueMuscle"]["quads"], 3.0));
        assert!(close(&s["fatigueMuscle"]["glutes"], 1.5));
        assert_eq!(s["prsHistory"][0]["value"], 7);
        assert_eq!(s["lastCheckin"]["soreness"]["quads"], 2);
        assert_eq!(
            s["mainLifts"],
            json!(["squat", "benchPress", "deadlift", "overheadPress"])
        );
    }

    #[test]
    fn build_engine_state_ignores_unknown_fields_and_reports_warnings() {
        let mut req = build_request();
        req["extra"] = json!({"anything": true});
        req["records"][0]["entries"][0]["exerciseId"] = json!("zzz");
        req["records"][0]["somethingNew"] = json!(1);
        let r = call(build_engine_state, req).unwrap();
        assert_eq!(r["warnings"], json!(["unknown exercise: zzz"]));
    }

    #[test]
    fn build_engine_state_missing_fields_are_invalid_input() {
        for field in ["records", "checkins", "settings"] {
            let mut req = build_request();
            req.as_object_mut().unwrap().remove(field);
            assert_eq!(
                kind(call(build_engine_state, req)),
                "invalid_input",
                "{field}"
            );
        }
        let mut req = build_request();
        req["records"][0]
            .as_object_mut()
            .unwrap()
            .remove("startedAt");
        assert_eq!(kind(call(build_engine_state, req)), "invalid_input");
        let mut req = build_request();
        req["records"][0]["kind"] = json!("swim");
        assert_eq!(kind(call(build_engine_state, req)), "invalid_input");
    }

    #[test]
    fn build_engine_state_bad_dates_are_evaluation_errors() {
        let mut req = build_request();
        req["records"][0]["startedAt"] = json!("2026-02-30T17:30:00-04:00");
        assert_eq!(kind(call(build_engine_state, req)), "evaluation");
        let mut req = build_request();
        req["checkins"][0]["at"] = json!("this morning");
        assert_eq!(kind(call(build_engine_state, req)), "evaluation");
        let mut req = build_request();
        req["records"][0]["startedAt"] = json!("2026-10-01T17:30:00");
        assert_eq!(kind(call(build_engine_state, req)), "evaluation");
    }

    #[test]
    fn non_finite_state_is_an_evaluation_error() {
        let mut req = build_request();
        let set = json!({"weight": 1e300, "unit": "lb", "reps": 1e300, "completed": true});
        req["records"][0]["entries"][0]["sets"] = json!([set]);
        assert_eq!(kind(call(build_engine_state, req)), "evaluation");
    }

    // ---- readiness_summary ----

    fn summary_request() -> Value {
        json!({
            "v": 1,
            "records": [squat_record("w", "2026-10-01T17:30:00-04:00", 8)],
            "checkins": [{"id": "c", "at": "2026-10-02T08:00:00-04:00", "recovery": 5,
                          "soreness": {"quads": 4}}],
            "settings": {},
            "now": "2026-10-02T13:00:00-04:00",
            "offsetMin": -240
        })
    }

    #[test]
    fn readiness_summary_happy_path() {
        let r = call(readiness_summary, summary_request()).unwrap();
        assert_eq!(r["checkedInToday"], true);
        assert_eq!(r["checkinCount28d"], 1);
        assert_eq!(r["today"]["soreBlockedMuscles"], json!(["quads"]));
        assert_eq!(r["today"]["prsFlag"], false);
        assert_eq!(r["today"]["prsZ"], Value::Null);
        assert!(r["average28d"].is_number());
        assert!(r["today"]["score"].as_f64().unwrap() < 1.0);
        let dates = r["readyDates"].as_array().unwrap();
        assert!(dates
            .iter()
            .any(|d| d["muscle"] == "quads" && d["capped"] == false));
        assert!(dates
            .iter()
            .all(|d| d["date"].as_str().unwrap().len() == 10));
    }

    #[test]
    fn readiness_summary_without_history_has_a_null_average() {
        let mut req = summary_request();
        req["records"] = json!([]);
        req["checkins"] = json!([]);
        req["sessionMuscles"] = json!(["quads", "glutes"]);
        let r = call(readiness_summary, req).unwrap();
        assert_eq!(r["average28d"], Value::Null);
        assert_eq!(r["checkinCount28d"], 0);
        assert_eq!(r["checkedInToday"], false);
        assert_eq!(r["today"]["score"], 1.0);
        assert_eq!(r["readyDates"], json!([]));
    }

    #[test]
    fn readiness_summary_session_muscles_change_the_score() {
        let mut with = summary_request();
        with["checkins"] = json!([]);
        let base = call(readiness_summary, with.clone()).unwrap();
        // No muscles named and no check-in soreness: only systemic fatigue counts, which is 0.
        assert_eq!(base["today"]["score"], 1.0);
        with["sessionMuscles"] = json!(["quads"]);
        let named = call(readiness_summary, with).unwrap();
        assert!(named["today"]["score"].as_f64().unwrap() < 1.0);
        assert_eq!(named["today"]["reasons"], json!(["local-fatigue"]));
    }

    #[test]
    fn readiness_summary_missing_fields_are_invalid_input() {
        for field in ["records", "checkins", "settings", "now", "offsetMin"] {
            let mut req = summary_request();
            req.as_object_mut().unwrap().remove(field);
            assert_eq!(
                kind(call(readiness_summary, req)),
                "invalid_input",
                "{field}"
            );
        }
        let mut req = summary_request();
        req["offsetMin"] = json!(5000);
        assert_eq!(kind(call(readiness_summary, req)), "invalid_input");
        let mut req = summary_request();
        req["offsetMin"] = json!("-240");
        assert_eq!(kind(call(readiness_summary, req)), "invalid_input");
    }

    #[test]
    fn readiness_summary_bad_dates_are_evaluation_errors() {
        let mut req = summary_request();
        req["now"] = json!("today");
        assert_eq!(kind(call(readiness_summary, req)), "evaluation");
        let mut req = summary_request();
        req["checkins"][0]["at"] = json!("2026-13-02T08:00:00-04:00");
        assert_eq!(kind(call(readiness_summary, req)), "evaluation");
        let mut req = summary_request();
        req["now"] = json!("2026-10-02T13:00:00");
        assert_eq!(kind(call(readiness_summary, req)), "evaluation");
    }

    // ---- week_load ----

    fn week_request() -> Value {
        json!({
            "v": 1,
            "planned": [
                {"kind": "lift", "exercises": [{"exerciseId": "squat", "sets": 3}]},
                {"kind": "rest"},
                {"kind": "run", "distanceM": 8000, "zone": 1.0},
                {"kind": "rest"},
                {"kind": "lift", "exercises": [{"exerciseId": "nope", "sets": 3, "targetRpe": 9}]},
                {"kind": "run", "distanceM": 12000, "zone": "hard"},
                {"kind": "rest"}
            ],
            "records": [squat_record("a", "2026-09-14T17:30:00-04:00", 3)],
            "settings": {},
            "weekStart": "2026-09-14"
        })
    }

    #[test]
    fn week_load_happy_path() {
        let r = call(week_load, week_request()).unwrap();
        let planned = r["planned"].as_array().unwrap();
        let done = r["done"].as_array().unwrap();
        assert_eq!((planned.len(), done.len()), (7, 7));
        assert!(close(&planned[0], 7.5));
        assert!(close(&planned[2], 1.44 * 2.7));
        assert_eq!(planned[4], 0.0);
        assert!(close(&planned[5], 3.24 * 3.1));
        assert!(close(&done[0], 7.5));
        assert_eq!(done[1], 0.0);
        assert_eq!(r["warnings"], json!(["unknown exercise: nope"]));
    }

    #[test]
    fn week_load_missing_fields_and_bad_shapes_are_invalid_input() {
        for field in ["planned", "records", "settings", "weekStart"] {
            let mut req = week_request();
            req.as_object_mut().unwrap().remove(field);
            assert_eq!(kind(call(week_load, req)), "invalid_input", "{field}");
        }
        // Not exactly 7 days.
        let mut req = week_request();
        req["planned"].as_array_mut().unwrap().pop();
        assert_eq!(kind(call(week_load, req)), "invalid_input");
        let mut req = week_request();
        req["planned"]
            .as_array_mut()
            .unwrap()
            .push(json!({"kind": "rest"}));
        assert_eq!(kind(call(week_load, req)), "invalid_input");
        // Unknown kind, bad zone, missing distance.
        for bad in [
            json!({"kind": "swim"}),
            json!({"kind": "run", "distanceM": 5000, "zone": 3}),
            json!({"kind": "run", "zone": 1.0}),
            json!({"kind": "lift"}),
        ] {
            let mut req = week_request();
            req["planned"][1] = bad;
            assert_eq!(kind(call(week_load, req)), "invalid_input");
        }
        // Numbers the math cannot use.
        let mut req = week_request();
        req["planned"][0]["exercises"][0]["sets"] = json!(-2);
        assert_eq!(kind(call(week_load, req)), "invalid_input");
        let mut req = week_request();
        req["planned"][2]["distanceM"] = json!(-1);
        assert_eq!(kind(call(week_load, req)), "invalid_input");
    }

    #[test]
    fn week_load_bad_dates_are_evaluation_errors() {
        let mut req = week_request();
        req["weekStart"] = json!("2026-09-31");
        assert_eq!(kind(call(week_load, req)), "evaluation");
        // A valid date that is not a Monday.
        let mut req = week_request();
        req["weekStart"] = json!("2026-09-15");
        assert_eq!(kind(call(week_load, req)), "evaluation");
        let mut req = week_request();
        req["records"][0]["startedAt"] = json!("last Monday");
        assert_eq!(kind(call(week_load, req)), "evaluation");
    }

    // ---- weight_trend ----

    fn weights_request(kgs: &[f64]) -> Value {
        let weights: Vec<Value> = kgs
            .iter()
            .enumerate()
            .map(|(i, kg)| {
                json!({"id": format!("w{i}"), "date": format!("2026-10-{:02}", 1 + i), "kg": kg})
            })
            .collect();
        json!({"v": 1, "weights": weights, "today": format!("2026-10-{:02}", kgs.len())})
    }

    #[test]
    fn weight_trend_happy_path_and_null() {
        let kgs: Vec<f64> = (0..14).map(|k| 82.0 - 0.15 * f64::from(k)).collect();
        let r = call(weight_trend, weights_request(&kgs)).unwrap();
        assert!(close(&r["latestKg"], 80.05));
        assert!(close(&r["avg7Kg"], 80.5));
        assert!(close(&r["prevAvg7Kg"], 81.55));
        assert!(close(&r["deltaPerWeekKg"], -1.05));
        assert_eq!(r["direction"], "down");
        assert_eq!(r["runDays"], 11);
        // Too little data is `null`, not an error.
        let r = call(weight_trend, weights_request(&[80.0, 80.1])).unwrap();
        assert_eq!(r, Value::Null);
        let r = call(
            weight_trend,
            json!({"v": 1, "weights": [], "today": "2026-10-14"}),
        )
        .unwrap();
        assert_eq!(r, Value::Null);
    }

    #[test]
    fn weight_trend_missing_fields_are_invalid_input() {
        for field in ["weights", "today"] {
            let mut req = weights_request(&[80.0; 5]);
            req.as_object_mut().unwrap().remove(field);
            assert_eq!(kind(call(weight_trend, req)), "invalid_input", "{field}");
        }
        let mut req = weights_request(&[80.0; 5]);
        req["weights"][0].as_object_mut().unwrap().remove("kg");
        assert_eq!(kind(call(weight_trend, req)), "invalid_input");
    }

    #[test]
    fn weight_trend_bad_dates_are_evaluation_errors() {
        let mut req = weights_request(&[80.0; 5]);
        req["today"] = json!("2026-10-32");
        assert_eq!(kind(call(weight_trend, req)), "evaluation");
        let mut req = weights_request(&[80.0; 5]);
        req["weights"][2]["date"] = json!("yesterday");
        assert_eq!(kind(call(weight_trend, req)), "evaluation");
    }

    #[test]
    fn non_finite_trend_is_an_evaluation_error() {
        // The sum of three huge weights overflows to infinity.
        let req = weights_request(&[1.7e308; 3]);
        assert_eq!(kind(call(weight_trend, req)), "evaluation");
    }
}
