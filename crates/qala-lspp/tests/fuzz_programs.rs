//! Program-level differential fuzz: replays every case in
//! `testdata/golden/liftoscript/fuzz/programs_fuzz_*.json` (written by
//! `deno task fuzz:liftoscript`) through the Rust port and compares against the
//! TS oracle. The comparison helpers below are copied from `golden.rs` and
//! follow the same normalisation rules (see the golden README and the header
//! of that file): ordered keys except set/history-entry objects, `"<uid>"`
//! accepts any non-empty string, non-finite number strings read as null,
//! `liftoscriptNode` dropped.
//!
//! `QALA_FUZZ_MAX_FAIL` sets how many failures are printed (default 40).
//! Run through scripts/cargo-test-safe.sh with `-- --nocapture` to see them.

use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};

use indexmap::IndexMap;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{Map, Value};

use qala_lspp::program;
use qala_lspp::runtime::{self, EngineBindingsInput, RunAllOpts};
use qala_lspp::types::{
    IDayData, IEvaluatedProgram, IHistoryEntry, IPlannerProgramWeek, IProgramState, ISettings, IStats,
};
use qala_lspp::planner_program;
use qala_lspp::util::generator::SequentialUid;

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
                let n = a.len().min(e.len());
                let extra: Vec<String> = if a.len() > e.len() {
                    a[n..].iter().map(|x| format!("extra actual {}", short(x))).collect()
                } else {
                    e[n..].iter().map(|x| format!("missing {}", short(x))).collect()
                };
                return Some(format!(
                    "{path}: array length actual {}, expected {} ({})",
                    a.len(),
                    e.len(),
                    extra.join("; ")
                ));
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
        for f in self.failures.iter().take(max_failures_shown()) {
            eprintln!("FAIL {f}");
        }
        assert!(total_failed == 0, "{group}: {total_failed} fuzz case(s) failed");
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
// fuzz replay

fn max_failures_shown() -> usize {
    std::env::var("QALA_FUZZ_MAX_FAIL").ok().and_then(|v| v.parse().ok()).unwrap_or(40)
}

fn fuzz_files() -> Vec<PathBuf> {
    let files = files_in(&golden_dir().join("fuzz"), "programs_fuzz");
    assert!(!files.is_empty(), "no fuzz files; run `deno task fuzz:liftoscript`");
    files
}

/// Replays every fuzz case whose `fn` is in `fns`, one file at a time.
fn replay(group: &str, fns: &[&str]) {
    let mut report = Report::default();
    for path in fuzz_files() {
        let doc = load(&path);
        let fx = Fixtures { doc: &doc };
        let fname = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let mut total = 0;
        let mut failed = 0;
        for case in cases_of(&doc) {
            let f = str_of(case, "fn");
            if !fns.contains(&f) {
                continue;
            }
            total += 1;
            let name = str_of(case, "name");
            let inputs = &case["inputs"];
            let actual = run_case(|| run_fuzz_case(&fx, f, inputs));
            if !check(&mut report, &fname, name, &case["output"], actual) {
                failed += 1;
            }
        }
        report.file(&fname, total, failed);
    }
    report.finish(group);
}

fn run_fuzz_case(fx: &Fixtures, f: &str, inputs: &Value) -> Result<Value, String> {
    match f {
        "PlannerProgram_evaluateText" => {
            let weeks = planner_program::evaluate_text(str_of(inputs, "text"));
            Ok(to_value(&weeks))
        }
        "PlannerProgram_generateFullText" => {
            let weeks: Vec<IPlannerProgramWeek> = from_value(&inputs["weeks"], "weeks")?;
            Ok(Value::String(planner_program::generate_full_text(&weeks)))
        }
        "forceEvaluateText" => {
            let settings = fx.settings(str_of(inputs, "settingsRef"))?;
            let mut uid = SequentialUid::new();
            let p = runtime::force_evaluate_text(
                str_of(inputs, "programText"),
                str_of(inputs, "name"),
                &settings,
                &mut uid,
            );
            Ok(to_value(&p))
        }
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
        "runAllFinishDayScripts" => {
            let p = fx.program(str_of(inputs, "programRef"))?;
            let settings = fx.settings(str_of(inputs, "settingsRef"))?;
            let stats: IStats = from_value(&inputs["stats"], "stats")?;
            let day = inputs["day"].as_i64().ok_or("day")?;
            let entries: Vec<IHistoryEntry> = from_value(&inputs["entries"], "entries")?;
            let engine_for = |_: &IHistoryEntry| -> Option<EngineBindingsInput> { None };
            let mut uid = SequentialUid::new();
            let result = runtime::run_all_finish_day_scripts(
                &p,
                day,
                &entries,
                &settings,
                &stats,
                RunAllOpts { on_error: None, engine_for: Some(&engine_for), user_prompted_state_vars: None },
                &mut uid,
            )
            .map_err(|e| format!("threw: {}", e.message))?;
            Ok(to_value(&result))
        }
        "runUpdateScriptForEntry" => {
            let p = fx.program(str_of(inputs, "programRef"))?;
            let settings = fx.settings(str_of(inputs, "settingsRef"))?;
            let stats: IStats = from_value(&inputs["stats"], "stats")?;
            let day = inputs["day"].as_i64().ok_or("day")?;
            let key = str_of(inputs, "exerciseKey");
            let entry: IHistoryEntry = from_value(&inputs["entry"], "entry")?;
            let pd_data = day_data_of(&p, day)?;
            let pe = program::get_program_exercise_for_key_and_day(&p, day, key).ok_or("no program exercise")?;
            let other: IndexMap<String, IProgramState> = from_value(&inputs["otherStates"], "otherStates")?;
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
}

#[test]
fn fuzz_planner_text() {
    replay("fuzz planner text", &["PlannerProgram_evaluateText", "PlannerProgram_generateFullText"]);
}

#[test]
fn fuzz_evaluated() {
    replay("fuzz evaluated", &["forceEvaluateText"]);
}

#[test]
fn fuzz_finish_day() {
    replay(
        "fuzz finish day",
        &["Program_nextHistoryEntry", "runAllFinishDayScripts", "runUpdateScriptForEntry"],
    );
}
