//! Differential fuzz of the Rust plate math and engine against the TS originals (the oracle).
//!
//! Replays the JSON Lines files `deno task fuzz:plates` writes to `testdata/golden/plates/fuzz/`
//! and `deno task fuzz:engine` writes to `testdata/golden/engine/fuzz/` (both gitignored). Each
//! line is one case with the TS answer; the line formats are documented in
//! `scripts/gen_plates_fuzz.ts` and `scripts/gen_engine_fuzz.ts`. Files are streamed line by
//! line, never loaded whole, and a few threads work through the files at once.
//!
//! When a fuzz directory is absent the test prints how to create it and passes, so a fresh
//! checkout stays green (the LS++ fuzz in `qala-lspp` fails instead). A directory whose
//! generator did not finish (no `complete` manifest, or a file missing) fails loudly.
//!
//! Comparison: plate math is exact for numbers, strings and booleans (every value is a multiple of
//! 0.25 or rounded to two decimals, so the same operations give the same doubles). The engine
//! compares floats with the README rule of `testdata/golden/engine/README.md`
//! (`a == e || |a - e| <= 1e-9 * max(|a|, |e|) + 1e-12`) and counts how many matches were not
//! bit-exact. Non-finite numbers travel as the strings "NaN", "Infinity" and "-Infinity" (null
//! from a serde-written result matches them too). Signed zeros compare equal, as `js_round`
//! documents.
//!
//! Environment:
//! - `QALA_FUZZ_MAX_FAIL`: how many failing cases to print (default 40). Run through
//!   `scripts/cargo-test-safe.sh -p qala-core --test fuzz_core -- --nocapture` to see them.
//! - `QALA_FUZZ_THREADS`: worker threads per fuzz test (default: half the cores, 2 to 12).

use qala_core::engine::decay::{apply_input, decay_record, decay_value, muscle_tau};
use qala_core::engine::e1rm::{best_observation, observe_set, rts_lookup, E1rmObservation};
use qala_core::engine::readiness::{
    predict_readiness, predict_readiness_core, prs_z_score, Readiness,
};
use qala_core::engine::running::critical_speed;
use qala_core::engine::state::{
    initial_state, BestEffort, Checkin, DatedValue, EngineState, SetLog,
};
use qala_core::plates::{
    choose_next_plates, default_barbell_step, describe_change, is_loadable, nearest_loadable,
    plan_plates, plates_shorthand, round_to_step, round_weight, Pairs, PlateEntry, PlateLoad,
};
use qala_core::time::{add_days_key, days_between, try_add_days_key};
use serde_json::Value;
use std::cell::Cell;
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, Once};

const PLATES_DIR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/golden/plates/fuzz/"
);

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/// A JSON number, or one of the strings the fuzz files use for non-finite values and `-0`.
fn num(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().expect("number in range"),
        Value::String(s) => match s.as_str() {
            "NaN" => f64::NAN,
            "Infinity" => f64::INFINITY,
            "-Infinity" => f64::NEG_INFINITY,
            "-0" => -0.0,
            other => panic!("not a number: {other:?}"),
        },
        other => panic!("not a number: {other}"),
    }
}

fn nums(v: &Value) -> Vec<f64> {
    v.as_array().expect("number list").iter().map(num).collect()
}

fn fmt_f(x: f64) -> String {
    if x.is_nan() {
        "NaN".to_string()
    } else if x == f64::INFINITY {
        "Infinity".to_string()
    } else if x == f64::NEG_INFINITY {
        "-Infinity".to_string()
    } else {
        format!("{x:?}")
    }
}

#[derive(Clone, Copy)]
enum Tol {
    /// Equal doubles (signed zeros equal, NaN equals NaN).
    Exact,
    /// The engine README rule: `a == e || |a - e| <= t * max(|a|, |e|) + 1e-12`.
    Rel(f64),
}

/// 0 for no match, 1 for an exact match, 2 for a match inside the tolerance only.
fn match_kind(a: f64, e: f64, tol: Tol) -> u8 {
    if a == e || (a.is_nan() && e.is_nan()) {
        return 1;
    }
    match tol {
        Tol::Exact => 0,
        Tol::Rel(t) => u8::from((a - e).abs() <= t * a.abs().max(e.abs()) + 1e-12) * 2,
    }
}

// ---------------------------------------------------------------------------
// Failure reporting
// ---------------------------------------------------------------------------

fn max_failures() -> usize {
    std::env::var("QALA_FUZZ_MAX_FAIL")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(40)
}

fn thread_count(jobs: usize) -> usize {
    let cores = std::thread::available_parallelism().map_or(4, |n| n.get());
    let wanted = std::env::var("QALA_FUZZ_THREADS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or((cores / 2).clamp(2, 12));
    wanted.clamp(1, jobs.max(1))
}

#[derive(Default)]
struct Report {
    cases: AtomicUsize,
    failed: AtomicUsize,
    /// Matches inside the tolerance that were not bit-exact (engine files only).
    inexact: AtomicUsize,
    shown: Mutex<Vec<String>>,
    /// The first few cases that matched only inside the tolerance.
    inexact_examples: Mutex<Vec<String>>,
    per_op: Mutex<std::collections::BTreeMap<String, usize>>,
}

impl Report {
    fn fail(&self, file: &str, line_no: usize, line: &str, errs: &[String]) {
        self.failed.fetch_add(1, Ordering::Relaxed);
        let mut shown = self.shown.lock().expect("report lock");
        if shown.len() < max_failures() {
            let line = if line.len() > 600 { &line[..600] } else { line };
            shown.push(format!(
                "{file}:{line_no}: {}\n    case: {line}",
                errs.join("; ")
            ));
        }
    }
}

thread_local! {
    static QUIET: Cell<bool> = const { Cell::new(false) };
}

/// Silences the default panic message while a fuzz case runs (a systematic panic would print
/// once per case). Panics anywhere else still print.
fn install_quiet_hook() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if !QUIET.with(Cell::get) {
                previous(info);
            }
        }));
    });
}

/// Runs `f`, turning a panic into an error string.
fn guarded<T>(f: impl FnOnce() -> T) -> Result<T, String> {
    QUIET.with(|q| q.set(true));
    let r = catch_unwind(AssertUnwindSafe(f));
    QUIET.with(|q| q.set(false));
    r.map_err(|p| {
        p.downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| p.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panic".to_string())
    })
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/// Reads `manifest.json` of a fuzz directory. `None` when the directory has not been generated.
fn read_manifest(dir: &str, task: &str) -> Option<(Value, Vec<PathBuf>)> {
    let path = Path::new(dir).join("manifest.json");
    if !Path::new(dir).is_dir() || !path.exists() {
        eprintln!(
            "fuzz_core: no fuzz data in {dir}\n  run `deno task {task}` first (the files are gitignored); skipping"
        );
        return None;
    }
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let manifest: Value =
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    assert_eq!(
        manifest["complete"],
        Value::Bool(true),
        "{}: the generator did not finish; rerun `deno task {task}`",
        path.display()
    );
    let files: Vec<PathBuf> = manifest["files"]
        .as_array()
        .expect("manifest files")
        .iter()
        .map(|f| {
            let p = Path::new(dir).join(f.as_str().expect("file name"));
            assert!(
                p.exists(),
                "{} is missing; rerun `deno task {task}`",
                p.display()
            );
            p
        })
        .collect();
    assert!(!files.is_empty(), "{}: no files", path.display());
    Some((manifest, files))
}

/// Streams every file of `files` through `case` on a few threads. `case` gets the parsed line and
/// a scratch vector it pushes error strings to; a case with errors is a failure. `case` also
/// returns the operation name for the per-op counts.
fn replay<'a>(
    files: &'a [PathBuf],
    report: &'a Report,
    case: impl Fn(&Value, &mut Vec<String>) -> (&'static str, u32) + Sync,
) {
    install_quiet_hook();
    let next = AtomicUsize::new(0);
    std::thread::scope(|s| {
        for _ in 0..thread_count(files.len()) {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(path) = files.get(i) else { break };
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                let reader = BufReader::new(
                    File::open(path).unwrap_or_else(|e| panic!("{}: {e}", path.display())),
                );
                let mut ops: std::collections::BTreeMap<&'static str, usize> = Default::default();
                let mut errs: Vec<String> = Vec::new();
                for (n, line) in reader.lines().enumerate() {
                    let line = line.unwrap_or_else(|e| panic!("{name}:{}: {e}", n + 1));
                    if line.is_empty() {
                        continue;
                    }
                    let v: Value = serde_json::from_str(&line)
                        .unwrap_or_else(|e| panic!("{name}:{}: bad JSON: {e}", n + 1));
                    errs.clear();
                    let (op, inexact) = case(&v, &mut errs);
                    *ops.entry(op).or_default() += 1;
                    report.cases.fetch_add(1, Ordering::Relaxed);
                    if inexact > 0 {
                        report
                            .inexact
                            .fetch_add(inexact as usize, Ordering::Relaxed);
                        let mut ex = report.inexact_examples.lock().expect("report lock");
                        if ex.len() < 5 {
                            ex.push(format!(
                                "{name}:{}: {}",
                                n + 1,
                                &line[..line.len().min(300)]
                            ));
                        }
                    }
                    if !errs.is_empty() {
                        report.fail(&name, n + 1, &line, &errs);
                    }
                }
                let mut per_op = report.per_op.lock().expect("report lock");
                for (op, c) in ops {
                    *per_op.entry(op.to_string()).or_default() += c;
                }
            });
        }
    });
}

fn finish(title: &str, report: &Report, expected_cases: usize) {
    let cases = report.cases.load(Ordering::Relaxed);
    let failed = report.failed.load(Ordering::Relaxed);
    eprintln!(
        "{title}: {cases} cases, {failed} mismatches, {} matches inside the tolerance but not bit-exact",
        report.inexact.load(Ordering::Relaxed)
    );
    for (op, c) in report.per_op.lock().expect("report lock").iter() {
        eprintln!("  {op:<18} {c}");
    }
    for ex in report.inexact_examples.lock().expect("report lock").iter() {
        eprintln!("  not bit-exact: {ex}");
    }
    assert_eq!(
        cases, expected_cases,
        "{title}: replayed {cases} cases but the manifest lists {expected_cases}"
    );
    let shown = report.shown.lock().expect("report lock");
    assert!(
        failed == 0,
        "{title}: {failed} of {cases} cases differ from the TS oracle; first {}:\n{}",
        shown.len(),
        shown.join("\n")
    );
}

// ---------------------------------------------------------------------------
// Plates
// ---------------------------------------------------------------------------

fn load_inventories(dir: &str) -> Vec<Vec<PlateEntry>> {
    let path = format!("{dir}inventories.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let doc: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path}: {e}"));
    doc["inventories"]
        .as_array()
        .expect("inventories")
        .iter()
        .map(|inv| {
            inv.as_array()
                .expect("inventory rows")
                .iter()
                .map(|r| PlateEntry {
                    weight: num(&r["weight"]),
                    pairs: match &r["pairs"] {
                        Value::String(s) if s == "enough" => Pairs::Enough,
                        other => Pairs::Count(num(other)),
                    },
                    color: r["color"].as_str().unwrap_or_default().to_string(),
                })
                .collect()
        })
        .collect()
}

fn cmp_num(errs: &mut Vec<String>, path: &str, expected: &Value, actual: f64, tol: Tol) -> u32 {
    let e = num(expected);
    match match_kind(actual, e, tol) {
        0 => {
            errs.push(format!(
                "{path}: Rust {} but TS {}",
                fmt_f(actual),
                fmt_f(e)
            ));
            0
        }
        2 => 1,
        _ => 0,
    }
}

fn cmp_list(errs: &mut Vec<String>, path: &str, expected: &Value, actual: &[f64]) {
    let e = nums(expected);
    if e.len() != actual.len() {
        errs.push(format!("{path}: Rust {actual:?} but TS {e:?}"));
        return;
    }
    for (i, (x, y)) in e.iter().zip(actual).enumerate() {
        if match_kind(*y, *x, Tol::Exact) == 0 {
            errs.push(format!(
                "{path}[{i}]: Rust {} but TS {}",
                fmt_f(*y),
                fmt_f(*x)
            ));
        }
    }
}

fn cmp_str(errs: &mut Vec<String>, path: &str, expected: &Value, actual: &str) {
    let e = expected.as_str().expect("expected string");
    if e != actual {
        errs.push(format!("{path}: Rust {actual:?} but TS {e:?}"));
    }
}

/// `expected` is null or `[perSide, perSideTotal, total]`; `bar` and `collar` are the case's.
fn cmp_load(
    errs: &mut Vec<String>,
    path: &str,
    expected: &Value,
    actual: Option<&PlateLoad>,
    bar: f64,
    collar: f64,
) {
    match (expected, actual) {
        (Value::Null, None) => {}
        (Value::Null, Some(a)) => {
            errs.push(format!("{path}: Rust has a load {a:?} but TS has none"))
        }
        (_, None) => errs.push(format!("{path}: Rust has no load but TS has {expected}")),
        (e, Some(a)) => {
            cmp_list(errs, &format!("{path}.perSide"), &e[0], &a.per_side);
            cmp_num(
                errs,
                &format!("{path}.perSideTotal"),
                &e[1],
                a.per_side_total,
                Tol::Exact,
            );
            cmp_num(errs, &format!("{path}.total"), &e[2], a.total, Tol::Exact);
            for (name, got, want) in [
                ("barWeight", a.bar_weight, bar),
                ("collarWeight", a.collar_weight, collar),
            ] {
                if match_kind(got, want, Tol::Exact) == 0 {
                    errs.push(format!(
                        "{path}.{name}: Rust {} but the input was {}",
                        fmt_f(got),
                        fmt_f(want)
                    ));
                }
            }
        }
    }
}

fn plates_case(invs: &[Vec<PlateEntry>], v: &Value, errs: &mut Vec<String>) -> (&'static str, u32) {
    let kind = v[0].as_str().expect("case kind");
    match kind {
        "p" => {
            let plates = &invs[v[1].as_u64().expect("inventory index") as usize];
            let (total, bar, collar) = (num(&v[2]), num(&v[3]), num(&v[4]));
            let exp = &v[5];
            let run = guarded(|| {
                let plan = plan_plates(total, bar, plates, collar);
                let nearest = nearest_loadable(&plan);
                let rw = round_weight(total, bar, plates, collar);
                (plan, nearest, rw)
            });
            let (plan, nearest, rw) = match run {
                Ok(r) => r,
                Err(msg) => {
                    errs.push(format!("panicked: {msg}"));
                    return ("plan", 0);
                }
            };
            for (name, got, want) in [
                ("requestedTotal", plan.requested_total, total),
                ("barWeight", plan.bar_weight, bar),
                ("collarWeight", plan.collar_weight, collar),
            ] {
                if match_kind(got, want, Tol::Exact) == 0 {
                    errs.push(format!(
                        "plan.{name}: Rust {} but the input was {}",
                        fmt_f(got),
                        fmt_f(want)
                    ));
                }
            }
            cmp_num(
                errs,
                "plan.perSideTarget",
                &exp[0],
                plan.per_side_target,
                Tol::Exact,
            );
            cmp_load(
                errs,
                "plan.exact",
                &exp[1],
                plan.exact.as_ref(),
                bar,
                collar,
            );
            cmp_load(
                errs,
                "plan.below",
                &exp[2],
                plan.below.as_ref(),
                bar,
                collar,
            );
            cmp_load(
                errs,
                "plan.above",
                &exp[3],
                plan.above.as_ref(),
                bar,
                collar,
            );
            let slot = match exp[4].as_str() {
                Some("e") => &exp[1],
                Some("b") => &exp[2],
                Some("a") => &exp[3],
                _ => &Value::Null,
            };
            cmp_load(errs, "nearest", slot, nearest.as_ref(), bar, collar);
            cmp_num(errs, "round_weight", &exp[5], rw, Tol::Exact);
            ("plan", 0)
        }
        "c" => {
            let plates = &invs[v[1].as_u64().expect("inventory index") as usize];
            let (cur, next, bar, collar) = (nums(&v[2]), num(&v[3]), num(&v[4]), num(&v[5]));
            match guarded(|| choose_next_plates(&cur, next, bar, plates, collar)) {
                Err(msg) => errs.push(format!("panicked: {msg}")),
                Ok(choice) => match (&v[6], choice) {
                    (Value::Null, None) => {}
                    (Value::Null, Some(c)) => errs.push(format!(
                        "Rust chose {:?} but TS chose none",
                        c.load.per_side
                    )),
                    (e, None) => errs.push(format!("Rust chose none but TS chose {e}")),
                    (e, Some(c)) => {
                        cmp_list(errs, "choice.perSide", &e[0], &c.load.per_side);
                        cmp_num(
                            errs,
                            "choice.perSideTotal",
                            &e[1],
                            c.load.per_side_total,
                            Tol::Exact,
                        );
                        cmp_num(errs, "choice.total", &e[2], c.load.total, Tol::Exact);
                        cmp_str(errs, "choice.instruction", &e[3], &c.instruction);
                        if e[4].as_u64() != Some(c.kept_inner as u64) {
                            errs.push(format!(
                                "choice.keptInner: Rust {} but TS {}",
                                c.kept_inner, e[4]
                            ));
                        }
                        if e[5].as_u64() != Some(c.plates_moved as u64) {
                            errs.push(format!(
                                "choice.platesMoved: Rust {} but TS {}",
                                c.plates_moved, e[5]
                            ));
                        }
                    }
                },
            }
            ("choose_next", 0)
        }
        "d" => {
            let (cur, next) = (nums(&v[1]), nums(&v[2]));
            match guarded(|| describe_change(&cur, &next)) {
                Ok(text) => cmp_str(errs, "describeChange", &v[3], &text),
                Err(msg) => errs.push(format!("panicked: {msg}")),
            }
            ("describe_change", 0)
        }
        "s" => {
            let side = nums(&v[1]);
            match guarded(|| plates_shorthand(&side)) {
                Ok(text) => cmp_str(errs, "platesShorthand", &v[2], &text),
                Err(msg) => errs.push(format!("panicked: {msg}")),
            }
            ("shorthand", 0)
        }
        "b" => {
            let plates = &invs[v[1].as_u64().expect("inventory index") as usize];
            let fallback = if v[2].is_null() {
                None
            } else {
                Some(num(&v[2]))
            };
            match guarded(|| default_barbell_step(plates, fallback)) {
                Ok(step) => {
                    cmp_num(errs, "barbellStepDefault", &v[3], step, Tol::Exact);
                }
                Err(msg) => errs.push(format!("panicked: {msg}")),
            }
            ("barbell_step", 0)
        }
        "r" => {
            let (value, step) = (num(&v[1]), num(&v[2]));
            match (guarded(|| round_to_step(value, step)), v[3].as_str()) {
                (Err(_), Some("throw")) => {}
                (Ok(got), Some("throw")) => errs.push(format!(
                    "Rust returned {} but TS threw RangeError",
                    fmt_f(got)
                )),
                (Err(msg), _) => errs.push(format!("panicked: {msg} but TS returned {}", v[3])),
                (Ok(got), _) => {
                    cmp_num(errs, "roundToStep", &v[3], got, Tol::Exact);
                }
            }
            ("round_to_step", 0)
        }
        "l" => {
            let plates = &invs[v[1].as_u64().expect("inventory index") as usize];
            let (total, bar, collar) = (num(&v[2]), num(&v[3]), num(&v[4]));
            match guarded(|| is_loadable(total, bar, plates, collar)) {
                Ok(got) => {
                    if v[5].as_bool() != Some(got) {
                        errs.push(format!("isLoadable: Rust {got} but TS {}", v[5]));
                    }
                }
                Err(msg) => errs.push(format!("panicked: {msg}")),
            }
            ("is_loadable", 0)
        }
        other => panic!("unknown plates fuzz case kind {other:?}"),
    }
}

#[test]
fn fuzz_plates() {
    let Some((manifest, files)) = read_manifest(PLATES_DIR, "fuzz:plates") else {
        return;
    };
    let invs = load_inventories(PLATES_DIR);
    let expected = manifest["cases"].as_u64().expect("manifest cases") as usize;
    if expected < 1_000_000 {
        eprintln!("fuzz_plates: partial corpus, {expected} cases (the full run is 1,000,000)");
    }
    let report = Report::default();
    replay(&files, &report, |v, errs| plates_case(&invs, v, errs));
    finish("fuzz_plates", &report, expected);
}

// ---------------------------------------------------------------------------
// Engine: e1RM, dates, decay, readiness
// ---------------------------------------------------------------------------

const ENGINE_DIR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/golden/engine/fuzz/"
);

/// Engine floats compare with the engine README rule.
const ENGINE_TOL: Tol = Tol::Rel(1e-9);

fn opt_num(obj: &Value, key: &str) -> Option<f64> {
    match obj.get(key) {
        None | Some(Value::Null) => None,
        Some(v) => Some(num(v)),
    }
}

fn flag(obj: &Value, key: &str) -> bool {
    obj.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn set_log(v: &Value) -> SetLog {
    SetLog {
        w: num(&v["w"]),
        r: num(&v["r"]),
        rpe: opt_num(v, "rpe"),
        target_rpe: opt_num(v, "targetRpe"),
        completed: flag(v, "completed"),
        warmup: flag(v, "warmup"),
        tested1rm: flag(v, "tested1rm"),
        ..SetLog::default()
    }
}

fn cmp_obs(errs: &mut Vec<String>, expected: &Value, actual: Option<E1rmObservation>) -> u32 {
    match (expected, actual) {
        (Value::Null, None) => 0,
        (Value::Null, Some(o)) => {
            errs.push(format!(
                "Rust observed {} (tested {}) but TS has none",
                fmt_f(o.e1rm),
                o.tested
            ));
            0
        }
        (e, None) => {
            errs.push(format!("Rust has no observation but TS has {e}"));
            0
        }
        (e, Some(o)) => {
            if e[1].as_bool() != Some(o.tested) {
                errs.push(format!("tested: Rust {} but TS {}", o.tested, e[1]));
            }
            cmp_num(errs, "e1rm", &e[0], o.e1rm, ENGINE_TOL)
        }
    }
}

fn cmp_bool(errs: &mut Vec<String>, path: &str, expected: &Value, actual: bool) {
    if expected.as_bool() != Some(actual) {
        errs.push(format!("{path}: Rust {actual} but TS {expected}"));
    }
}

fn cmp_strings(errs: &mut Vec<String>, path: &str, expected: &Value, actual: &[String]) {
    let e: Vec<&str> = expected
        .as_array()
        .expect("string list")
        .iter()
        .map(|s| s.as_str().expect("string"))
        .collect();
    if e.iter().copied().ne(actual.iter().map(String::as_str)) {
        errs.push(format!("{path}: Rust {actual:?} but TS {e:?}"));
    }
}

fn dated(v: &Value) -> Vec<DatedValue> {
    v.as_array()
        .expect("history")
        .iter()
        .map(|h| DatedValue {
            date: h[0].as_str().expect("date").to_string(),
            value: num(&h[1]),
        })
        .collect()
}

fn num_map(v: &Value) -> BTreeMap<String, f64> {
    v.as_object()
        .expect("map")
        .iter()
        .map(|(k, x)| (k.clone(), num(x)))
        .collect()
}

fn mini_state(v: &Value) -> EngineState {
    let mut s = initial_state();
    s.updated = v["updated"].as_str().expect("updated").to_string();
    s.prs_history = dated(&v["prsHistory"]);
    s.fatigue_muscle = num_map(&v["fatigueMuscle"]);
    s.fatigue_damage = num_map(&v["fatigueDamage"]);
    s.fatigue_systemic = num(&v["fatigueSystemic"]);
    s
}

fn cmp_readiness(errs: &mut Vec<String>, expected: &Value, r: &Readiness) -> u32 {
    let mut inexact = cmp_num(errs, "score", &expected[0], r.score, ENGINE_TOL);
    match (&expected[1], r.prs_z) {
        (Value::Null, None) => {}
        (Value::Null, Some(z)) => errs.push(format!("prsZ: Rust {} but TS null", fmt_f(z))),
        (e, None) => errs.push(format!("prsZ: Rust null but TS {e}")),
        (e, Some(z)) => inexact += cmp_num(errs, "prsZ", e, z, ENGINE_TOL),
    }
    cmp_bool(errs, "prsFlag", &expected[2], r.prs_flag);
    cmp_strings(
        errs,
        "soreBlockedMuscles",
        &expected[3],
        &r.sore_blocked_muscles,
    );
    cmp_strings(errs, "reasons", &expected[4], &r.reasons);
    inexact
}

/// An optional number result: `expected` is null or a number.
fn cmp_opt(errs: &mut Vec<String>, path: &str, expected: &Value, actual: Option<f64>) -> u32 {
    match (expected, actual) {
        (Value::Null, None) => 0,
        (Value::Null, Some(x)) => {
            errs.push(format!("{path}: Rust {} but TS null", fmt_f(x)));
            0
        }
        (e, None) => {
            errs.push(format!("{path}: Rust null but TS {e}"));
            0
        }
        (e, Some(x)) => cmp_num(errs, path, e, x, ENGINE_TOL),
    }
}

/// Pushes `panicked: ...` and returns 0 for a case that panicked; otherwise `f`'s result.
fn or_panic<T>(
    errs: &mut Vec<String>,
    r: Result<T, String>,
    f: impl FnOnce(&mut Vec<String>, T) -> u32,
) -> u32 {
    match r {
        Ok(x) => f(errs, x),
        Err(msg) => {
            errs.push(format!("panicked: {msg}"));
            0
        }
    }
}

fn engine_case(v: &Value, errs: &mut Vec<String>) -> (&'static str, u32) {
    let kind = v[0].as_str().expect("case kind");
    match kind {
        "os" => {
            let s = set_log(&v[1]);
            let inexact = or_panic(errs, guarded(|| observe_set(&s)), |errs, o| {
                cmp_obs(errs, &v[2], o)
            });
            ("observe_set", inexact)
        }
        "bo" => {
            let sets: Vec<SetLog> = v[1].as_array().expect("sets").iter().map(set_log).collect();
            let inexact = or_panic(errs, guarded(|| best_observation(&sets)), |errs, o| {
                cmp_obs(errs, &v[2], o)
            });
            ("best_observation", inexact)
        }
        "rl" => {
            let (reps, rpe) = (num(&v[1]), num(&v[2]));
            or_panic(errs, guarded(|| rts_lookup(reps, rpe)), |errs, l| {
                let e = &v[3];
                match (&e[0], l.pct) {
                    (Value::Null, None) => {}
                    (Value::Null, Some(p)) => errs.push(format!("pct: Rust {p} but TS null")),
                    (x, None) => errs.push(format!("pct: Rust null but TS {x}")),
                    (x, Some(p)) => {
                        cmp_num(errs, "pct", x, p, Tol::Exact);
                    }
                }
                cmp_bool(errs, "verified", &e[1], l.verified);
                cmp_bool(errs, "useRule3Fallback", &e[2], l.use_rule3_fallback);
                0
            });
            ("rts_lookup", 0)
        }
        "db" => {
            let (a, b) = (v[1].as_str().expect("a"), v[2].as_str().expect("b"));
            let inexact = or_panic(errs, guarded(|| days_between(a, b)), |errs, r| {
                match (r, v[3].as_str()) {
                    (Err(_), Some("NaN")) => 0,
                    (Ok(x), Some("NaN")) => {
                        errs.push(format!("Rust returned {} but TS gave NaN", fmt_f(x)));
                        0
                    }
                    (Err(e), _) => {
                        errs.push(format!("Rust errored ({e}) but TS gave {}", v[3]));
                        0
                    }
                    (Ok(x), _) => cmp_num(errs, "daysBetween", &v[3], x, ENGINE_TOL),
                }
            });
            ("days_between", inexact)
        }
        "dv" => {
            let (x, dt, tau) = (num(&v[1]), num(&v[2]), num(&v[3]));
            let inexact = or_panic(errs, guarded(|| decay_value(x, dt, tau)), |errs, y| {
                cmp_num(errs, "decayValue", &v[4], y, ENGINE_TOL)
            });
            ("decay_value", inexact)
        }
        "ai" => {
            let (x, dt, tau, k, input) =
                (num(&v[1]), num(&v[2]), num(&v[3]), num(&v[4]), num(&v[5]));
            let inexact = or_panic(
                errs,
                guarded(|| apply_input(x, dt, tau, k, input)),
                |errs, y| cmp_num(errs, "applyInput", &v[6], y, ENGINE_TOL),
            );
            ("apply_input", inexact)
        }
        "mt" => {
            let name = v[1].as_str().expect("name");
            or_panic(errs, guarded(|| muscle_tau(name)), |errs, t| {
                cmp_num(errs, "muscleTau", &v[2], t, Tol::Exact)
            });
            ("muscle_tau", 0)
        }
        "dr" => {
            let rec: BTreeMap<String, f64> = v[1]
                .as_array()
                .expect("record")
                .iter()
                .map(|p| (p[0].as_str().expect("key").to_string(), num(&p[1])))
                .collect();
            let dt = num(&v[2]);
            let by_muscle = v[3].as_str() == Some("muscleTau");
            let tau = if by_muscle { 0.0 } else { num(&v[3]) };
            let run = guarded(|| {
                if by_muscle {
                    decay_record(&rec, dt, muscle_tau)
                } else {
                    decay_record(&rec, dt, |_| tau)
                }
            });
            let inexact = or_panic(errs, run, |errs, out| {
                let expected = v[4].as_array().expect("expected record");
                if expected.len() != out.len() {
                    errs.push(format!(
                        "decayRecord: Rust has {} keys but TS {}",
                        out.len(),
                        expected.len()
                    ));
                }
                let mut inexact = 0;
                for p in expected {
                    let key = p[0].as_str().expect("key");
                    match out.get(key) {
                        Some(y) => {
                            inexact += cmp_num(
                                errs,
                                &format!("decayRecord[{key:?}]"),
                                &p[1],
                                *y,
                                ENGINE_TOL,
                            )
                        }
                        None => errs.push(format!("decayRecord: Rust lacks key {key:?}")),
                    }
                }
                inexact
            });
            ("decay_record", inexact)
        }
        "ak" => {
            let (key, days) = (v[1].as_str().expect("key"), v[2].as_i64().expect("days"));
            or_panic(
                errs,
                guarded(|| (try_add_days_key(key, days), add_days_key(key, days))),
                |errs, (r, plain)| {
                    match (r, v[3].as_str()) {
                        (Err(_), Some("throw")) => {
                            // The infallible form returns the key unchanged instead of throwing.
                            if plain != key {
                                errs.push(format!("add_days_key({key:?}) gave {plain:?} instead of the key itself"));
                            }
                        }
                        (Ok(r), Some("throw")) => {
                            errs.push(format!("Rust returned {r:?} but TS threw"))
                        }
                        (Err(e), Some(want)) => {
                            errs.push(format!("Rust errored ({e}) but TS gave {want:?}"))
                        }
                        (Ok(r), Some(want)) => {
                            if r != want || plain != want {
                                errs.push(format!(
                                    "addDaysKey: Rust {r:?} / {plain:?} but TS {want:?}"
                                ));
                            }
                        }
                        (_, None) => errs.push("bad expected value".to_string()),
                    }
                    0
                },
            );
            ("add_days_key", 0)
        }
        "cs" => {
            let now = v[1].as_str().expect("now");
            let efforts: Vec<BestEffort> = v[2]
                .as_array()
                .expect("efforts")
                .iter()
                .map(|e| BestEffort {
                    distance_m: num(&e[0]),
                    seconds: num(&e[1]),
                    date: e[2].as_str().expect("date").to_string(),
                })
                .collect();
            let inexact = or_panic(
                errs,
                guarded(|| critical_speed(&efforts, now)),
                |errs, r| match r {
                    Ok(got) => cmp_opt(errs, "criticalSpeed", &v[3], got),
                    Err(e) => {
                        errs.push(format!("Rust errored: {e}"));
                        0
                    }
                },
            );
            ("critical_speed", inexact)
        }
        "pz" => {
            let (now, prs) = (v[1].as_str().expect("now"), num(&v[2]));
            let hist = dated(&v[3]);
            let inexact = or_panic(
                errs,
                guarded(|| prs_z_score(&hist, now, prs)),
                |errs, r| match r {
                    Ok(got) => cmp_opt(errs, "prsZScore", &v[4], got),
                    Err(e) => {
                        errs.push(format!("Rust errored: {e}"));
                        0
                    }
                },
            );
            ("prs_z_score", inexact)
        }
        "rc" | "rd" => {
            let now = v[1].as_str().expect("now");
            let state = mini_state(&v[2]);
            let checkin = Checkin {
                prs: num(&v[3]["prs"]),
                soreness: num_map(&v[3]["soreness"]),
            };
            let muscles: Vec<String> = v[4]
                .as_array()
                .expect("muscles")
                .iter()
                .map(|m| m.as_str().expect("muscle").to_string())
                .collect();
            let decay = kind == "rd";
            let run = guarded(|| {
                if decay {
                    predict_readiness(&state, &checkin, Some(&muscles), now)
                } else {
                    predict_readiness_core(&state, &checkin, &muscles, now)
                }
            });
            let inexact = or_panic(errs, run, |errs, r| match r {
                Ok(r) => cmp_readiness(errs, &v[5], &r),
                Err(e) => {
                    errs.push(format!("Rust errored: {e}"));
                    0
                }
            });
            (
                if decay {
                    "readiness_decay"
                } else {
                    "readiness_core"
                },
                inexact,
            )
        }
        other => panic!("unknown engine fuzz case kind {other:?}"),
    }
}

#[test]
fn fuzz_engine() {
    let Some((manifest, files)) = read_manifest(ENGINE_DIR, "fuzz:engine") else {
        return;
    };
    let expected = manifest["cases"].as_u64().expect("manifest cases") as usize;
    if expected < 1_500_000 {
        eprintln!("fuzz_engine: partial corpus, {expected} cases (the full run is 1,500,000)");
    }
    let report = Report::default();
    replay(&files, &report, engine_case);
    finish("fuzz_engine", &report, expected);
}
