//! JSON string boundary over `qala-core` (docs/PLAN-m1-rust-core.md, API table).
//!
//! Every function takes one request JSON string and returns the success envelope
//! `{"v":1,"result":...}` as a string, or an `ApiError`. Same shape and conventions as
//! `qala-lspp-json`. Bodies are filled in as the modules land.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::availability::{self, Availability, DaySkip, SkipReason};
use crate::engine::{readiness, session, state::{Checkin, EngineState, Workout}};
use crate::hlc::{self, Field, Hlc};
use crate::time::TimeError;

pub const VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApiError {
    /// The request was not valid JSON, had the wrong version or was missing a field.
    InvalidInput(String),
    /// The inputs were valid but the computation could not finish (non-finite number, bad date).
    Evaluation(String),
    Internal(String),
}

impl ApiError {
    pub fn kind(&self) -> &'static str {
        match self {
            ApiError::InvalidInput(_) => "invalid_input",
            ApiError::Evaluation(_) => "evaluation",
            ApiError::Internal(_) => "internal",
        }
    }
    pub fn message(&self) -> &str {
        match self {
            ApiError::InvalidInput(m) | ApiError::Evaluation(m) | ApiError::Internal(m) => m,
        }
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for ApiError {}

pub type ApiResult = Result<String, ApiError>;

/// `{"v":1,"error":{"kind":...,"message":...}}`, for shims that return errors as data (wasm).
pub fn error_envelope(e: &ApiError) -> String {
    serde_json::json!({ "v": VERSION, "error": { "kind": e.kind(), "message": e.message() } }).to_string()
}

/// Wrap a result value in the success envelope.
pub fn ok(result: Value) -> ApiResult {
    Ok(serde_json::json!({ "v": VERSION, "result": result }).to_string())
}



// ---------------------------------------------------------------------------
// Request plumbing
// ---------------------------------------------------------------------------

/// Parse a request: valid JSON, `"v": 1`, then the typed fields.
pub(crate) fn parse_request<T: DeserializeOwned>(request: &str) -> Result<T, ApiError> {
    let value: Value = serde_json::from_str(request)
        .map_err(|e| ApiError::InvalidInput(format!("request is not valid JSON: {e}")))?;
    match value.get("v").and_then(Value::as_u64) {
        Some(1) => {}
        Some(other) => return Err(ApiError::InvalidInput(format!("unsupported request version {other}"))),
        None => return Err(ApiError::InvalidInput("request needs \"v\": 1".to_string())),
    }
    serde_json::from_value(value).map_err(|e| ApiError::InvalidInput(e.to_string()))
}

/// Serialize a result into the envelope. Non-finite numbers cannot be told apart from `null` once
/// written, so any float that serde would turn into `null` through a plain `f64` field is checked
/// by the callers that carry raw floats; `serde_json::to_value` itself never fails for these types.
pub(crate) fn respond<T: Serialize>(value: &T) -> ApiResult {
    let v = serde_json::to_value(value).map_err(|e| ApiError::Internal(format!("serialize: {e}")))?;
    ok(v)
}

fn time_err(e: TimeError) -> ApiError {
    ApiError::Evaluation(format!("bad date {:?}: {}", e.input, e.reason))
}

fn hlc_err(e: hlc::HlcError) -> ApiError {
    ApiError::Evaluation(format!("{}: {e:?}", e.kind()))
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct LogSessionReq {
    state: EngineState,
    workout: Workout,
}

/// `{v, state, workout}` -> the next `EngineState`.
pub fn log_session(request: &str) -> ApiResult {
    let r: LogSessionReq = parse_request(request)?;
    let next = session::log_session(&r.state, &r.workout).map_err(time_err)?;
    respond(&next)
}

#[derive(Deserialize)]
struct CalibrateReq {
    history: Vec<Workout>,
}

/// `{v, history}` -> the `EngineState` rebuilt from the workouts (stable sort by instant).
pub fn calibrate(request: &str) -> ApiResult {
    let r: CalibrateReq = parse_request(request)?;
    let state = session::calibrate(&r.history).map_err(time_err)?;
    respond(&state)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PredictReadinessReq {
    state: EngineState,
    checkin: Checkin,
    #[serde(default)]
    session_muscles: Option<Vec<String>>,
    now: String,
}

/// `{v, state, checkin, sessionMuscles?, now}` -> `Readiness`, fatigue decayed to `now`.
pub fn predict_readiness(request: &str) -> ApiResult {
    let r: PredictReadinessReq = parse_request(request)?;
    let out = readiness::predict_readiness(&r.state, &r.checkin, r.session_muscles.as_deref(), &r.now)
        .map_err(time_err)?;
    respond(&out)
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct DayReq {
    date: String,
    #[serde(default)]
    availability: Availability,
    #[serde(default)]
    skips: Vec<DaySkip>,
}

/// `{v, date, availability?, skips?}` -> `"train" | "rest" | "shift"`.
pub fn classify_day(request: &str) -> ApiResult {
    let r: DayReq = parse_request(request)?;
    respond(&availability::classify_day(&r.date, &r.availability, &r.skips))
}

/// `{v, date, availability?, skips?}` -> the skip reason or `null`.
pub fn reason_on(request: &str) -> ApiResult {
    let r: DayReq = parse_request(request)?;
    respond(&availability::reason_on(&r.date, &r.availability, &r.skips))
}

/// `{v, date, availability?, skips?}` -> the injured muscle ids that day (at most one).
pub fn injured_on(request: &str) -> ApiResult {
    let r: DayReq = parse_request(request)?;
    respond(&availability::injured_on(&r.date, &r.availability, &r.skips))
}

#[derive(Deserialize)]
struct GuardReq {
    targets: Vec<String>,
    #[serde(default)]
    synergists: Option<Vec<String>>,
    #[serde(default)]
    injured: Vec<String>,
}

/// `{v, targets, synergists?, injured?}` -> `"train" | "halve" | "skip"`.
pub fn guard_exercise(request: &str) -> ApiResult {
    let r: GuardReq = parse_request(request)?;
    respond(&availability::guard_exercise(&r.targets, r.synergists.as_deref(), &r.injured))
}

#[derive(Deserialize)]
struct ShiftsReq {
    reason: SkipReason,
}

/// `{v, reason}` -> whether the reason pushes the plan out (vacation and sick).
pub fn shifts_plan(request: &str) -> ApiResult {
    let r: ShiftsReq = parse_request(request)?;
    respond(&availability::shifts_plan(r.reason))
}

// ---------------------------------------------------------------------------
// Muscles
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExerciseMusclesReq {
    exercise_ids: Vec<String>,
}

/// `{v, exerciseIds}` -> `{ "<id>": {targets, synergists} | null }`: the engine muscle ids of each
/// liftosaur exercise (targets first, synergists never repeat a target). Unknown ids map to `null`.
/// The check-in screen uses this to list the muscles a program day trains.
pub fn exercise_muscles(request: &str) -> ApiResult {
    let r: ExerciseMusclesReq = parse_request(request)?;
    let mut out = std::collections::BTreeMap::new();
    for id in r.exercise_ids {
        let muscles = crate::muscles::exercise_muscles(&id);
        out.insert(id, muscles);
    }
    respond(&out)
}

// ---------------------------------------------------------------------------
// Hybrid logical clock (golden-only until the sync endpoint exists)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct HlcCompareReq {
    a: Hlc,
    b: Hlc,
}

/// `{v, a, b}` with `{wallMs, counter, nodeId}` clocks -> `-1`, `0` or `1`.
pub fn hlc_compare(request: &str) -> ApiResult {
    let r: HlcCompareReq = parse_request(request)?;
    r.a.validate().map_err(hlc_err)?;
    r.b.validate().map_err(hlc_err)?;
    respond(&(r.a.cmp(&r.b) as i32))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HlcTickReq {
    hlc: Hlc,
    now_ms: i64,
}

/// `{v, hlc, nowMs}` -> the clock after a local event.
pub fn hlc_tick(request: &str) -> ApiResult {
    let r: HlcTickReq = parse_request(request)?;
    r.hlc.validate().map_err(hlc_err)?;
    respond(&r.hlc.tick(r.now_ms).map_err(hlc_err)?)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HlcReceiveReq {
    local: Hlc,
    remote: Hlc,
    now_ms: i64,
    max_drift_ms: i64,
}

/// `{v, local, remote, nowMs, maxDriftMs}` -> the clock after receiving a remote write.
pub fn hlc_receive(request: &str) -> ApiResult {
    let r: HlcReceiveReq = parse_request(request)?;
    r.local.validate().map_err(hlc_err)?;
    r.remote.validate().map_err(hlc_err)?;
    respond(&r.local.receive(&r.remote, r.now_ms, r.max_drift_ms).map_err(hlc_err)?)
}

#[derive(Deserialize)]
struct HlcMergeReq {
    local: Field<Value>,
    remote: Field<Value>,
}

/// `{v, local: {value, hlc}, remote: {value, hlc}}` -> the winning field.
pub fn hlc_merge_field(request: &str) -> ApiResult {
    let r: HlcMergeReq = parse_request(request)?;
    r.local.hlc.validate().map_err(hlc_err)?;
    r.remote.hlc.validate().map_err(hlc_err)?;
    respond(&hlc::merge_field(&r.local, &r.remote))
}

// Adapter and derived numbers live in derived_api.rs.
pub use crate::derived_api::{build_engine_state, readiness_summary, week_load, weight_trend};

#[cfg(test)]
mod tests {
    use super::*;

    fn result(out: ApiResult) -> Value {
        let v: Value = serde_json::from_str(&out.unwrap()).unwrap();
        assert_eq!(v["v"], 1);
        v["result"].clone()
    }

    #[test]
    fn rejects_bad_requests() {
        for f in [log_session, calibrate, predict_readiness, classify_day, hlc_tick] {
            assert!(matches!(f("nope"), Err(ApiError::InvalidInput(_))));
            assert!(matches!(f("{}"), Err(ApiError::InvalidInput(_))));
            assert!(matches!(f(r#"{"v":2}"#), Err(ApiError::InvalidInput(_))));
        }
    }

    #[test]
    fn calibrate_then_readiness_on_empty_history() {
        let state = result(calibrate(r#"{"v":1,"history":[]}"#));
        assert_eq!(state["fatigueSystemic"], 0);
        let req = serde_json::json!({
            "v": 1, "state": state,
            "checkin": { "prs": 8, "soreness": {} },
            "now": "2026-10-02T08:00:00-04:00",
        });
        let r = result(predict_readiness(&req.to_string()));
        assert_eq!(r["score"], 1);
        assert_eq!(r["reasons"], serde_json::json!([]));
    }

    #[test]
    fn bad_dates_are_evaluation_errors() {
        let state = result(calibrate(r#"{"v":1,"history":[]}"#));
        let req = serde_json::json!({
            "v": 1, "state": state,
            "checkin": { "prs": 8, "soreness": {} },
            "now": "yesterday",
        });
        assert!(matches!(predict_readiness(&req.to_string()), Err(ApiError::Evaluation(_))));
    }

    #[test]
    fn availability_calls() {
        let req = r#"{"v":1,"date":"2026-10-03","availability":{"status":"sick","since":"2026-10-01"},"skips":[]}"#;
        assert_eq!(result(classify_day(req)), "shift");
        assert_eq!(result(reason_on(req)), "sick");
        assert_eq!(result(shifts_plan(r#"{"v":1,"reason":"break"}"#)), false);
        assert_eq!(
            result(guard_exercise(r#"{"v":1,"targets":["quads"],"injured":["quadriceps"]}"#)),
            "skip"
        );
        let inj = r#"{"v":1,"date":"2026-10-03","availability":{"status":"injured","since":"2026-10-01","muscle":"calves"}}"#;
        assert_eq!(result(injured_on(inj)), serde_json::json!(["calves"]));
    }

    #[test]
    fn exercise_muscles_lookup() {
        let r = result(exercise_muscles(r#"{"v":1,"exerciseIds":["squat","noSuchLift"]}"#));
        assert!(r["noSuchLift"].is_null());
        let targets = r["squat"]["targets"].as_array().unwrap();
        assert!(targets.iter().any(|m| m == "quads"));
        assert!(matches!(exercise_muscles(r#"{"v":1}"#), Err(ApiError::InvalidInput(_))));
    }

    #[test]
    fn hlc_calls() {
        let a = serde_json::json!({ "wallMs": 1000, "counter": 0, "nodeId": "a" });
        let b = serde_json::json!({ "wallMs": 1000, "counter": 1, "nodeId": "a" });
        let cmp = serde_json::json!({ "v": 1, "a": a, "b": b });
        assert_eq!(result(hlc_compare(&cmp.to_string())), -1);
        let tick = serde_json::json!({ "v": 1, "hlc": a, "nowMs": 1000 });
        assert_eq!(result(hlc_tick(&tick.to_string()))["counter"], 1);
        let drift = serde_json::json!({ "v": 1, "local": a, "remote": { "wallMs": 9000000, "counter": 0, "nodeId": "b" }, "nowMs": 1000, "maxDriftMs": 1000 });
        assert!(matches!(hlc_receive(&drift.to_string()), Err(ApiError::Evaluation(_))));
        let merge = serde_json::json!({ "v": 1, "local": { "value": 1, "hlc": a }, "remote": { "value": 2, "hlc": b } });
        assert_eq!(result(hlc_merge_field(&merge.to_string()))["value"], 2);
    }
}

