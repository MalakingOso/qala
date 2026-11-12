//! Replays `ProgramToPlanner.convertToPlanner` + `PlannerProgram_generateFullText`
//! against the TS oracle (`testdata/unit/gen_program_to_planner_cases.ts`), and checks the
//! `plannerText` of the finish-day goldens.

use std::path::PathBuf;

use serde_json::Value;

use super::*;
use crate::planner_program::generate_full_text;
use crate::util::generator::SequentialUid;

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../testdata/golden/lspp")
}

fn read_json(path: &std::path::Path) -> Value {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
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

fn first_text_diff(a: &str, b: &str) -> String {
    for (i, (x, y)) in a.lines().zip(b.lines()).enumerate() {
        if x != y {
            return format!("line {}:\n  got:      {x}\n  expected: {y}", i + 1);
        }
    }
    format!("line counts differ ({} vs {})", a.lines().count(), b.lines().count())
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
