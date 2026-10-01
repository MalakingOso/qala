//! JSON string boundary over `qala-lspp` (docs/rust-core.md section 3).
//!
//! Every function takes one request JSON string and returns the success envelope
//! `{"v":1,"result":...}` as a string, or an `ApiError`. The wasm shim turns an error
//! into `{"v":1,"error":{"kind":...,"message":...}}` with `error_envelope`; the UniFFI
//! shim maps it to the `QalaError` enum. Nothing here reads a clock, does I/O or panics
//! across the boundary: a panic inside the library is caught and returned as
//! `ApiError::Internal` (only effective when the build unwinds; the release profile
//! uses `panic = "abort"`, where input validation is the defence).
//!
//! Request shape: a JSON object with `"v": 1` plus named fields, the same names the
//! golden inputs use (`programText`, `settings`, `program`, `day`, `exerciseKey`, ...).
//!
//! Ids: APIs that mint ids take `"uids"` (array of strings, consumed first, in order)
//! and `"uidSeed"` (u64, default 0). Once `uids` runs out, ids come from
//! `SequentialUid::starting_at(uidSeed)`. Same request, same output, always.

use std::collections::VecDeque;
use std::panic::{catch_unwind, AssertUnwindSafe};

use indexmap::IndexMap;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use qala_lspp::program;
use qala_lspp::runtime::{
    self, CoreProgram, CoreSettings, EngineBindingsInput, FinishDayOpts, RunAllOpts,
};
use qala_lspp::types::{
    IDayData, IEvaluatedProgram, IHistoryEntry, IProgramState, ISettings, IStats,
};
use qala_lspp::util::generator::{SequentialUid, UidSource};

pub const VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApiError {
    /// The request was not valid JSON, had the wrong version or was missing a field.
    InvalidInput(String),
    /// The library rejected the request (script error, no such day or exercise).
    Evaluation(String),
    /// A panic was caught.
    Internal(String),
}

impl ApiError {
    pub fn kind(&self) -> &'static str {
        match self {
            ApiError::InvalidInput(_) => "invalidInput",
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
        write!(f, "{}: {}", self.kind(), self.message())
    }
}

impl std::error::Error for ApiError {}

pub type ApiResult = Result<String, ApiError>;

/// Error value as a JSON envelope, for shims that return a plain string.
pub fn error_envelope(e: &ApiError) -> String {
    serde_json::json!({ "v": VERSION, "error": { "kind": e.kind(), "message": e.message() } }).to_string()
}

/// Success or error as one envelope string.
pub fn envelope(r: ApiResult) -> String {
    r.unwrap_or_else(|e| error_envelope(&e))
}

// ---------------------------------------------------------------------------
// plumbing

fn ok<T: Serialize>(value: &T) -> ApiResult {
    let body = serde_json::to_string(value).map_err(|e| ApiError::Internal(format!("serialize: {e}")))?;
    Ok(format!("{{\"v\":{VERSION},\"result\":{body}}}"))
}

fn guarded(f: impl FnOnce() -> ApiResult) -> ApiResult {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(r) => r,
        Err(p) => {
            let msg = p
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_else(|| "panic".to_string());
            Err(ApiError::Internal(msg))
        }
    }
}

/// Parses a request, checking `"v"` first so a version mismatch reads clearly.
fn parse_request<T: DeserializeOwned>(request: &str) -> Result<T, ApiError> {
    let value: Value =
        serde_json::from_str(request).map_err(|e| ApiError::InvalidInput(format!("request is not valid JSON: {e}")))?;
    match value.get("v").and_then(Value::as_u64) {
        Some(v) if v == VERSION as u64 => {}
        Some(v) => return Err(ApiError::InvalidInput(format!("unsupported request version {v}, expected {VERSION}"))),
        None => return Err(ApiError::InvalidInput("request needs a numeric \"v\" field".to_string())),
    }
    serde_json::from_value(value).map_err(|e| ApiError::InvalidInput(format!("bad request: {e}")))
}

struct RequestUid {
    queue: VecDeque<String>,
    seq: SequentialUid,
}

impl RequestUid {
    fn new(uids: Option<Vec<String>>, seed: Option<u64>) -> Self {
        RequestUid { queue: uids.unwrap_or_default().into(), seq: SequentialUid::starting_at(seed.unwrap_or(0)) }
    }
}

impl UidSource for RequestUid {
    fn generate_uid(&mut self, length: usize) -> String {
        match self.queue.pop_front() {
            Some(u) => u,
            None => self.seq.generate_uid(length),
        }
    }
}

fn day_data_of(p: &IEvaluatedProgram, day: i64) -> Result<IDayData, ApiError> {
    let d = program::get_program_day(p, day).ok_or_else(|| ApiError::Evaluation(format!("no day {day}")))?;
    Ok(IDayData { week: Some(d.day_data.week), day: d.day_data.day, day_in_week: Some(d.day_data.day_in_week) })
}

// ---------------------------------------------------------------------------
// evaluation

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForceEvaluateReq {
    program_text: String,
    name: String,
    settings: ISettings,
    uids: Option<Vec<String>>,
    uid_seed: Option<u64>,
}

/// `forceEvaluateText`. Request: `{v, programText, name, settings, uids?, uidSeed?}`.
/// Result: the evaluated program.
pub fn force_evaluate_text(request: &str) -> ApiResult {
    guarded(|| {
        let r: ForceEvaluateReq = parse_request(request)?;
        let mut uid = RequestUid::new(r.uids, r.uid_seed);
        ok(&runtime::force_evaluate_text(&r.program_text, &r.name, &r.settings, &mut uid))
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EvaluateQalaReq {
    core_program: CoreProgram,
    core_settings: CoreSettings,
    uids: Option<Vec<String>>,
    uid_seed: Option<u64>,
}

/// `evaluateQalaProgram`. Request: `{v, coreProgram, coreSettings, uids?, uidSeed?}`.
pub fn evaluate_qala_program(request: &str) -> ApiResult {
    guarded(|| {
        let r: EvaluateQalaReq = parse_request(request)?;
        let mut uid = RequestUid::new(r.uids, r.uid_seed);
        ok(&runtime::evaluate_qala_program(&r.core_program, &r.core_settings, &mut uid))
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoreSettingsReq {
    core_settings: CoreSettings,
}

/// `qalaSettingsToLiftoscript`. Request: `{v, coreSettings}`.
pub fn qala_settings_to_liftoscript(request: &str) -> ApiResult {
    guarded(|| {
        let r: CoreSettingsReq = parse_request(request)?;
        ok(&runtime::qala_settings_to_liftoscript(&r.core_settings))
    })
}

#[derive(Deserialize)]
struct EngineBindingsReq {
    #[serde(default)]
    input: Option<EngineBindingsInput>,
}

/// `createEngineBindings`. Request: `{v, input?}`.
pub fn create_engine_bindings(request: &str) -> ApiResult {
    guarded(|| {
        let r: EngineBindingsReq = parse_request(request)?;
        ok(&runtime::create_engine_bindings(r.input.as_ref()))
    })
}

#[derive(Deserialize)]
struct GetDayReq {
    program: IEvaluatedProgram,
    day: i64,
}

/// `getDay`. Request: `{v, program, day}`. Result: `{dayData, exercises}` or null.
pub fn get_day(request: &str) -> ApiResult {
    guarded(|| {
        let r: GetDayReq = parse_request(request)?;
        ok(&runtime::get_day(&r.program, r.day))
    })
}

// ---------------------------------------------------------------------------
// history entries and scripts

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NextHistoryEntryReq {
    program: IEvaluatedProgram,
    day: i64,
    exercise_key: String,
    index: i64,
    stats: IStats,
    settings: ISettings,
    uids: Option<Vec<String>>,
    uid_seed: Option<u64>,
}

/// `Program_nextHistoryEntry`.
/// Request: `{v, program, day, exerciseKey, index, stats, settings, uids?, uidSeed?}`.
pub fn next_history_entry(request: &str) -> ApiResult {
    guarded(|| {
        let r: NextHistoryEntryReq = parse_request(request)?;
        let dd = day_data_of(&r.program, r.day)?;
        let pe = program::get_program_exercise_for_key_and_day(&r.program, r.day, &r.exercise_key)
            .ok_or_else(|| ApiError::Evaluation(format!("no program exercise {}", r.exercise_key)))?;
        let mut uid = RequestUid::new(r.uids, r.uid_seed);
        let entry = program::next_history_entry(&r.program, &dd, r.index, &pe, &r.stats, &r.settings, &mut uid)
            .map_err(|e| ApiError::Evaluation(e.to_string()))?;
        ok(&entry)
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateScriptReq {
    program: IEvaluatedProgram,
    day: i64,
    exercise_key: String,
    entry: IHistoryEntry,
    #[serde(default)]
    other_states: IndexMap<String, IProgramState>,
    set_index: i64,
    stats: IStats,
    settings: ISettings,
    uids: Option<Vec<String>>,
    uid_seed: Option<u64>,
}

/// `runUpdateScriptForEntry`.
/// Request: `{v, program, day, exerciseKey, entry, otherStates?, setIndex, stats, settings, uids?, uidSeed?}`.
pub fn run_update_script_for_entry(request: &str) -> ApiResult {
    guarded(|| {
        let r: UpdateScriptReq = parse_request(request)?;
        let dd = day_data_of(&r.program, r.day)?;
        let pe = program::get_program_exercise_for_key_and_day(&r.program, r.day, &r.exercise_key)
            .ok_or_else(|| ApiError::Evaluation(format!("no program exercise {}", r.exercise_key)))?;
        let mut uid = RequestUid::new(r.uids, r.uid_seed);
        let out = runtime::run_update_script_for_entry(
            &r.entry, &dd, &pe, &r.other_states, r.set_index, &r.settings, &r.stats, &mut uid,
        )
        .map_err(|e| ApiError::Evaluation(e.to_string()))?;
        ok(&out)
    })
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FinishDayOptsReq {
    #[serde(default)]
    engine: Option<EngineBindingsInput>,
    #[serde(default)]
    user_prompted_state_vars: Option<IProgramState>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FinishDayReq {
    program: IEvaluatedProgram,
    day: i64,
    exercise_key: String,
    entry: IHistoryEntry,
    stats: IStats,
    settings: ISettings,
    #[serde(default)]
    opts: Option<FinishDayOptsReq>,
}

/// `runFinishDayScript`. Request: `{v, program, day, exerciseKey, entry, stats, settings, opts?}`
/// with `opts = {engine?, userPromptedStateVars?}`. Result: `{vtype/success...}` as the TS `IEither`.
pub fn run_finish_day_script(request: &str) -> ApiResult {
    guarded(|| {
        let r: FinishDayReq = parse_request(request)?;
        let dd = day_data_of(&r.program, r.day)?;
        let pe = program::get_program_exercise_for_key_and_day(&r.program, r.day, &r.exercise_key)
            .ok_or_else(|| ApiError::Evaluation(format!("no program exercise {}", r.exercise_key)))?;
        let opts = r.opts.unwrap_or_default();
        let out = runtime::run_finish_day_script(
            &pe,
            &r.program,
            &dd,
            &r.entry,
            &r.settings,
            &r.stats,
            &FinishDayOpts { user_prompted_state_vars: opts.user_prompted_state_vars.as_ref(), engine: opts.engine.as_ref() },
        );
        ok(&out)
    })
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RunAllOptsReq {
    #[serde(default)]
    engine_by_key: IndexMap<String, EngineBindingsInput>,
    #[serde(default)]
    user_prompted_state_vars: Option<IndexMap<String, IProgramState>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunAllReq {
    program: IEvaluatedProgram,
    day: i64,
    entries: Vec<IHistoryEntry>,
    stats: IStats,
    settings: ISettings,
    #[serde(default)]
    opts: Option<RunAllOptsReq>,
    uids: Option<Vec<String>>,
    uid_seed: Option<u64>,
}

/// `runAllFinishDayScripts`.
/// Request: `{v, program, day, entries, stats, settings, opts?, uids?, uidSeed?}` with
/// `opts = {engineByKey?, userPromptedStateVars?}`; `engineByKey` is keyed by the entry's
/// `programExerciseId`.
pub fn run_all_finish_day_scripts(request: &str) -> ApiResult {
    guarded(|| {
        let r: RunAllReq = parse_request(request)?;
        let opts = r.opts.unwrap_or_default();
        let engine_for = |e: &IHistoryEntry| -> Option<EngineBindingsInput> {
            e.program_exercise_id.as_ref().and_then(|id| opts.engine_by_key.get(id).copied())
        };
        let mut uid = RequestUid::new(r.uids, r.uid_seed);
        let out = runtime::run_all_finish_day_scripts(
            &r.program,
            r.day,
            &r.entries,
            &r.settings,
            &r.stats,
            RunAllOpts {
                on_error: None,
                engine_for: Some(&engine_for),
                user_prompted_state_vars: opts.user_prompted_state_vars.as_ref(),
            },
            &mut uid,
        )
        .map_err(|e| ApiError::Evaluation(e.message))?;
        ok(&out)
    })
}

// ---------------------------------------------------------------------------
// diagnostics for the desktop editor

pub use qala_lspp::diagnostics::Diagnostic;

/// Diagnostics for planner text: one per outermost error node, UTF-16 offsets.
pub fn planner_diagnostics(text: &str) -> Vec<Diagnostic> {
    qala_lspp::diagnostics::planner_diagnostics(text)
}

/// Diagnostics for liftoscript source: one per outermost error node, UTF-16 offsets.
pub fn script_diagnostics(text: &str) -> Vec<Diagnostic> {
    qala_lspp::diagnostics::script_diagnostics(text)
}

/// `diagnose_planner(text)`: `text` is the raw program text, not a request object.
/// Result: array of `{from, to, message, line, col, endLine, endCol, suggestion?}` (line and col
/// are 1-based), empty when the text parses cleanly.
pub fn diagnose_planner(text: &str) -> ApiResult {
    guarded(|| ok(&planner_diagnostics(text)))
}

/// `diagnose_script(text)`: raw liftoscript source, same result shape as `diagnose_planner`.
pub fn diagnose_script(text: &str) -> ApiResult {
    guarded(|| ok(&script_diagnostics(text)))
}

// ---------------------------------------------------------------------------
// lint

/// `lint_planner(text)`: `text` is the raw program text. Result: array of
/// `{code, from, to, message, line, col, endLine, endCol, suggestion}` (UTF-16 offsets,
/// 1-based line and col), empty when nothing looks wrong. Text with syntax errors yields an
/// empty array; call `diagnose_planner` for those.
pub fn lint_planner(text: &str) -> ApiResult {
    guarded(|| ok(&qala_lspp::lint::lint_planner(text)))
}

// ---------------------------------------------------------------------------
// fmt

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FormatOk {
    ok: bool,
    text: String,
    changed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FormatRefused {
    ok: bool,
    reason: String,
    diagnostics: Vec<Diagnostic>,
}

/// `format_planner(text)`: `text` is the raw program text. Result is `{ok: true, text, changed}`,
/// or `{ok: false, reason, diagnostics}` when the text has syntax errors (nothing is
/// formatted, `reason` is "syntax") or when formatting could not be proven safe (`reason`
/// says why and `diagnostics` is empty).
pub fn format_planner(text: &str) -> ApiResult {
    guarded(|| match qala_lspp::fmt::format_planner(text) {
        Ok(out) => {
            let changed = out != text;
            ok(&FormatOk { ok: true, text: out, changed })
        }
        Err(qala_lspp::fmt::FormatError::Syntax(diagnostics)) => {
            ok(&FormatRefused { ok: false, reason: "syntax".to_string(), diagnostics })
        }
        Err(e @ qala_lspp::fmt::FormatError::Unsafe(_)) => {
            ok(&FormatRefused { ok: false, reason: e.to_string(), diagnostics: vec![] })
        }
    })
}
