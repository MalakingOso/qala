mod common;

use common::*;
use qala_lspp_json as api;
use serde_json::{json, Value};

fn run_golden(file: &str, fn_name: &str, limit: usize, call: impl Fn(&str) -> api::ApiResult) {
    let doc = load(file);
    let cases = cases_of_fn(&doc, fn_name, limit);
    assert!(!cases.is_empty(), "no {fn_name} cases in {file}");
    for c in cases {
        let req = request_from(&doc, c);
        let out = call(&req).unwrap_or_else(|e| panic!("{file} {fn_name}: {e}"));
        let name = c["name"].as_str().unwrap_or("?");
        assert_matches(&result_of(&out), &c["output"], &format!("{file} / {name}"));
    }
}

#[test]
fn evaluate_gzclp_matches_golden() {
    run_golden("builtins/gzclp.json", "forceEvaluateText", 1, api::force_evaluate_text);
}

#[test]
fn evaluate_qala_program_matches_golden() {
    run_golden("bindings.json", "evaluateQalaProgram", 1, api::evaluate_qala_program);
}

#[test]
fn settings_and_engine_bindings_match_golden() {
    run_golden("bindings.json", "qalaSettingsToLiftoscript", 2, api::qala_settings_to_liftoscript);
    run_golden("bindings.json", "createEngineBindings", 8, api::create_engine_bindings);
}

#[test]
fn next_history_entry_and_get_day_match_golden() {
    run_golden("next_history_entry.json", "Program_nextHistoryEntry", 2, api::next_history_entry);
    run_golden("next_history_entry.json", "getDay", 1, api::get_day);
}

#[test]
fn finish_day_matches_golden() {
    run_golden("finish_day.json", "runAllFinishDayScripts", 2, api::run_all_finish_day_scripts);
    run_golden("finish_day_3.json", "runFinishDayScript", 2, api::run_finish_day_script);
    run_golden("finish_day_4.json", "runUpdateScriptForEntry", 2, api::run_update_script_for_entry);
}

#[test]
fn same_request_gives_same_output() {
    let doc = load("builtins/gzclp.json");
    let c = case(&doc, "forceEvaluateText", "");
    let req = request_from(&doc, c);
    let a = api::force_evaluate_text(&req).unwrap();
    let b = api::force_evaluate_text(&req).unwrap();
    assert_eq!(a, b);
}

#[test]
fn uid_arguments_are_honoured() {
    let doc = load("builtins/gzclp.json");
    let c = case(&doc, "forceEvaluateText", "");
    let mut req: Value = serde_json::from_str(&request_from(&doc, c)).unwrap();
    let id_with = |req: &Value| result_of(&api::force_evaluate_text(&req.to_string()).unwrap())["id"].as_str().unwrap().to_string();
    assert_eq!(id_with(&req), "aaaaaaaa");
    req["uidSeed"] = json!(26);
    assert_eq!(id_with(&req), "aaaaaaba");
    req["uids"] = json!(["fixedid1"]);
    assert_eq!(id_with(&req), "fixedid1");
}

#[test]
fn malformed_requests_return_errors_not_panics() {
    let every: [fn(&str) -> api::ApiResult; 9] = [
        api::force_evaluate_text,
        api::evaluate_qala_program,
        api::qala_settings_to_liftoscript,
        api::create_engine_bindings,
        api::get_day,
        api::next_history_entry,
        api::run_update_script_for_entry,
        api::run_finish_day_script,
        api::run_all_finish_day_scripts,
    ];
    let bad = ["", "not json", "{", "null", "[]", "{}", "{\"v\":2}", "{\"v\":1}", "{\"v\":1,\"day\":\"x\"}", "\u{0}\u{ff}"];
    for f in every {
        for b in bad {
            match f(b) {
                Err(api::ApiError::InvalidInput(_)) => {}
                // createEngineBindings has no required field, so any v:1 object is valid for it.
                Ok(s) if b.starts_with("{\"v\":1") => assert!(result_of(&s)["readiness"].is_number()),
                other => panic!("request {b:?}: {other:?}"),
            }
        }
    }
}

#[test]
fn error_envelope_shape() {
    let (kind, msg) = error_of(&api::envelope(api::force_evaluate_text("not json")));
    assert_eq!(kind, "invalidInput");
    assert!(msg.contains("not valid JSON"), "{msg}");
    let (kind, msg) = error_of(&api::envelope(api::get_day("{\"v\":3}")));
    assert_eq!(kind, "invalidInput");
    assert!(msg.contains("unsupported request version 3"), "{msg}");
}

#[test]
fn unknown_day_and_exercise_are_evaluation_errors() {
    let doc = load("next_history_entry.json");
    let c = case(&doc, "Program_nextHistoryEntry", "");
    let mut req: Value = serde_json::from_str(&request_from(&doc, c)).unwrap();
    req["exerciseKey"] = json!("nope");
    match api::next_history_entry(&req.to_string()) {
        Err(api::ApiError::Evaluation(m)) => assert!(m.contains("nope"), "{m}"),
        other => panic!("{other:?}"),
    }
    req["day"] = json!(9999);
    assert!(matches!(api::next_history_entry(&req.to_string()), Err(api::ApiError::Evaluation(_))));
    // getDay for a missing day is a null result, as in the TS.
    let mut get: Value = serde_json::from_str(&request_from(&doc, case(&doc, "getDay", ""))).unwrap();
    get["day"] = json!(9999);
    assert_eq!(result_of(&api::get_day(&get.to_string()).unwrap()), Value::Null);
}

#[test]
fn evaluating_garbage_text_does_not_panic() {
    let doc = load("builtins/gzclp.json");
    let c = case(&doc, "forceEvaluateText", "");
    let mut req: Value = serde_json::from_str(&request_from(&doc, c)).unwrap();
    for text in ["", "Squat / 3x", "((((", "# Week 1\n## Day 1\nSquat / 3x5 / progress: custom() { if } ", "\u{1F3CB}\u{FE0F} / 3x5"] {
        req["programText"] = json!(text);
        let out = api::envelope(api::force_evaluate_text(&req.to_string()));
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["v"], 1, "{text:?}");
    }
}

#[test]
fn planner_diagnostics() {
    let clean = result_of(&api::diagnose_planner("# Week 1\n## Day 1\nSquat / 3x5 100lb\n").unwrap());
    assert_eq!(clean, json!([]));
    let bad = result_of(&api::diagnose_planner("Squat / 3x").unwrap());
    let d = bad.as_array().unwrap();
    assert!(!d.is_empty());
    for x in d {
        assert!(x["from"].as_u64().unwrap() < x["to"].as_u64().unwrap());
        assert!(x["to"].as_u64().unwrap() <= 10);
        assert!(x["message"].as_str().unwrap().starts_with("Syntax error"));
        assert!(x["line"].as_u64().unwrap() >= 1 && x["col"].as_u64().unwrap() >= 1);
        assert!(x["endLine"].as_u64().is_some() && x["endCol"].as_u64().is_some());
    }
    assert_eq!(d[0]["suggestion"], "put a rep count after the x, for example 3x5");
}

#[test]
fn diagnostics_use_utf16_offsets() {
    // The emoji is two UTF-16 units but four UTF-8 bytes; offsets must stay in range of the former.
    let text = "\u{1F3CB} Squat / 3x";
    let units = text.encode_utf16().count();
    let out = result_of(&api::diagnose_planner(text).unwrap());
    for x in out.as_array().unwrap() {
        assert!(x["to"].as_u64().unwrap() as usize <= units);
    }
}

#[test]
fn script_diagnostics() {
    assert_eq!(result_of(&api::diagnose_script("if (completedReps >= reps) { weights += 5lb }").unwrap()), json!([]));
    let bad = result_of(&api::diagnose_script("if (completedReps >= ) { weights += }").unwrap());
    assert!(!bad.as_array().unwrap().is_empty());
    assert_eq!(result_of(&api::diagnose_script("").unwrap()), json!([]));
}
