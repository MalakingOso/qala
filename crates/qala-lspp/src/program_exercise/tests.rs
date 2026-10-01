//! Replays `applyVariables` and the pure helpers against the TS oracle
//! (`testdata/unit/gen_planner_exercise_eval_cases.ts`).

use serde_json::Value;

use super::*;
use crate::planner_exercise_eval::tests::{cases, first_diff, settings, to_json};

fn base_program() -> IEvaluatedProgram {
    serde_json::from_value(cases()["applyProgram"].clone()).expect("applyProgram fixture")
}

#[test]
fn apply_variables_matches_oracle() {
    let s = settings("lb");
    let list = cases()["applyVariables"].as_array().expect("apply cases");
    assert!(list.len() >= 30);
    let mut failures = Vec::new();
    for case in list {
        let key = case["key"].as_str().unwrap_or("");
        let updates: Vec<ILiftoscriptEvaluatorUpdate> =
            serde_json::from_value(case["updates"].clone()).expect("updates");
        let mut program = base_program();
        apply_variables(key, &mut program, &updates, &s);
        let touched: Vec<&IPlannerProgramExercise> = program
            .weeks
            .iter()
            .flat_map(|w| {
                w.days
                    .iter()
                    .flat_map(|d| d.exercises.iter().filter(|e| e.key == key))
            })
            .collect();
        let got = serde_json::json!({ "exercises": to_json(&touched) });
        if got != case["output"] {
            failures.push(format!(
                "{}: {}",
                case["updates"],
                first_diff(&got, &case["output"], "")
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} mismatched, first: {:#?}",
        failures.len(),
        &failures[..failures.len().min(5)]
    );
}

#[test]
fn pure_helpers_match_oracle() {
    let s = settings("lb");
    for case in cases()["pure"].as_array().expect("pure cases") {
        if let Some(g) = case.get("groupWarmupsSets") {
            let input: Vec<IProgramExerciseWarmupSet> =
                serde_json::from_value(g["input"].clone()).expect("sets");
            assert_eq!(to_json(&group_warmups_sets(&input)), g["output"]);
            continue;
        }
        if let Some(w) = case.get("weightChanges") {
            let got = weight_changes(&base_program(), w["key"].as_str().unwrap_or(""));
            assert_eq!(to_json(&got), w["output"], "weightChanges {}", w["key"]);
            continue;
        }
        let ex: IPlannerProgramExercise =
            serde_json::from_value(case["exercise"].clone()).expect("exercise");
        let label = case["key"].to_string();
        assert_eq!(
            Value::Bool(has_user_prompted_vars(&ex)),
            case["hasUserPromptedVars"],
            "{}",
            label
        );
        assert_eq!(
            Value::Bool(get_quick_add_sets(&ex)),
            case["getQuickAddSets"],
            "{}",
            label
        );
        assert_eq!(
            Value::Bool(get_enable_rpe(&ex)),
            case["getEnableRpe"],
            "{}",
            label
        );
        assert_eq!(
            approx_time_ms(&ex, &s),
            case["approxTimeMs"].as_f64().unwrap_or(f64::NAN),
            "{}",
            label
        );
        assert_eq!(
            Value::Bool(does_use_rpe(&ex)),
            case["doesUseRPE"],
            "{}",
            label
        );
        assert_eq!(
            Value::Bool(is_using_variable(&ex, "rm1")),
            case["isUsingRm1"],
            "{}",
            label
        );
        assert_eq!(
            Value::Bool(is_using_variable(&ex, "state")),
            case["isUsingState"],
            "{}",
            label
        );
        assert_eq!(
            Value::Bool(does_use_1rm(&ex)),
            case["doesUse1RM"],
            "{}",
            label
        );
    }
}

#[test]
fn splice_and_index_helpers_follow_js() {
    assert_eq!(splice_start(5, -2.0), 3);
    assert_eq!(splice_start(5, -9.0), 0);
    assert_eq!(splice_start(5, 9.0), 5);
    assert_eq!(splice_start(5, f64::NAN), 0);
    assert_eq!(splice_start(5, 2.7), 2);
    assert_eq!(js_index(-0.0, 3), Some(0));
    assert_eq!(js_index(1.5, 3), None);
    assert_eq!(js_index(-1.0, 3), None);
    assert_eq!(js_index(f64::NAN, 3), None);
    assert_eq!(js_index(3.0, 3), None);
}
