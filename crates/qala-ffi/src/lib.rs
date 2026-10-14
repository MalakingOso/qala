//! UniFFI shim over `qala-core` and `qala-lspp-json` for Kotlin. Strings in, strings out;
//! failures come back as `QalaError`. On success the string is the envelope
//! `{"v":1,"result":...}`. Request shapes are documented in `qala-core::api` and
//! `qala-lspp-json`. One crate, one `.so`, so the app loads a single native library.

use qala_core::api as core_api;
use qala_lspp_json as api;

uniffi::setup_scaffolding!();

#[derive(Debug, uniffi::Error)]
#[uniffi(flat_error)]
pub enum QalaError {
    InvalidInput(String),
    Evaluation(String),
    Internal(String),
}

impl std::fmt::Display for QalaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            QalaError::InvalidInput(m) | QalaError::Evaluation(m) | QalaError::Internal(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for QalaError {}

impl From<api::ApiError> for QalaError {
    fn from(e: api::ApiError) -> Self {
        match e {
            api::ApiError::InvalidInput(m) => QalaError::InvalidInput(m),
            api::ApiError::Evaluation(m) => QalaError::Evaluation(m),
            api::ApiError::Internal(m) => QalaError::Internal(m),
        }
    }
}

impl From<core_api::ApiError> for QalaError {
    fn from(e: core_api::ApiError) -> Self {
        match e {
            core_api::ApiError::InvalidInput(m) => QalaError::InvalidInput(m),
            core_api::ApiError::Evaluation(m) => QalaError::Evaluation(m),
            core_api::ApiError::Internal(m) => QalaError::Internal(m),
        }
    }
}

/// Envelope version of the JSON boundary; the Kotlin side checks it at startup.
#[uniffi::export]
pub fn api_version() -> u32 {
    core_api::VERSION
}

// qala-core: engine, availability, HLC, derived numbers.

#[uniffi::export]
pub fn log_session(request: String) -> Result<String, QalaError> {
    Ok(core_api::log_session(&request)?)
}

#[uniffi::export]
pub fn calibrate(request: String) -> Result<String, QalaError> {
    Ok(core_api::calibrate(&request)?)
}

#[uniffi::export]
pub fn predict_readiness(request: String) -> Result<String, QalaError> {
    Ok(core_api::predict_readiness(&request)?)
}

#[uniffi::export]
pub fn build_engine_state(request: String) -> Result<String, QalaError> {
    Ok(core_api::build_engine_state(&request)?)
}

#[uniffi::export]
pub fn readiness_summary(request: String) -> Result<String, QalaError> {
    Ok(core_api::readiness_summary(&request)?)
}

#[uniffi::export]
pub fn week_load(request: String) -> Result<String, QalaError> {
    Ok(core_api::week_load(&request)?)
}

#[uniffi::export]
pub fn weight_trend(request: String) -> Result<String, QalaError> {
    Ok(core_api::weight_trend(&request)?)
}

#[uniffi::export]
pub fn classify_day(request: String) -> Result<String, QalaError> {
    Ok(core_api::classify_day(&request)?)
}

#[uniffi::export]
pub fn reason_on(request: String) -> Result<String, QalaError> {
    Ok(core_api::reason_on(&request)?)
}

#[uniffi::export]
pub fn injured_on(request: String) -> Result<String, QalaError> {
    Ok(core_api::injured_on(&request)?)
}

#[uniffi::export]
pub fn guard_exercise(request: String) -> Result<String, QalaError> {
    Ok(core_api::guard_exercise(&request)?)
}

#[uniffi::export]
pub fn shifts_plan(request: String) -> Result<String, QalaError> {
    Ok(core_api::shifts_plan(&request)?)
}

#[uniffi::export]
pub fn hlc_compare(request: String) -> Result<String, QalaError> {
    Ok(core_api::hlc_compare(&request)?)
}

#[uniffi::export]
pub fn hlc_tick(request: String) -> Result<String, QalaError> {
    Ok(core_api::hlc_tick(&request)?)
}

#[uniffi::export]
pub fn hlc_receive(request: String) -> Result<String, QalaError> {
    Ok(core_api::hlc_receive(&request)?)
}

#[uniffi::export]
pub fn hlc_merge_field(request: String) -> Result<String, QalaError> {
    Ok(core_api::hlc_merge_field(&request)?)
}

#[uniffi::export]
pub fn exercise_muscles(request: String) -> Result<String, QalaError> {
    Ok(core_api::exercise_muscles(&request)?)
}

#[uniffi::export]
pub fn plan_plates(request: String) -> Result<String, QalaError> {
    Ok(core_api::plan_plates(&request)?)
}

#[uniffi::export]
pub fn round_weight(request: String) -> Result<String, QalaError> {
    Ok(core_api::round_weight(&request)?)
}

#[uniffi::export]
pub fn choose_next_plates(request: String) -> Result<String, QalaError> {
    Ok(core_api::choose_next_plates(&request)?)
}

#[uniffi::export]
pub fn describe_change(request: String) -> Result<String, QalaError> {
    Ok(core_api::describe_change(&request)?)
}

#[uniffi::export]
pub fn plates_shorthand(request: String) -> Result<String, QalaError> {
    Ok(core_api::plates_shorthand(&request)?)
}

// LS++ evaluation API.
#[uniffi::export]
pub fn force_evaluate_text(request: String) -> Result<String, QalaError> {
    Ok(api::force_evaluate_text(&request)?)
}

#[uniffi::export]
pub fn evaluate_qala_program(request: String) -> Result<String, QalaError> {
    Ok(api::evaluate_qala_program(&request)?)
}

#[uniffi::export]
pub fn qala_settings_to_liftoscript(request: String) -> Result<String, QalaError> {
    Ok(api::qala_settings_to_liftoscript(&request)?)
}

#[uniffi::export]
pub fn create_engine_bindings(request: String) -> Result<String, QalaError> {
    Ok(api::create_engine_bindings(&request)?)
}

#[uniffi::export]
pub fn get_day(request: String) -> Result<String, QalaError> {
    Ok(api::get_day(&request)?)
}

#[uniffi::export]
pub fn next_history_entry(request: String) -> Result<String, QalaError> {
    Ok(api::next_history_entry(&request)?)
}

#[uniffi::export]
pub fn run_update_script_for_entry(request: String) -> Result<String, QalaError> {
    Ok(api::run_update_script_for_entry(&request)?)
}

#[uniffi::export]
pub fn run_finish_day_script(request: String) -> Result<String, QalaError> {
    Ok(api::run_finish_day_script(&request)?)
}

#[uniffi::export]
pub fn run_all_finish_day_scripts(request: String) -> Result<String, QalaError> {
    Ok(api::run_all_finish_day_scripts(&request)?)
}

#[uniffi::export]
pub fn diagnose_planner(request: String) -> Result<String, QalaError> {
    Ok(api::diagnose_planner(&request)?)
}

#[uniffi::export]
pub fn diagnose_script(request: String) -> Result<String, QalaError> {
    Ok(api::diagnose_script(&request)?)
}

// Dry run and editor tools. `dry_run` and `unresolved_sets` take a request object; `lint_planner`
// and `format_planner` take the raw program text, like `diagnose_planner`.
#[uniffi::export]
pub fn dry_run(request: String) -> Result<String, QalaError> {
    Ok(api::dry_run(&request)?)
}

#[uniffi::export]
pub fn unresolved_sets(request: String) -> Result<String, QalaError> {
    Ok(api::unresolved_sets(&request)?)
}

#[uniffi::export]
pub fn lint_planner(request: String) -> Result<String, QalaError> {
    Ok(api::lint_planner(&request)?)
}

#[uniffi::export]
pub fn format_planner(request: String) -> Result<String, QalaError> {
    Ok(api::format_planner(&request)?)
}

