//! Native tests of the exported functions (the Rust side of the wasm ABI, not the wasm ABI).
#[path = "../../qala-lspp-json/tests/common/mod.rs"]
mod common;

use common::*;
use qala_lspp_wasm as w;
use serde_json::{json, Value};

#[test]
fn evaluate_gzclp_matches_golden() {
    let doc = load("builtins/gzclp.json");
    let c = case(&doc, "forceEvaluateText", "");
    let out = w::force_evaluate_text(&request_from(&doc, c));
    assert_matches(&result_of(&out), &c["output"], "gzclp evaluated");
}

#[test]
fn finish_day_matches_golden() {
    let doc = load("finish_day.json");
    let c = case(&doc, "runAllFinishDayScripts", "gzclp day 1 all sets hit");
    let out = w::run_all_finish_day_scripts(&request_from(&doc, c));
    assert_matches(&result_of(&out), &c["output"], "finish day");
}

#[test]
fn next_history_entry_matches_golden() {
    let doc = load("next_history_entry.json");
    let c = case(&doc, "Program_nextHistoryEntry", "");
    let out = w::next_history_entry(&request_from(&doc, c));
    assert_matches(&result_of(&out), &c["output"], "next history entry");
}

#[test]
fn errors_are_values() {
    for bad in ["", "nope", "{}", "{\"v\":9}"] {
        let (kind, _) = error_of(&w::force_evaluate_text(bad));
        assert_eq!(kind, "invalidInput", "{bad:?}");
        let (kind, _) = error_of(&w::run_all_finish_day_scripts(bad));
        assert_eq!(kind, "invalidInput", "{bad:?}");
    }
    let doc = load("next_history_entry.json");
    let c = case(&doc, "Program_nextHistoryEntry", "");
    let mut req: Value = serde_json::from_str(&request_from(&doc, c)).unwrap();
    req["exerciseKey"] = json!("nope");
    let (kind, _) = error_of(&w::next_history_entry(&req.to_string()));
    assert_eq!(kind, "evaluation");
}

#[test]
fn diagnostics() {
    let r = result_of(&w::diagnose_planner("Squat / 3x"));
    assert!(!r.as_array().unwrap().is_empty());
    let first = &r[0];
    assert_eq!((first["line"].as_u64(), first["col"].as_u64()), (Some(1), Some(10)));
    assert!(first["suggestion"].as_str().unwrap().contains("3x5"));
    assert_eq!(result_of(&w::diagnose_script("")), json!([]));
    assert_eq!(result_of(&w::diagnose_planner("# Week 1\n## Day 1\nSquat / 3x5\n")), json!([]));
}

#[test]
fn format_planner_export() {
    let r = result_of(&w::format_planner("Squat/3x5   100lb"));
    assert_eq!(r, json!({"ok": true, "text": "Squat / 3x5 100lb\n", "changed": true}));
    let r = result_of(&w::format_planner("Squat / 3x5 100lb\n"));
    assert_eq!(r["changed"], false);
    let r = result_of(&w::format_planner("Squat / 3x"));
    assert_eq!(r["ok"], false);
    assert!(!r["diagnostics"].as_array().unwrap().is_empty());
}
