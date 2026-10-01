//! wasm-bindgen shim over `qala-liftoscript-json`. Every export takes a JSON string
//! and returns a JSON envelope string: `{"v":1,"result":...}` or
//! `{"v":1,"error":{"kind","message"}}`. Errors are values, never exceptions.
//! Request shapes and the uid arguments (`uids`, `uidSeed`) are documented in
//! `qala-liftoscript-json`. The exports are plain functions, so native tests call them directly.

use qala_liftoscript_json as api;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = forceEvaluateText)]
pub fn force_evaluate_text(request: &str) -> String {
    api::envelope(api::force_evaluate_text(request))
}

#[wasm_bindgen(js_name = evaluateQalaProgram)]
pub fn evaluate_qala_program(request: &str) -> String {
    api::envelope(api::evaluate_qala_program(request))
}

#[wasm_bindgen(js_name = qalaSettingsToLiftoscript)]
pub fn qala_settings_to_liftoscript(request: &str) -> String {
    api::envelope(api::qala_settings_to_liftoscript(request))
}

#[wasm_bindgen(js_name = createEngineBindings)]
pub fn create_engine_bindings(request: &str) -> String {
    api::envelope(api::create_engine_bindings(request))
}

#[wasm_bindgen(js_name = getDay)]
pub fn get_day(request: &str) -> String {
    api::envelope(api::get_day(request))
}

#[wasm_bindgen(js_name = nextHistoryEntry)]
pub fn next_history_entry(request: &str) -> String {
    api::envelope(api::next_history_entry(request))
}

#[wasm_bindgen(js_name = runUpdateScriptForEntry)]
pub fn run_update_script_for_entry(request: &str) -> String {
    api::envelope(api::run_update_script_for_entry(request))
}

#[wasm_bindgen(js_name = runFinishDayScript)]
pub fn run_finish_day_script(request: &str) -> String {
    api::envelope(api::run_finish_day_script(request))
}

#[wasm_bindgen(js_name = runAllFinishDayScripts)]
pub fn run_all_finish_day_scripts(request: &str) -> String {
    api::envelope(api::run_all_finish_day_scripts(request))
}

#[wasm_bindgen(js_name = diagnosePlanner)]
pub fn diagnose_planner(request: &str) -> String {
    api::envelope(api::diagnose_planner(request))
}

#[wasm_bindgen(js_name = diagnoseScript)]
pub fn diagnose_script(request: &str) -> String {
    api::envelope(api::diagnose_script(request))
}

