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
