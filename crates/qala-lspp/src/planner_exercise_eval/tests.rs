use serde::Serialize;
use serde_json::Value;

use super::*;
use crate::planner_parse;

fn settings(id: &str) -> ISettings {
    crate::types::tests::settings_named(id)
}

/// Serialize then parse again, so integers and floats land in the same JSON number
/// variants as the expected values read from the golden files.
fn to_json<T: Serialize>(v: &T) -> Value {
    serde_json::from_str(&serde_json::to_string(v).expect("serialize")).expect("reparse")
}

fn uid(_: usize) -> String {
    "<uid>".to_string()
}

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
        .join("../../testdata/golden/lspp/builtins");
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
