//! Replays the cases produced by
//! `testdata/unit/gen_planner_exercise_eval_cases.ts` (the TS oracle) and a few
//! hand-written checks. Outputs are compared as JSON values; a second test
//! checks that key order matches too.

use std::sync::OnceLock;

use serde::Serialize;
use serde_json::Value;

use super::*;
use crate::planner_parse;

/// The oracle writes non-finite numbers as the strings "NaN", "Infinity" and
/// "-Infinity"; the Rust serializers write them as `null` like `JSON.stringify`.
fn nan_to_null(v: Value) -> Value {
    match v {
        Value::String(s) if s == "NaN" || s == "Infinity" || s == "-Infinity" => Value::Null,
        Value::Array(a) => Value::Array(a.into_iter().map(nan_to_null).collect()),
        Value::Object(m) => {
            Value::Object(m.into_iter().map(|(k, x)| (k, nan_to_null(x))).collect())
        }
        other => other,
    }
}

pub(crate) fn cases() -> &'static Value {
    static C: OnceLock<Value> = OnceLock::new();
    C.get_or_init(|| {
        nan_to_null(
            serde_json::from_str(include_str!(
                "../../testdata/unit/cases_planner_exercise_eval.json"
            ))
            .unwrap_or(Value::Null),
        )
    })
}

/// Path of the first object whose key order differs, or empty.
pub(crate) fn first_order_diff(a: &Value, b: &Value, path: &str) -> String {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            if !path.ends_with(".dayData") && x.keys().ne(y.keys()) {
                return format!(
                    "{} got {:?} expected {:?}",
                    path,
                    x.keys().collect::<Vec<_>>(),
                    y.keys().collect::<Vec<_>>()
                );
            }
            for (k, v) in x {
                // dayData objects are built in three different key orders by the TS callers
                if k == "dayData" {
                    continue;
                }
                if let Some(w) = y.get(k) {
                    let d = first_order_diff(v, w, &format!("{}.{}", path, k));
                    if !d.is_empty() {
                        return d;
                    }
                }
            }
            String::new()
        }
        (Value::Array(x), Value::Array(y)) => {
            for (i, (v, w)) in x.iter().zip(y).enumerate() {
                let d = first_order_diff(v, w, &format!("{}[{}]", path, i));
                if !d.is_empty() {
                    return d;
                }
            }
            String::new()
        }
        _ => String::new(),
    }
}

pub(crate) fn settings(id: &str) -> ISettings {
    serde_json::from_value(cases()["settings"][id].clone()).expect("settings fixture")
}

/// Serialize then parse again, so integers and floats land in the same JSON number
/// variants as the expected values read from the file.
pub(crate) fn to_json<T: Serialize>(v: &T) -> Value {
    serde_json::from_str(&serde_json::to_string(v).expect("serialize")).expect("reparse")
}

pub(crate) fn first_diff(a: &Value, b: &Value, path: &str) -> String {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for (k, v) in x {
                match y.get(k) {
                    None => return format!("{}.{} only in got", path, k),
                    Some(w) => {
                        let d = first_diff(v, w, &format!("{}.{}", path, k));
                        if !d.is_empty() {
                            return d;
                        }
                    }
                }
            }
            for k in y.keys() {
                if !x.contains_key(k) {
                    return format!("{}.{} only in expected", path, k);
                }
            }
            String::new()
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                return format!("{} length got {} expected {}", path, x.len(), y.len());
            }
            for (i, (v, w)) in x.iter().zip(y).enumerate() {
                let d = first_diff(v, w, &format!("{}[{}]", path, i));
                if !d.is_empty() {
                    return d;
                }
            }
            String::new()
        }
        _ => {
            if a == b {
                String::new()
            } else {
                format!("{}: got {} expected {}", path, a, b)
            }
        }
    }
}

fn is_parse_error(v: &Value) -> bool {
    v["success"] == false && v["error"]["details"]["type"] == "parse"
}

fn day_data(v: &Value) -> Option<IDayDataRequired> {
    if v.is_null() {
        None
    } else {
        serde_json::from_value(v.clone()).ok()
    }
}

fn uid(_: usize) -> String {
    "<uid>".to_string()
}

fn run_evaluate(case: &Value) -> Value {
    let script = case["script"].as_str().unwrap_or("");
    let mode =
        PlannerExerciseEvaluatorMode::from_name(case["mode"].as_str().unwrap_or("")).expect("mode");
    let s = settings(case["settings"].as_str().unwrap_or("lb"));
    let tree = planner_parse::parse(script);
    let mut ev = PlannerExerciseEvaluator::new(script, &s, mode, day_data(&case["dayData"]));
    let mut u = uid;
    strip_lezer_node(to_json(&ev.evaluate(&tree, &mut u)))
}

/// The oracle cases are recorded without `liftoscriptNode`; the evaluator fills it
/// (`{"$lezerNode", "from", "to"}`) so evaluated programs match the golden files.
pub(crate) fn strip_lezer_node(v: Value) -> Value {
    match v {
        Value::Array(a) => Value::Array(a.into_iter().map(strip_lezer_node).collect()),
        Value::Object(m) => Value::Object(
            m.into_iter()
                .filter(|(k, _)| k != "liftoscriptNode")
                .map(|(k, x)| (k, strip_lezer_node(x)))
                .collect(),
        ),
        other => other,
    }
}

#[test]
fn evaluate_matches_oracle() {
    let list = cases()["evaluate"].as_array().expect("evaluate cases");
    let mut failures = Vec::new();
    let (mut checked, mut parse_skipped, mut throws_skipped) = (0, 0, 0);
    for case in list {
        if case["output"]["$throws"].is_string() {
            // the TS threw a TypeError; Rust must simply not panic
            throws_skipped += 1;
            let _ = run_evaluate(case);
            continue;
        }
        let got = run_evaluate(case);
        if is_parse_error(&case["output"]) {
            // The hand-written parser recovers differently from Lezer, so only the fact of
            // a "Syntax error" is checked, not its range.
            parse_skipped += 1;
            if !is_parse_error(&got) {
                failures.push(format!("{:?}: expected a syntax error", case["script"]));
            }
            continue;
        }
        checked += 1;
        if got != case["output"] {
            failures.push(format!(
                "{:?} [{}]: {}",
                case["script"]
                    .as_str()
                    .unwrap_or("")
                    .chars()
                    .take(80)
                    .collect::<String>(),
                case["mode"],
                first_diff(&got, &case["output"], "")
            ));
        }
    }
    let summary = format!(
        "{} cases: {} compared in full, {} syntax errors (type only), {} oracle TypeErrors (no-panic only)",
        list.len(),
        checked,
        parse_skipped,
        throws_skipped
    );
    assert!(
        checked > 1500 && parse_skipped < 200 && throws_skipped < 20,
        "{}",
        summary
    );
    assert!(
        failures.is_empty(),
        "{}\n{} mismatched, first: {:#?}",
        summary,
        failures.len(),
        &failures[..failures.len().min(8)]
    );
}

#[test]
fn evaluate_key_order_matches_oracle() {
    let list = cases()["evaluate"].as_array().expect("evaluate cases");
    let mut bad = Vec::new();
    for case in list {
        if case["output"]["$throws"].is_string() {
            continue;
        }
        let got = run_evaluate(case);
        if got == case["output"] && !is_parse_error(&got) {
            let d = first_order_diff(&got, &case["output"], "");
            if !d.is_empty() {
                bad.push(d);
            }
        }
    }
    bad.sort();
    bad.dedup();
    assert!(
        bad.is_empty(),
        "key order differs, distinct paths: {:#?}",
        &bad[..bad.len().min(12)]
    );
}

fn expect_result(
    label: &str,
    got: Result<Value, PlannerSyntaxError>,
    expected: &Value,
) -> Option<String> {
    match got {
        Ok(v) => {
            if expected["$throws"].is_string() {
                return Some(format!("{}: expected a throw, got {}", label, v));
            }
            if &v != expected {
                return Some(format!("{}: {}", label, first_diff(&v, expected, "")));
            }
            None
        }
        Err(e) => {
            if !expected["$throws"].is_string() {
                return Some(format!("{}: unexpected error {}", label, e.message));
            }
            let got = to_json(&e);
            let mut want = expected.clone();
            if let Value::Object(m) = &mut want {
                m.remove("$throws");
            }
            if let Value::Object(m) = &mut want {
                // the oracle record carries the same fields
                m.retain(|_, _| true);
            }
            let mut g = got;
            if let Value::Object(m) = &mut g {
                m.remove("$error");
            }
            if g != want {
                return Some(format!("{}: error {}", label, first_diff(&g, &want, "")));
            }
            None
        }
    }
}

#[test]
fn methods_match_oracle() {
    let list = cases()["methods"].as_array().expect("method cases");
    let mut failures = Vec::new();
    for case in list {
        let method = case["method"].as_str().unwrap_or("");
        let script = case["script"].as_str().unwrap_or("");
        let expected = &case["output"];
        let label = format!(
            "{} {:?}",
            method,
            script.chars().take(50).collect::<String>()
        );
        let s = settings(case["settings"].as_str().unwrap_or("lb"));
        let tree = planner_parse::parse(script);
        let ev =
            PlannerExerciseEvaluator::new(script, &s, PlannerExerciseEvaluatorMode::PerDay, None);
        let got: Result<Value, PlannerSyntaxError> = match method {
            "topLineMap" => ev.top_line_map(&tree).map(|v| to_json(&v)),
            "hasWeightInUnit" => {
                let unit = if case["unit"] == "kg" {
                    IUnit::Kg
                } else {
                    IUnit::Lb
                };
                Ok(Value::Bool(ev.has_weight_in_unit(&tree, unit)))
            }
            "switchWeightsToUnit" => ev
                .switch_weights_to_unit(&tree, &s)
                .map(Value::String)
                .map_err(PlannerSyntaxError::from),
            "changeExerciseName" => Ok(Value::String(ev.change_exercise_name(
                &tree,
                case["from"].as_str().unwrap_or(""),
                case["to"].as_str().unwrap_or(""),
            ))),
            "applyChangesToScript" => {
                let ranges: Vec<(usize, usize, String)> = case["ranges"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .map(|r| {
                                (
                                    r[0].as_u64().unwrap_or(0) as usize,
                                    r[1].as_u64().unwrap_or(0) as usize,
                                    r[2].as_str().unwrap_or("").to_string(),
                                )
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                Ok(Value::String(
                    PlannerExerciseEvaluator::apply_changes_to_script(script, &ranges),
                ))
            }
            "changeWeightsToCompletedWeights" => Ok(Value::String(
                PlannerExerciseEvaluator::change_weights_to_completed_weights(script),
            )),
            other => panic!("unknown method {}", other),
        };
        if let Some(f) = expect_result(&label, got, expected) {
            failures.push(f);
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} mismatched, first: {:#?}",
        failures.len(),
        list.len(),
        &failures[..failures.len().min(8)]
    );
}

fn string_list(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .map(|s| s.as_str().unwrap_or("").to_string())
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn state_vars_match_oracle() {
    for case in cases()["stateVars"].as_array().expect("state cases") {
        let args = string_list(&case["args"]);
        let label = format!("{:?}", args);
        // throwing callback
        let mut throwing = |m: &str, v: &str| -> Result<(), (String, String)> {
            Err((m.to_string(), v.to_string()))
        };
        match planner_state_vars::from_args(&args, &mut throwing) {
            Ok((state, meta)) => {
                assert_eq!(case["collectingThrows"], false, "{}", label);
                let got =
                    serde_json::json!({"state": to_json(&state), "stateMetadata": to_json(&meta)});
                assert_eq!(got, case["output"], "{}", label);
            }
            Err((m, v)) => {
                assert_eq!(case["collectingThrows"], true, "{}", label);
                assert_eq!(serde_json::json!([m, v]), case["firstError"], "{}", label);
            }
        }
        // collecting callback
        let mut all: Vec<Vec<String>> = Vec::new();
        let mut collect = |m: &str, v: &str| -> Result<(), ()> {
            all.push(vec![m.to_string(), v.to_string()]);
            Ok(())
        };
        let (state, meta) =
            planner_state_vars::from_args(&args, &mut collect).expect("collecting never fails");
        let got = serde_json::json!({"state": to_json(&state), "stateMetadata": to_json(&meta)});
        assert_eq!(got, case["collected"], "{}", label);
        assert_eq!(to_json(&all), case["allErrors"], "{}", label);
    }
}

#[test]
fn build_progress_matches_oracle() {
    let list = cases()["buildProgress"].as_array().expect("progress cases");
    for case in list {
        let kind: IProgramExerciseProgressType =
            serde_json::from_value(case["type"].clone()).expect("type");
        let args = string_list(&case["args"]);
        let opts = BuildProgressOpts {
            script: case["opts"]["script"].as_str().map(|s| s.to_string()),
            reuse_fullname: case["opts"]["reuseFullname"]
                .as_str()
                .map(|s| s.to_string()),
        };
        let got = match build_progress(kind, &args, opts) {
            Ok(p) => serde_json::json!({"success": true, "data": to_json(&p)}),
            Err(e) => serde_json::json!({
                "success": false,
                "error": {"message": e.message, "details": to_json(&e.details)}
            }),
        };
        assert_eq!(got, case["output"], "{} {:?}", case["type"], case["args"]);
    }
    assert!(list.len() > 100);
}

#[test]
fn name_parts_and_keys_match_oracle() {
    for case in cases()["names"].as_array().expect("name cases") {
        let s = settings(case["settings"].as_str().unwrap_or("lb"));
        let input = case["str"].as_str().unwrap_or("");
        let parts = extract_name_parts(input, &s.exercises);
        let mut m = serde_json::Map::new();
        m.insert("name".to_string(), Value::String(parts.name));
        if let Some(l) = parts.label {
            m.insert("label".to_string(), Value::String(l));
        }
        if let Some(e) = parts.equipment {
            m.insert("equipment".to_string(), Value::String(e));
        }
        assert_eq!(Value::Object(m), case["parts"], "parts {:?}", input);
        assert_eq!(
            Value::String(planner_key_from_full_name(input, &s.exercises)),
            case["key"],
            "key {:?}",
            input
        );
    }
}

// ---- hand-written error checks (messages and ranges checked against the oracle above too)

fn eval_err(script: &str, mode: PlannerExerciseEvaluatorMode) -> PlannerSyntaxError {
    let s = settings("lb");
    let tree = planner_parse::parse(script);
    let mut ev = PlannerExerciseEvaluator::new(script, &s, mode, None);
    let mut u = uid;
    match ev.evaluate(&tree, &mut u) {
        IEither::Failure(e) => e,
        IEither::Success(_) => panic!("expected an error for {:?}", script),
    }
}

#[test]
fn error_messages_and_ranges() {
    use PlannerExerciseEvaluatorMode::*;
    let e = eval_err("Squat / 3x5 (waytoolong1)", PerDay);
    assert_eq!(e.message, "Label length should be 8 chars max (1:12)");
    assert_eq!((e.line, e.offset, e.from, e.to), (1, 12, 12, 25));
    assert!(matches!(
        e.details.kind,
        IErrorKind::LabelTooLong { max: 8 }
    ));

    let e = eval_err("Squat / 3x5\nBench Press / unknownprop: 1", PerDay);
    assert_eq!(
        e.message,
        "There's no such property exists - 'unknownprop' (2:14)"
    );
    assert_eq!(e.line, 2);

    let e = eval_err("Squat / progress: nope(1)", PerDay);
    assert!(e
        .message
        .starts_with("There's no such progression exists - 'nope'"));

    let e = eval_err("Squat / progress: lp(1lb, 2, 3, 4lb, 5, 6, 7)", PerDay);
    assert!(e
        .message
        .starts_with("Linear Progression 'lp' only has 6 arguments max"));
    assert!(matches!(
        &e.details.kind,
        IErrorKind::ProgressionArity { max: 6, .. }
    ));

    let e = eval_err("Squat / progress: lp(5)", PerDay);
    assert!(e
        .message
        .starts_with("1st argument of 'lp' should be weight"));

    let e = eval_err("Squat / progress: custom(a: 1)", PerDay);
    assert!(e
        .message
        .starts_with("'custom' progression requires either"));

    let e = eval_err(
        "Squat / progress: custom(a: 1, 5) {~ weights += 1lb ~}",
        PerDay,
    );
    assert!(e.message.starts_with("Invalid argument 5"));
    assert!(matches!(&e.details.kind, IErrorKind::InvalidStateVariable { value } if value == "5"));

    let e = eval_err("Squat / update: custom(a: 1) {~ state.a = 1 ~}", PerDay);
    assert!(e
        .message
        .starts_with("State variables for the update script are taken from \"progress\" block"));

    let e = eval_err("Squat / update: nope() {~ ~}", PerDay);
    assert!(e
        .message
        .starts_with("There's no such update progression exists - 'nope'"));

    let e = eval_err("Squat / id: nope(1)", PerDay);
    assert!(e.message.starts_with("There's no such id type - 'nope'"));

    let e = eval_err("Squat / id: tags()", PerDay);
    assert!(e
        .message
        .starts_with("You should provide the list of numbers in \"tags\""));

    let e = eval_err("# Week 1\nSquat / 3x5", PerDay);
    assert!(e
        .message
        .starts_with("You cannot specify weeks in the per-day exercise lists."));

    let e = eval_err("## Day 1\nSquat / 3x5", PerDay);
    assert!(e
        .message
        .starts_with("You cannot specify days in the per-day exercise lists."));

    let e = eval_err("## Day 1\nSquat / 3x5", Full);
    assert!(e
        .message
        .starts_with("You need to specify a week before a day"));

    let e = eval_err("Squat / 3x5", Full);
    assert!(e
        .message
        .starts_with("You should first define a week and a day before listing exercises."));
}

#[test]
fn full_mode_day_data_is_one_ahead_like_the_oracle() {
    let s = settings("lb");
    let script = "# Week 1\n## Day 1\nSquat / 3x5\n## Day 2\nBench Press / 3x5\n# Week 2\n## Day 1\nSquat / 3x5";
    let tree = planner_parse::parse(script);
    let mut ev =
        PlannerExerciseEvaluator::new(script, &s, PlannerExerciseEvaluatorMode::Full, None);
    let mut u = uid;
    let IEither::Success(weeks) = ev.evaluate(&tree, &mut u) else {
        panic!("should evaluate")
    };
    let dd: Vec<(i64, i64, i64)> = weeks
        .iter()
        .flat_map(|w| {
            w.days.iter().flat_map(|d| {
                d.exercises
                    .iter()
                    .map(|e| (e.day_data.week, e.day_data.day, e.day_data.day_in_week))
            })
        })
        .collect();
    assert_eq!(dd, vec![(2, 2, 1), (2, 3, 2), (3, 4, 1)]);
}

#[test]
fn line_and_offset_edges() {
    assert_eq!(get_line_and_offset_at("ab\ncd", 0), (1, 0));
    assert_eq!(get_line_and_offset_at("ab\ncd", 2), (1, 2));
    assert_eq!(get_line_and_offset_at("ab\ncd", 3), (2, 0));
    assert_eq!(get_line_and_offset_at("ab\ncd", 5), (2, 2));
    // past the end: [lineCount, lastLineLength + 1]
    assert_eq!(get_line_and_offset_at("ab\ncd", 9), (2, 3));
    assert_eq!(get_line_and_offset_at("", 0), (1, 0));
    assert_eq!(get_line_and_offset_at("a\n", 2), (2, 0));
    // UTF-16 units
    assert_eq!(get_line_and_offset_at("\u{1F642}x\ny", 3), (1, 3));
    assert_eq!(get_line_and_offset_at("\u{1F642}x\ny", 4), (2, 0));
}

#[test]
fn never_panics_on_odd_input() {
    use PlannerExerciseEvaluatorMode::*;
    let s = settings("lb");
    for script in [
        "",
        "{",
        "/",
        "///",
        "[",
        "Squat[",
        "Squat / (",
        "# \n## \n",
        "\u{1F642}",
        "Squat / 3x5 @",
        "Squat / ...",
        "Squat / warmup:",
    ] {
        for mode in [PerDay, Full, OnSet] {
            let tree = planner_parse::parse(script);
            let mut ev = PlannerExerciseEvaluator::new(script, &s, mode, None);
            let mut u = uid;
            let _ = ev.evaluate(&tree, &mut u);
            let _ = ev.top_line_map(&tree);
            let _ = ev.has_weight_in_unit(&tree, IUnit::Kg);
        }
    }
}

fn first_exercise(script: &str) -> IPlannerProgramExercise {
    let s = settings("lb");
    let tree = planner_parse::parse(script);
    let mut ev =
        PlannerExerciseEvaluator::new(script, &s, PlannerExerciseEvaluatorMode::PerDay, None);
    let mut u = uid;
    let IEither::Success(weeks) = ev.evaluate(&tree, &mut u) else {
        panic!("should evaluate {:?}", script)
    };
    weeks[0].days[0].exercises[0].clone()
}

#[test]
fn progress_and_update_equality() {
    let a = first_exercise("Squat / 3x5 / progress: custom(inc: 5lb) {~ weights += state.inc ~}");
    let b =
        first_exercise("Bench Press / 3x5 / progress: custom(inc: 5lb) {~ weights += state.inc ~}");
    let c = first_exercise("Squat / 3x5 / progress: custom(inc: 10lb) {~ weights += state.inc ~}");
    let (pa, pb, pc) = (
        a.progress.as_ref().expect("a"),
        b.progress.as_ref().expect("b"),
        c.progress.as_ref().expect("c"),
    );
    assert!(PlannerExerciseEvaluator::is_equal_progress(pa, pb));
    assert!(!PlannerExerciseEvaluator::is_equal_progress(pa, pc));
    let u1 = first_exercise("Squat / 3x5 / update: custom() {~ state.n = 1 ~}");
    let u2 = first_exercise("Squat / 3x5 / update: custom() {~ state.n = 2 ~}");
    let (x, y) = (
        u1.update.as_ref().expect("u1"),
        u2.update.as_ref().expect("u2"),
    );
    assert!(PlannerExerciseEvaluator::is_equal_update(x, x));
    assert!(!PlannerExerciseEvaluator::is_equal_update(x, y));
    // meta.stateKeys is filled from the script
    let keys: Vec<&String> = x
        .meta
        .as_ref()
        .and_then(|m| m.state_keys.as_ref())
        .expect("keys")
        .iter()
        .collect();
    assert_eq!(keys, vec!["n"]);
}

#[test]
fn property_equality_joins_args_with_commas() {
    let p = |args: &[&str]| IPlannerProgramProperty {
        name: "progress".to_string(),
        fn_name: "lp".to_string(),
        fn_args: args.iter().map(|s| s.to_string()).collect(),
        script: None,
        body: None,
        reuse: None,
        liftoscript_node: None,
        exercise_type: None,
        exercise_label: None,
        exercise_key: None,
        label: None,
        meta: None,
    };
    assert!(PlannerExerciseEvaluator::is_equal_property(
        &p(&["a", "b"]),
        &p(&["a", "b"])
    ));
    // "a,b" as one arg joins to the same string as two args, as in the TS
    assert!(PlannerExerciseEvaluator::is_equal_property(
        &p(&["a,b"]),
        &p(&["a", "b"])
    ));
    assert!(!PlannerExerciseEvaluator::is_equal_property(
        &p(&["a"]),
        &p(&["b"])
    ));
}

#[test]
fn quirks_are_preserved() {
    // maxrep keeps its "+" in the TS (the replace result is discarded) but parseInt stops there
    let e = first_exercise("Squat / 3x5+");
    let rr = e.set_variations[0].sets[0]
        .rep_range
        .clone()
        .expect("range");
    assert_eq!(
        (
            rr.number_of_sets,
            rr.maxrep,
            rr.is_amrap,
            rr.is_quick_add_set
        ),
        (3.0, Some(5.0), true, false)
    );
    // a 0% warmup falls through to the weight branch
    let e = first_exercise("Squat / 3x5 / warmup: 1x5 0%");
    let w = &e.warmup_sets.as_ref().expect("warmups")[0];
    assert_eq!((w.percentage, w.weight), (None, None));
    // any global set makes askWeight a defined false
    let e = first_exercise("Squat / 100lb / 3x5");
    assert_eq!(e.globals.ask_weight, Some(false));
}

/// `stage_planner` of every built-in program in the golden files is the output of
/// `PlannerProgram_evaluateText`, i.e. of `PlannerExerciseEvaluatorText`.
#[test]
fn evaluate_text_matches_builtin_goldens() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/golden/liftoscript/builtins");
    let mut checked = 0;
    let mut order_mismatch = Vec::new();
    for entry in std::fs::read_dir(&dir).expect("builtins dir") {
        let path = entry.expect("entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let file: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).expect("read")).expect("json");
        let Some(case) = file["cases"]
            .as_array()
            .and_then(|c| c.iter().find(|c| c["name"] == "stage_planner"))
        else {
            continue;
        };
        let text = case["inputs"]["text"].as_str().expect("text");
        let got = to_json(&planner_program_evaluate_text(text));
        assert_eq!(got, case["output"], "{}", path.display());
        if serde_json::to_string(&got).ok() != serde_json::to_string(&case["output"]).ok() {
            order_mismatch.push(path.display().to_string());
        }
        checked += 1;
    }
    assert_eq!(checked, 60);
    assert!(
        order_mismatch.is_empty(),
        "key order differs for {:?}",
        order_mismatch
    );
}

#[test]
fn evaluate_text_edge_cases() {
    let w = planner_program_evaluate_text("");
    assert_eq!(w.len(), 1);
    assert_eq!(w[0].days[0].name, "Day 1");
    // a day before any week, and exercises before any day, do not panic
    let _ = planner_program_evaluate_text("## Day\nSquat / 3x5\n# Week\n");
    let w = planner_program_evaluate_text(
        "// week note\n# W1\n// day note\n## D1\nSquat / 3x5\n/// triple\n\n## D2\nBench / 3x5",
    );
    assert_eq!(w[0].description.as_deref(), Some("week note"));
    assert_eq!(w[0].days[0].description.as_deref(), Some("day note"));
}
