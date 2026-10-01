//! Replays `ProgramToPlanner.convertToPlanner` + `PlannerProgram_generateFullText`
//! against the TS oracle (`testdata/unit/gen_program_to_planner_cases.ts`), and checks the
//! `plannerText` of the finish-day goldens.

use std::path::PathBuf;

use serde_json::Value;

use super::*;
use crate::planner_program::generate_full_text;
use crate::util::generator::SequentialUid;

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../testdata/golden/liftoscript")
}

fn read_json(path: &std::path::Path) -> Value {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn unit_cases() -> Value {
    serde_json::from_str(include_str!("../../testdata/unit/cases_program_to_planner.json"))
        .expect("cases_program_to_planner.json parses")
}

/// Evaluated program of a `builtins*/<name>.json` golden (the `evaluated*` case output).
fn golden_program(rel: &str) -> Value {
    let file = read_json(&golden_dir().join(rel));
    let case = file["cases"]
        .as_array()
        .and_then(|cs| cs.iter().find(|c| c["fn"] == "forceEvaluateText"))
        .unwrap_or_else(|| panic!("{rel}: no forceEvaluateText case"));
    let out = &case["output"];
    // Outputs over 4.5 MB are stored pruned (reuse inside reuse removed).
    if out.get("$pruned").is_some() {
        out["value"].clone()
    } else {
        out.clone()
    }
}

struct Outcome {
    planner: Result<String, String>,
    text: Option<String>,
}

fn run(program: &Value, settings: &Value) -> Outcome {
    let program: IEvaluatedProgram = serde_json::from_value(program.clone()).expect("program parses");
    let settings: ISettings = serde_json::from_value(settings.clone()).expect("settings parse");
    let mut uid = SequentialUid::new();
    match ProgramToPlanner::new(&program, &settings).convert_to_planner(&ConvertOpts::default(), &mut uid) {
        Ok(planner) => {
            let json = serde_json::to_string(&planner).expect("serializes");
            let text = generate_full_text(&planner.weeks);
            Outcome { planner: Ok(json), text: Some(text) }
        }
        Err(e) => Outcome { planner: Err(e.message.clone()), text: None },
    }
}

/// Key order equal, ignoring where a `description` key sits.
fn same_key_order(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let ks = |m: &serde_json::Map<String, Value>| -> Vec<String> {
                m.keys().filter(|k| *k != "description").cloned().collect()
            };
            ks(x) == ks(y) && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same_key_order(v, w)))
        }
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(v, w)| same_key_order(v, w))
        }
        _ => true,
    }
}

fn first_text_diff(a: &str, b: &str) -> String {
    for (i, (x, y)) in a.lines().zip(b.lines()).enumerate() {
        if x != y {
            return format!("line {}:\n  got:      {x}\n  expected: {y}", i + 1);
        }
    }
    format!("line counts differ ({} vs {})", a.lines().count(), b.lines().count())
}

fn check_case(case: &Value, fixtures: &Value, failures: &mut Vec<String>) {
    let name = case["name"].as_str().unwrap_or("?");
    let settings = &fixtures["settings"][case["settings"].as_str().unwrap_or("lb")];
    let program = match case.get("golden").and_then(Value::as_str) {
        Some(rel) => golden_program(rel),
        None => case["program"].clone(),
    };
    let got = run(&program, settings);
    if let Some(err) = case.get("error") {
        match got.planner {
            Err(msg) => {
                if Some(msg.as_str()) != err["message"].as_str() {
                    failures.push(format!("{name}: error message {msg:?} vs {}", err["message"]));
                }
            }
            Ok(_) => failures.push(format!("{name}: expected a throw, got a result")),
        }
        return;
    }
        match got.planner {
        Err(msg) => failures.push(format!("{name}: unexpected error {msg}")),
        Ok(json) => {
            // The planner structs serialize `description` before `days` / `exerciseText`,
            // while this TS path builds `{name, days, description}` (week) and
            // `{name, exerciseText, description}` (day). The planner_exercise_eval goldens need the
            // struct order, so one struct order cannot serve both. Values and the text are exact;
            // key order is only checked up to that known difference.
            let got_value: Value = serde_json::from_str(&json).unwrap_or(Value::Null);
            if got_value != case["planner"] {
                let got_text = got.text.clone().unwrap_or_default();
                let detail = first_text_diff(&got_text, case["text"].as_str().unwrap_or(""));
                failures.push(format!("{name}: planner json differs ({detail})"));
            } else if !same_key_order(&got_value, &case["planner"]) {
                failures.push(format!("{name}: key order differs beyond week/day description"));
            } else if got.text.as_deref() != case["text"].as_str() {
                failures.push(format!(
                    "{name}: text differs: {}",
                    first_text_diff(got.text.as_deref().unwrap_or(""), case["text"].as_str().unwrap_or(""))
                ));
            }
        }
    }
}

fn run_group(prefix: &str, min: usize) {
    let all = unit_cases();
    let cases: Vec<&Value> = all["cases"]
        .as_array()
        .expect("cases")
        .iter()
        .filter(|c| c["name"].as_str().is_some_and(|n| n.starts_with(prefix)))
        .collect();
    assert!(cases.len() >= min, "{prefix}: only {} cases", cases.len());
    let mut failures = Vec::new();
    for c in &cases {
        check_case(c, &all["fixtures"], &mut failures);
    }
    assert!(
        failures.is_empty(),
        "{} of {} {prefix} cases differ:\n{}",
        failures.len(),
        cases.len(),
        failures.join("\n")
    );
}

#[test]
fn builtin_lb_programs_match_oracle() {
    run_group("builtin_lb_", 60);
}

#[test]
fn builtin_kg_programs_match_oracle() {
    run_group("builtin_kg_", 10);
}

#[test]
fn edge_programs_match_oracle() {
    run_group("edge_", 35);
}

#[test]
fn edge_cases_include_throws() {
    let all = unit_cases();
    let throws = all["cases"]
        .as_array()
        .expect("cases")
        .iter()
        .filter(|c| c.get("error").is_some())
        .count();
    assert!(throws >= 3, "only {throws} throwing cases");
}

/// `plannerText` of `runAllFinishDayScripts` is `generateFullText(convertToPlanner(evaluatedProgram))`
/// of the output program, so Rust must reproduce it from the golden output alone.
#[test]
fn finish_day_golden_planner_text() {
    let mut checked = 0;
    let mut failures = Vec::new();
    let mut files: Vec<PathBuf> = std::fs::read_dir(golden_dir())
        .expect("golden dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("finish_day")))
        .collect();
    files.sort();
    assert!(!files.is_empty());
    for path in files {
        let file = read_json(&path);
        let tag = path.file_name().and_then(|n| n.to_str()).unwrap_or("?").to_string();
        for case in file["cases"].as_array().expect("cases") {
            let out = &case["output"];
            let (Some(text), Some(program)) = (out["plannerText"].as_str(), out.get("evaluatedProgram")) else {
                continue;
            };
            if program.get("$pruned").is_some() || !program.is_object() {
                continue;
            }
            let settings_ref = case["inputs"]["settingsRef"].as_str().unwrap_or("");
            let settings = &file["fixtures"]["settings"][settings_ref];
            if settings.is_null() {
                continue;
            }
            let got = run(program, settings);
            checked += 1;
            let label = format!("{tag} / {}", case["name"]);
            match got.text {
                Some(t) if t == text => {}
                Some(t) => failures.push(format!("{label}: {}", first_text_diff(&t, text))),
                None => failures.push(format!("{label}: error {:?}", got.planner.err())),
            }
        }
    }
    assert!(checked >= 20, "only {checked} finish-day cases checked");
    assert!(failures.is_empty(), "{} of {checked} differ:\n{}", failures.len(), failures.join("\n"));
}

#[test]
fn text_helpers_match_js_regexes() {
    assert_eq!(mark_current_description("// note"), "// ! note");
    assert_eq!(mark_current_description("//  ! note"), "// ! note");
    assert_eq!(mark_current_description("//!note"), "// ! note");
    assert_eq!(mark_current_description("plain"), "plain");
    assert_eq!(unmark_description("// ! note"), "// note");
    assert_eq!(unmark_description("//   !   note"), "//   note");
    assert_eq!(unmark_description("// note"), "// note");
    assert_eq!(unmark_description("//!x"), "//x");
}

#[test]
fn splice_start_follows_js() {
    assert_eq!(splice_start(0, 3), 0);
    assert_eq!(splice_start(5, 3), 3);
    assert_eq!(splice_start(-1, 3), 2);
    assert_eq!(splice_start(-9, 3), 0);
}
