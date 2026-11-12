//! Native tests of the exported UniFFI functions (the Rust side, not the Kotlin binding).
#[path = "../../qala-lspp-json/tests/common/mod.rs"]
mod common;

use common::*;
use qala_ffi as w;
use w::QalaError;
use serde_json::{json, Value};

#[test]
fn evaluate_gzclp_matches_golden() {
    let doc = load("builtins/gzclp.json");
    let c = case(&doc, "forceEvaluateText", "");
    let out = w::force_evaluate_text(request_from(&doc, c)).unwrap();
    assert_matches(&result_of(&out), &c["output"], "gzclp evaluated");
}

#[test]
fn finish_day_matches_golden() {
    let doc = load("finish_day.json");
    let c = case(&doc, "runAllFinishDayScripts", "gzclp day 1 all sets hit");
    let out = w::run_all_finish_day_scripts(request_from(&doc, c)).unwrap();
    assert_matches(&result_of(&out), &c["output"], "finish day");
}

#[test]
fn next_history_entry_matches_golden() {
    let doc = load("next_history_entry.json");
    let c = case(&doc, "Program_nextHistoryEntry", "");
    let out = w::next_history_entry(request_from(&doc, c)).unwrap();
    assert_matches(&result_of(&out), &c["output"], "next history entry");
}

#[test]
fn errors_are_values() {
    for bad in ["", "nope", "{}", "{\"v\":9}"] {
        assert!(matches!(w::force_evaluate_text(bad.to_string()), Err(QalaError::InvalidInput(_))), "{bad:?}");
        assert!(matches!(w::run_all_finish_day_scripts(bad.to_string()), Err(QalaError::InvalidInput(_))), "{bad:?}");
    }
    let doc = load("next_history_entry.json");
    let c = case(&doc, "Program_nextHistoryEntry", "");
    let mut req: Value = serde_json::from_str(&request_from(&doc, c)).unwrap();
    req["exerciseKey"] = json!("nope");
    assert!(matches!(w::next_history_entry(req.to_string()), Err(QalaError::Evaluation(_))));
}

#[test]
fn diagnostics() {
    let r = result_of(&w::diagnose_planner("Squat / 3x".to_string()).unwrap());
    assert!(!r.as_array().unwrap().is_empty());
    assert_eq!(result_of(&w::diagnose_script(String::new()).unwrap()), json!([]));
    assert_eq!(result_of(&w::diagnose_planner("# Week 1\n## Day 1\nSquat / 3x5\n".to_string()).unwrap()), json!([]));
}

#[test]
fn dry_run_export() {
    let doc = load("finish_day_rotation_gzclp.json");
    let req = json!({
        "v": 1, "program": doc["fixtures"]["programs"]["gzclp"], "settings": doc["fixtures"]["settings"]["gzclp_settings"],
        "fromDay": 1, "sessions": 1
    });
    let r = result_of(&w::dry_run(req.to_string()).unwrap());
    assert_eq!(r["sessions"][0]["day"], 1);
    assert_eq!(r["finalText"], doc["cases"][0]["output"]["plannerText"]);
    assert!(matches!(w::dry_run("{}".to_string()), Err(QalaError::InvalidInput(_))));
}

#[test]
fn unresolved_sets_export() {
    let doc = load("finish_day_rotation_gzclp.json");
    let req = json!({
        "v": 1, "programText": "# Week 1\n## Day 1\nSplit Squat / 1x8 ?+\n",
        "settings": doc["fixtures"]["settings"]["gzclp_settings"]
    });
    let r = result_of(&w::unresolved_sets(req.to_string()).unwrap());
    assert_eq!(r[0]["state"], "blank");
    assert!(matches!(w::unresolved_sets("{}".to_string()), Err(QalaError::InvalidInput(_))));
}

#[test]
fn lint_planner_export() {
    assert_eq!(result_of(&w::lint_planner("# Week 1\n## Day 1\nSquat / 3x5 100lb\n".to_string()).unwrap()), json!([]));
    let r = result_of(&w::lint_planner("# Week 1\n## Day 1\nSquat / 31x5 100lb\n".to_string()).unwrap());
    assert_eq!(r[0]["code"], "too-many-sets");
    assert_eq!(r[0]["line"], 3);
}

#[test]
fn format_planner_export() {
    let r = result_of(&w::format_planner("Squat/3x5   100lb".to_string()).unwrap());
    assert_eq!(r, json!({"ok": true, "text": "Squat / 3x5 100lb\n", "changed": true}));
    let r = result_of(&w::format_planner("Squat / 3x5 100lb\n".to_string()).unwrap());
    assert_eq!(r["changed"], false);
    let r = result_of(&w::format_planner("Squat / 3x".to_string()).unwrap());
    assert_eq!(r["ok"], false);
    assert!(!r["diagnostics"].as_array().unwrap().is_empty());
}

// ---- run pipeline ----

fn run_golden(file: &str) -> Value {
    let path = format!("{}/../../testdata/golden/run/{file}.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn run_case<'a>(doc: &'a Value, name: &str) -> &'a Value {
    doc["cases"].as_array().unwrap().iter().find(|c| c["name"] == name).unwrap_or_else(|| panic!("no case {name}"))
}

fn close(a: f64, e: f64) -> bool {
    a == e || (a - e).abs() <= 1e-9 * a.abs().max(e.abs()) + 1e-9
}

#[test]
fn process_run_export_matches_golden() {
    let doc = run_golden("process_run");
    let c = run_case(&doc, "pipeline: 2 miles with a stop, guided tempo");
    let req = json!({"v": 1, "fixes": c["input"]["fixes"], "opts": c["input"]["opts"]});
    let r = result_of(&w::process_run(req.to_string()).unwrap());
    let e = &c["expected"];
    assert_eq!(r["points"].as_array().unwrap().len(), e["points"].as_array().unwrap().len());
    assert_eq!(r["paused"], e["paused"]);
    assert_eq!(r["splits"].as_array().unwrap().len(), e["splits"].as_array().unwrap().len());
    let types = |v: &Value| -> Vec<String> {
        v["guidedEvents"].as_array().unwrap().iter().map(|g| g["type"].as_str().unwrap().to_string()).collect()
    };
    assert_eq!(types(&r), types(e));
    for key in ["distanceM", "movingSec", "elapsedSec", "avgSpeedMps"] {
        assert!(close(r[key].as_f64().unwrap(), e[key].as_f64().unwrap()), "{key}");
    }
}

#[test]
fn run_recorder_object_replays_a_golden_run_fix_by_fix() {
    let doc = run_golden("process_run");
    let c = run_case(&doc, "pipeline: 2 miles with a stop, guided tempo");
    let config = json!({"v": 1, "opts": c["input"]["opts"]}).to_string();
    let rec = w::RunRecorder::new(config).unwrap();
    let mut guided: Vec<Value> = Vec::new();
    let mut last = Value::Null;
    for f in c["input"]["fixes"].as_array().unwrap() {
        let mut req = f.clone();
        req["v"] = json!(1);
        let out = result_of(&rec.push_fix(req.to_string()).unwrap());
        guided.extend(out["events"].as_array().unwrap().iter().cloned());
        last = out["live"].clone();
    }
    let run = result_of(&rec.finish().unwrap());
    let e = &c["expected"];
    assert_eq!(guided.len(), e["guidedEvents"].as_array().unwrap().len());
    assert_eq!(run["points"].as_array().unwrap().len(), e["points"].as_array().unwrap().len());
    assert!(close(last["distM"].as_f64().unwrap(), e["distanceM"].as_f64().unwrap()));
    assert!(close(run["distanceM"].as_f64().unwrap(), e["distanceM"].as_f64().unwrap()));
    assert_eq!(last["points"], json!(run["points"].as_array().unwrap().len()));
}

#[test]
fn run_recorder_errors_are_values() {
    for bad in ["", "nope", "{}", "{\"v\":9}", "{\"v\":1,\"opts\":{\"nope\":1}}"] {
        assert!(matches!(w::RunRecorder::new(bad.to_string()), Err(QalaError::InvalidInput(_))), "{bad:?}");
    }
    let rec = w::RunRecorder::new("{\"v\":1}".to_string()).unwrap();
    assert!(matches!(rec.push_fix("{\"v\":1}".to_string()), Err(QalaError::InvalidInput(_))));
    let fix = json!({"v": 1, "t": 1.0, "lat": 47.6, "lon": -122.3, "acc": 4.0}).to_string();
    let live = result_of(&rec.push_fix(fix.clone()).unwrap())["live"].clone();
    assert_eq!(live["points"], json!(1));
    assert_eq!(result_of(&rec.advance().unwrap())["events"], json!([]));
    rec.finish().unwrap();
    // After finish the recorder is closed.
    assert!(matches!(rec.push_fix(fix), Err(QalaError::Evaluation(_))));
    assert!(matches!(rec.advance(), Err(QalaError::Evaluation(_))));
    assert!(rec.finish().is_ok(), "finish is repeatable");
}

#[test]
fn run_recorders_are_independent_and_thread_safe() {
    let a = w::RunRecorder::new("{\"v\":1}".to_string()).unwrap();
    let b = w::RunRecorder::new("{\"v\":1}".to_string()).unwrap();
    let fix = |t: f64| json!({"v": 1, "t": t, "lat": 47.6 + t * 2e-5, "lon": -122.3, "acc": 4.0}).to_string();
    let a2 = a.clone();
    let h = std::thread::spawn(move || {
        for t in 0..50 {
            a2.push_fix(fix(t as f64)).unwrap();
        }
    });
    b.push_fix(fix(0.0)).unwrap();
    h.join().unwrap();
    assert_eq!(result_of(&a.finish().unwrap())["points"].as_array().unwrap().len(), 50);
    assert_eq!(result_of(&b.finish().unwrap())["points"].as_array().unwrap().len(), 1);
}
