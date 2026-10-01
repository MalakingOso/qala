//! UniFFI shim over `qala-liftoscript-json` for Kotlin. Strings in, strings out;
//! failures come back as `QalaError`. On success the string is the envelope
//! `{"v":1,"result":...}`. Request shapes and the uid arguments (`uids`, `uidSeed`)
//! are documented in `qala-liftoscript-json`.

use qala_liftoscript_json as api;

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

