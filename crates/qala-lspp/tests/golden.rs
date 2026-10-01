//! End-to-end golden tests: replay every case in `testdata/golden/liftoscript/`
//! through the Rust port and compare against the TS oracle's recorded output.
//!
//! Comparison rules (see the golden README):
//! - object key order matters (JSON objects compare as ordered key lists),
//!   except objects with `vtype` "set" or "history_entry" and evaluated sets
//!   (`isQuickAddSet`), whose field order depends on how the TS built them and
//!   is not data;
//! - an expected `"<uid>"` accepts any non-empty string;
//! - expected `"NaN"`, `"Infinity"`, `"-Infinity"` strings read as `null`
//!   (what `JSON.stringify` and the Rust serializer write for non-finite numbers);
//! - `liftoscriptNode` keys are dropped on both sides, the dumper's `$error`
//!   class marker is dropped from expected values, and a Rust `stateKeys`
//!   array reads as `{}` (what `JSON.stringify` writes for a JS `Set`);
//! - a `$pruned` output is compared against its `value`, with the actual output
//!   pruned the same way (a `reuse` nested inside another `reuse` is removed).
//!   The SHA-256 of the unpruned output is not checked: it covers real ids the
//!   Rust side cannot reproduce.

use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};

use indexmap::IndexMap;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{Map, Value};

use qala_lspp::program;
use qala_lspp::runtime::{
    self, CoreProgram, CoreSettings, EngineBindingsInput, FinishDayOpts, LiftEntry, LiftSession, PlannedSet,
    RunAllOpts,
};
use qala_lspp::types::{
    IDayData, IEvaluatedProgram, IExerciseType, IHistoryEntry, IProgramState, IScriptBindings, ISettings, IStats,
};
use qala_lspp::util::generator::SequentialUid;
use qala_lspp::{planner_program, progress};

fn golden_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../testdata/golden/liftoscript")
}

fn load(path: &Path) -> Value {
    let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()))
}

fn files_in(dir: &Path, prefix: &str) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("read_dir {}: {e}", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.extension().is_some_and(|x| x == "json")
                && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with(prefix))
        })
        .collect();
    v.sort();
    v
}

// ---------------------------------------------------------------------------
// comparison

/// Field order of these objects depends on how the TS built them (and, for
/// evaluated sets, on which scripts later assigned `weight`), not on data.
fn is_unordered_object(m: &Map<String, Value>) -> bool {
    matches!(m.get("vtype").and_then(Value::as_str), Some("set") | Some("history_entry"))
        || (m.contains_key("isQuickAddSet") && m.contains_key("askWeight"))
}

/// Expected side: non-finite number strings become null, lezer nodes and
/// `liftoscriptNode` keys are dropped.
fn norm_expected(v: &Value) -> Value {
    match v {
        Value::String(s) if s == "NaN" || s == "Infinity" || s == "-Infinity" => Value::Null,
        Value::Array(a) => Value::Array(a.iter().map(norm_expected).collect()),
        Value::Object(m) => {
            let mut out = Map::new();
            for (k, x) in m {
                if k == "liftoscriptNode" || k == "$error" {
                    continue;
                }
                out.insert(k.clone(), norm_expected(x));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

fn norm_actual(v: &Value) -> Value {
    match v {
        Value::Array(a) => Value::Array(a.iter().map(norm_actual).collect()),
        Value::Object(m) => {
            let mut out = Map::new();
            for (k, x) in m {
                if k == "liftoscriptNode" {
                    continue;
                }
                if k == "stateKeys" && x.is_array() {
                    out.insert(k.clone(), Value::Object(Map::new()));
                    continue;
                }
                out.insert(k.clone(), norm_actual(x));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

/// Removes every `reuse` that sits inside another `reuse`.
fn prune_reuse(v: &Value, in_reuse: bool) -> Value {
    match v {
        Value::Array(a) => Value::Array(a.iter().map(|x| prune_reuse(x, in_reuse)).collect()),
        Value::Object(m) => {
            let mut out = Map::new();
            for (k, x) in m {
                if k == "reuse" {
                    if in_reuse {
                        continue;
                    }
                    out.insert(k.clone(), prune_reuse(x, true));
                } else {
                    out.insert(k.clone(), prune_reuse(x, in_reuse));
                }
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

fn short(v: &Value) -> String {
    let s = v.to_string();
    if s.len() > 160 {
        let mut end = 160;
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}...", &s[..end])
    } else {
        s
    }
}

/// First difference between actual and expected, as a path plus detail.
fn diff(actual: &Value, expected: &Value, path: &str) -> Option<String> {
    match (actual, expected) {
        (Value::String(a), Value::String(e)) if e == "<uid>" => {
            if a.is_empty() {
                Some(format!("{path}: expected a non-empty id, got empty string"))
            } else {
                None
            }
        }
        (Value::Number(a), Value::Number(e)) => {
            let (a, e) = (a.as_f64(), e.as_f64());
            if a == e {
                None
            } else {
                Some(format!("{path}: actual {a:?}, expected {e:?}"))
            }
        }
        (Value::Array(a), Value::Array(e)) => {
            if a.len() != e.len() {
                return Some(format!("{path}: array length actual {}, expected {}", a.len(), e.len()));
            }
            for (i, (x, y)) in a.iter().zip(e).enumerate() {
                if let Some(d) = diff(x, y, &format!("{path}[{i}]")) {
                    return Some(d);
                }
            }
            None
        }
        (Value::Object(a), Value::Object(e)) => {
            let unordered = is_unordered_object(e);
            if !unordered {
                let ak: Vec<&String> = a.keys().collect();
                let ek: Vec<&String> = e.keys().collect();
                if ak != ek {
                    let missing: Vec<&&String> = ek.iter().filter(|k| !a.contains_key(k.as_str())).collect();
                    let extra: Vec<&&String> = ak.iter().filter(|k| !e.contains_key(k.as_str())).collect();
                    if missing.is_empty() && extra.is_empty() {
                        return Some(format!("{path}: key order actual {ak:?}, expected {ek:?}"));
                    }
                    return Some(format!("{path}: keys missing {missing:?}, extra {extra:?}"));
                }
            } else {
                for k in e.keys() {
                    if !a.contains_key(k) {
                        return Some(format!("{path}: missing key {k}"));
                    }
                }
                for k in a.keys() {
                    if !e.contains_key(k) {
                        return Some(format!("{path}: extra key {k}"));
                    }
                }
            }
            for (k, ev) in e {
                if let Some(av) = a.get(k) {
                    if let Some(d) = diff(av, ev, &format!("{path}.{k}")) {
                        return Some(d);
                    }
                }
            }
            None
        }
        (a, e) if a == e => None,
        (a, e) => Some(format!("{path}: actual {}, expected {}", short(a), short(e))),
    }
}

// ---------------------------------------------------------------------------
// harness

#[derive(Default)]
struct Report {
    lines: Vec<String>,
    failures: Vec<String>,
}

impl Report {
    fn file(&mut self, name: &str, total: usize, failed: usize) {
        self.lines.push(format!("{name}: {}/{} passed", total - failed, total));
    }
    fn finish(self, group: &str) {
        let total_failed = self.failures.len();
        eprintln!("== {group} ==");
        for l in &self.lines {
            eprintln!("{l}");
        }
        for f in self.failures.iter().take(40) {
            eprintln!("FAIL {f}");
        }
        assert!(total_failed == 0, "{group}: {total_failed} golden case(s) failed");
    }
}

fn to_value<T: Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap_or(Value::Null)
}

fn from_value<T: DeserializeOwned>(v: &Value, what: &str) -> Result<T, String> {
    serde_json::from_value(v.clone()).map_err(|e| format!("deserialize {what}: {e}"))
}

/// Runs one case body, turning panics and errors into a failure message.
fn run_case(body: impl FnOnce() -> Result<Value, String>) -> Result<Value, String> {
    match catch_unwind(AssertUnwindSafe(body)) {
        Ok(r) => r,
        Err(p) => {
            let msg = p
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_default();
            Err(format!("panic: {msg}"))
        }
    }
}

fn check(
    report: &mut Report,
    file: &str,
    name: &str,
    expected: &Value,
    actual: Result<Value, String>,
) -> bool {
    let actual = match actual {
        Ok(a) => a,
        Err(e) => {
            report.failures.push(format!("{file} / {name}: {e}"));
            return false;
        }
    };
    let (exp, act) = match expected.get("$pruned") {
        Some(_) => {
            let value = expected.get("value").cloned().unwrap_or(Value::Null);
            (norm_expected(&value), prune_reuse(&norm_actual(&actual), false))
        }
        None => (norm_expected(expected), norm_actual(&actual)),
    };
    match diff(&act, &exp, "$") {
        None => true,
        Some(d) => {
            report.failures.push(format!("{file} / {name}: {d}"));
            false
        }
    }
}

fn cases_of(doc: &Value) -> &[Value] {
    doc.get("cases").and_then(Value::as_array).map(|v| v.as_slice()).unwrap_or(&[])
}

fn str_of<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

struct Fixtures<'a> {
    doc: &'a Value,
}

impl Fixtures<'_> {
    fn program(&self, name: &str) -> Result<IEvaluatedProgram, String> {
        let v = self.doc.pointer(&format!("/fixtures/programs/{}", name.replace('~', "~0").replace('/', "~1")));
        from_value(v.ok_or_else(|| format!("no program fixture {name}"))?, "program fixture")
    }
    fn settings(&self, name: &str) -> Result<ISettings, String> {
        let v = self.doc.pointer(&format!("/fixtures/settings/{name}"));
        from_value(v.ok_or_else(|| format!("no settings fixture {name}"))?, "settings fixture")
    }
}

fn day_data_of(p: &IEvaluatedProgram, day: i64) -> Result<IDayData, String> {
    let d = program::get_program_day(p, day).ok_or_else(|| format!("no day {day}"))?;
    Ok(IDayData { week: Some(d.day_data.week), day: d.day_data.day, day_in_week: Some(d.day_data.day_in_week) })
}

// ---------------------------------------------------------------------------
// builtins

fn run_builtins(dir: &str) {
    let mut report = Report::default();
    for path in files_in(&golden_dir().join(dir), "") {
        let doc = load(&path);
        let fname = format!("{dir}/{}", path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
        let cases = cases_of(&doc);
        let mut failed = 0;
        for case in cases {
            let name = str_of(case, "name");
            let fnname = str_of(case, "fn");
            let inputs = &case["inputs"];
            let actual = run_case(|| -> Result<Value, String> { match fnname {
                "PlannerProgram_evaluateText" => {
                    let weeks = planner_program::evaluate_text(str_of(inputs, "text"));
                    Ok(to_value(&weeks))
                }
                "forceEvaluateText" => {
                    let settings: ISettings = from_value(&inputs["settings"], "settings")?;
                    let mut uid = SequentialUid::new();
                    let p = runtime::force_evaluate_text(
                        str_of(inputs, "programText"),
                        str_of(inputs, "name"),
                        &settings,
                        &mut uid,
                    );
                    Ok(to_value(&p))
                }
                other => Err(format!("unknown fn {other}")),
            } });
            if !check(&mut report, &fname, name, &case["output"], actual) {
                failed += 1;
            }
        }
        report.file(&fname, cases.len(), failed);
    }
    report.finish(dir);
}

#[test]
fn golden_builtins() {
    run_builtins("builtins");
}

#[test]
fn golden_builtins_kg() {
    run_builtins("builtins_kg");
}

// ---------------------------------------------------------------------------
// next_history_entry.json

#[test]
fn golden_next_history_entry() {
    let mut report = Report::default();
    let path = golden_dir().join("next_history_entry.json");
    let doc = load(&path);
    let fx = Fixtures { doc: &doc };
    let fname = "next_history_entry.json";
    let cases = cases_of(&doc);
    let mut failed = 0;
    for case in cases {
        let name = str_of(case, "name");
        let inputs = &case["inputs"];
        let actual = run_case(|| match str_of(case, "fn") {
            "Program_nextHistoryEntry" => {
                let p = fx.program(str_of(inputs, "programRef"))?;
                let settings = fx.settings(str_of(inputs, "settingsRef"))?;
                let day = inputs["day"].as_i64().ok_or("day")?;
                let key = str_of(inputs, "exerciseKey");
                let index = inputs["index"].as_i64().ok_or("index")?;
                let stats: IStats = from_value(&inputs["stats"], "stats")?;
                let dd = day_data_of(&p, day)?;
                let pe = program::get_program_exercise_for_key_and_day(&p, day, key).ok_or("no program exercise")?;
                let mut uid = SequentialUid::new();
                let entry = program::next_history_entry(&p, &dd, index, &pe, &stats, &settings, &mut uid)
                    .map_err(|e: program::ProgramError| e.to_string())?;
                Ok(to_value(&entry))
            }
            "Program_nextDay" => {
                let p = fx.program(str_of(inputs, "programRef"))?;
                let day = inputs.get("day").and_then(Value::as_i64);
                Ok(Value::from(program::next_day(&p, day)))
            }
            "getDay" => {
                let p = fx.program(str_of(inputs, "programRef"))?;
                let day = inputs["day"].as_i64().ok_or("day")?;
                Ok(to_value(&runtime::get_day(&p, day)))
            }
            other => Err(format!("unknown fn {other}")),
        });
        if !check(&mut report, fname, name, &case["output"], actual) {
            failed += 1;
        }
    }
    report.file(fname, cases.len(), failed);
    report.finish("next_history_entry");
}

// ---------------------------------------------------------------------------
// finish_day*.json

fn engine_from(v: Option<&Value>) -> Result<Option<EngineBindingsInput>, String> {
    match v {
        Some(x) if !x.is_null() => Ok(Some(from_value(x, "engine")?)),
        _ => Ok(None),
    }
}

fn finish_day_files() -> Vec<PathBuf> {
    files_in(&golden_dir(), "finish_day")
}

#[test]
fn golden_finish_day() {
    let mut report = Report::default();
    for path in finish_day_files() {
        let doc = load(&path);
        let fx = Fixtures { doc: &doc };
        let fname = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let cases = cases_of(&doc);
        let mut failed = 0;
        for case in cases {
            let name = str_of(case, "name");
            let inputs = &case["inputs"];
            let actual = run_case(|| {
                let p = fx.program(str_of(inputs, "programRef"))?;
                let settings = fx.settings(str_of(inputs, "settingsRef"))?;
                let stats: IStats = from_value(&inputs["stats"], "stats")?;
                let day = inputs["day"].as_i64().ok_or("day")?;
                match str_of(case, "fn") {
                    "runAllFinishDayScripts" => {
                        let entries: Vec<IHistoryEntry> = from_value(&inputs["entries"], "entries")?;
                        let opts = inputs.get("opts");
                        let engine_by_key: IndexMap<String, EngineBindingsInput> =
                            match opts.and_then(|o| o.get("engineByKey")) {
                                Some(v) => from_value(v, "engineByKey")?,
                                None => IndexMap::new(),
                            };
                        let prompted: Option<IndexMap<String, IProgramState>> =
                            match opts.and_then(|o| o.get("userPromptedStateVars")) {
                                Some(v) => Some(from_value(v, "userPromptedStateVars")?),
                                None => None,
                            };
                        let engine_for = |e: &IHistoryEntry| -> Option<EngineBindingsInput> {
                            e.program_exercise_id.as_ref().and_then(|id| engine_by_key.get(id).copied())
                        };
                        let mut uid = SequentialUid::new();
                        let result = runtime::run_all_finish_day_scripts(
                            &p,
                            day,
                            &entries,
                            &settings,
                            &stats,
                            RunAllOpts {
                                on_error: None,
                                engine_for: Some(&engine_for),
                                user_prompted_state_vars: prompted.as_ref(),
                            },
                            &mut uid,
                        )
                        .map_err(|e| format!("threw: {}", e.message))?;
                        Ok(to_value(&result))
                    }
                    "runFinishDayScript" => {
                        let key = str_of(inputs, "exerciseKey");
                        let entry: IHistoryEntry = from_value(&inputs["entry"], "entry")?;
                        let pd_data = day_data_of(&p, day)?;
                        let pe = program::get_program_exercise_for_key_and_day(&p, day, key)
                            .ok_or("no program exercise")?;
                        let opts = inputs.get("opts").filter(|o| !o.is_null());
                        let engine = engine_from(opts.and_then(|o| o.get("engine")))?;
                        let prompted: Option<IProgramState> =
                            match opts.and_then(|o| o.get("userPromptedStateVars")) {
                                Some(v) => Some(from_value(v, "userPromptedStateVars")?),
                                None => None,
                            };
                        let result = runtime::run_finish_day_script(
                            &pe,
                            &p,
                            &pd_data,
                            &entry,
                            &settings,
                            &stats,
                            &FinishDayOpts { user_prompted_state_vars: prompted.as_ref(), engine: engine.as_ref() },
                        );
                        Ok(to_value(&result))
                    }
                    "runUpdateScriptForEntry" => {
                        let key = str_of(inputs, "exerciseKey");
                        let entry: IHistoryEntry = from_value(&inputs["entry"], "entry")?;
                        let pd_data = day_data_of(&p, day)?;
                        let pe = program::get_program_exercise_for_key_and_day(&p, day, key)
                            .ok_or("no program exercise")?;
                        let other: IndexMap<String, IProgramState> =
                            from_value(&inputs["otherStates"], "otherStates")?;
                        let set_index = inputs["setIndex"].as_i64().ok_or("setIndex")?;
                        let mut uid = SequentialUid::new();
                        let result = runtime::run_update_script_for_entry(
                            &entry, &pd_data, &pe, &other, set_index, &settings, &stats, &mut uid,
                        )
                        .map_err(|e| format!("threw: {e}"))?;
                        Ok(to_value(&result))
                    }
                    other => Err(format!("unknown fn {other}")),
                }
            });
            if !check(&mut report, &fname, name, &case["output"], actual) {
                failed += 1;
            }
        }
        report.file(&fname, cases.len(), failed);
    }
    report.finish("finish_day");
}

// ---------------------------------------------------------------------------
// bindings.json

fn opt_f64(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(Value::as_f64)
}

#[test]
fn golden_bindings() {
    let mut report = Report::default();
    let doc = load(&golden_dir().join("bindings.json"));
    let fname = "bindings.json";
    let cases = cases_of(&doc);
    let mut failed = 0;
    for case in cases {
        let name = str_of(case, "name");
        let inputs = &case["inputs"];
        let actual = run_case(|| match str_of(case, "fn") {
            "createEngineBindings" => {
                let input = engine_from(inputs.get("input"))?;
                Ok(to_value(&runtime::create_engine_bindings(input.as_ref())))
            }
            "applyEngineBindings" => {
                let settings: ISettings = from_value(&inputs["settings"], "settings")?;
                let dd: IDayData = from_value(&inputs["dayData"], "dayData")?;
                let exercise: Option<IExerciseType> = match inputs.get("exercise") {
                    Some(v) if !v.is_null() => Some(from_value(v, "exercise")?),
                    _ => None,
                };
                let mut b = progress::create_empty_script_bindings(&dd, &settings, exercise.as_ref());
                let input = engine_from(inputs.get("input"))?;
                runtime::apply_engine_bindings(&mut b, input.as_ref());
                Ok(to_value(&b))
            }
            "createScriptBindings" => {
                let settings: ISettings = from_value(&inputs["settings"], "settings")?;
                let dd: IDayData = from_value(&inputs["dayData"], "dayData")?;
                let entry: IHistoryEntry = from_value(&inputs["entry"], "entry")?;
                let bodyweight = match inputs.get("bodyweight") {
                    Some(v) if !v.is_null() => Some(from_value(v, "bodyweight")?),
                    _ => None,
                };
                let engine = engine_from(inputs.get("engine"))?;
                let b: IScriptBindings = runtime::create_script_bindings(
                    &dd,
                    &entry,
                    &settings,
                    opt_f64(inputs, "programNumberOfSets").unwrap_or(0.0),
                    bodyweight,
                    opt_f64(inputs, "setIndex"),
                    opt_f64(inputs, "setVariationIndex"),
                    opt_f64(inputs, "descriptionIndex"),
                    opt_f64(inputs, "exerciseVariationIndex"),
                    engine.as_ref(),
                );
                Ok(to_value(&b))
            }
            "createScriptFunctions" => {
                let settings: ISettings = from_value(&inputs["settings"], "settings")?;
                let _fns = runtime::create_script_functions(&settings);
                Ok(to_value(&runtime::script_function_names()))
            }
            "liftoscriptFnSignatures" => Ok(fn_signatures()),
            "qalaSettingsToLiftoscript" => {
                let core: CoreSettings = from_value(&inputs["coreSettings"], "coreSettings")?;
                Ok(to_value(&runtime::qala_settings_to_liftoscript(&core)))
            }
            "qalaExerciseIdToType" => Ok(to_value(&runtime::qala_exercise_id_to_type(str_of(inputs, "exerciseId")))),
            "qalaLiftEntryToHistoryEntry" => {
                let le: LiftEntry = from_value(&inputs["liftEntry"], "liftEntry")?;
                let planned: Option<Vec<PlannedSet>> = match inputs.get("planned") {
                    Some(v) if !v.is_null() => Some(from_value(v, "planned")?),
                    _ => None,
                };
                let mut uid = SequentialUid::new();
                let e = runtime::qala_lift_entry_to_history_entry(
                    &le,
                    inputs["index"].as_i64().ok_or("index")?,
                    planned.as_deref(),
                    inputs.get("programExerciseKey").and_then(Value::as_str),
                    &mut uid,
                );
                Ok(to_value(&e))
            }
            "qalaLiftSessionToHistoryRecord" => {
                let session: LiftSession = from_value(&inputs["session"], "session")?;
                let prog = match inputs.get("programRef").and_then(Value::as_str) {
                    Some(id) => Some(program_for_bindings(&doc, id)?),
                    None => None,
                };
                let mut uid = SequentialUid::new();
                let r = runtime::qala_lift_session_to_history_record(
                    &session,
                    inputs["day"].as_i64().ok_or("day")?,
                    str_of(inputs, "programName"),
                    prog.as_ref(),
                    &mut uid,
                );
                Ok(to_value(&r))
            }
            "evaluateQalaProgram" => {
                let cp: CoreProgram = from_value(&inputs["coreProgram"], "coreProgram")?;
                let cs: CoreSettings = from_value(&inputs["coreSettings"], "coreSettings")?;
                let mut uid = SequentialUid::new();
                Ok(to_value(&runtime::evaluate_qala_program(&cp, &cs, &mut uid)))
            }
            other => Err(format!("unknown fn {other}")),
        });
        if !check(&mut report, fname, name, &case["output"], actual) {
            failed += 1;
        }
    }
    report.file(fname, cases.len(), failed);
    report.finish("bindings");
}

/// `programRef` in bindings.json names a builtin program that the TS runner
/// evaluated with the default lb settings under the program's own text.
fn program_for_bindings(doc: &Value, id: &str) -> Result<IEvaluatedProgram, String> {
    if let Some(v) = doc.pointer(&format!("/fixtures/programs/{id}")) {
        return from_value(v, "program fixture");
    }
    let builtin = load(&golden_dir().join("builtins").join(format!("{id}.json")));
    let case = cases_of(&builtin)
        .iter()
        .find(|c| str_of(c, "fn") == "forceEvaluateText")
        .ok_or("no evaluated case")?;
    let settings: ISettings = from_value(&case["inputs"]["settings"], "settings")?;
    let mut uid = SequentialUid::new();
    Ok(runtime::force_evaluate_text(
        str_of(&case["inputs"], "programText"),
        str_of(&case["inputs"], "name"),
        &settings,
        &mut uid,
    ))
}

/// `liftoscriptFnSignatures`: argument names and arity per function, built
/// from the Rust signature table.
fn fn_signatures() -> Value {
    use qala_lspp::script_fns::{arg_signature, arity, IScriptFnName};
    let mut out = Map::new();
    for name in IScriptFnName::ALL {
        let a = arity(name);
        let mut entry = Map::new();
        match a.max {
            None => {
                entry.insert("args".to_string(), Value::Null);
                entry.insert("variadic".to_string(), Value::Bool(true));
            }
            Some(max) => {
                let args: Vec<Value> = (0..max)
                    .filter_map(|i| arg_signature(name, i))
                    .map(|s| {
                        let mut m = Map::new();
                        m.insert("name".to_string(), Value::String(s.name.to_string()));
                        m.insert("optional".to_string(), Value::Bool(s.optional));
                        Value::Object(m)
                    })
                    .collect();
                entry.insert("args".to_string(), Value::Array(args));
                entry.insert("variadic".to_string(), Value::Bool(false));
            }
        }
        out.insert(name.name().to_string(), Value::Object(entry));
    }
    Value::Object(out)
}
