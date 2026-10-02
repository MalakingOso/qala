//! Native tests of the exported UniFFI functions (the Rust side, not the Kotlin binding).
#[path = "../../qala-lspp-json/tests/common/mod.rs"]
mod common;

use common::*;
use qala_lspp_ffi as w;
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
