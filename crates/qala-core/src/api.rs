//! JSON string boundary over `qala-core` (docs/PLAN-m1-rust-core.md, API table).
//!
//! Every function takes one request JSON string and returns the success envelope
//! `{"v":1,"result":...}` as a string, or an `ApiError`. Same shape and conventions as
//! `qala-lspp-json`. Bodies are filled in as the modules land.

use serde_json::Value;

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

pub(crate) fn todo(name: &str) -> ApiResult {
    Err(ApiError::Internal(format!("{name}: not implemented yet")))
}

pub fn log_session(_request: &str) -> ApiResult { todo("log_session") }
pub fn calibrate(_request: &str) -> ApiResult { todo("calibrate") }
pub fn predict_readiness(_request: &str) -> ApiResult { todo("predict_readiness") }
pub fn classify_day(_request: &str) -> ApiResult { todo("classify_day") }
pub fn reason_on(_request: &str) -> ApiResult { todo("reason_on") }
pub fn injured_on(_request: &str) -> ApiResult { todo("injured_on") }
pub fn guard_exercise(_request: &str) -> ApiResult { todo("guard_exercise") }
pub fn shifts_plan(_request: &str) -> ApiResult { todo("shifts_plan") }
pub fn hlc_compare(_request: &str) -> ApiResult { todo("hlc_compare") }
pub fn hlc_tick(_request: &str) -> ApiResult { todo("hlc_tick") }
pub fn hlc_receive(_request: &str) -> ApiResult { todo("hlc_receive") }
pub fn hlc_merge_field(_request: &str) -> ApiResult { todo("hlc_merge_field") }

// Adapter and derived numbers live in derived_api.rs.
pub use crate::derived_api::{build_engine_state, readiness_summary, week_load, weight_trend};
