use super::*;

fn fmt(t: &str) -> String {
    format_planner(t).unwrap_or_else(|e| panic!("{e}"))
}

#[test]
fn canonical_text_is_unchanged() {
    let t = "# Week 1\n## Day 1\nSquat / 3x5 100lb / progress: lp(5lb)\nBench / 2x5, 1x5+ 60kg\n";
    assert_eq!(fmt(t), t);
}

#[test]
fn spacing_around_separators_and_commas() {
    assert_eq!(fmt("Squat/3x5   100lb  /\tprogress: lp(5lb)"), "Squat / 3x5 100lb / progress: lp(5lb)\n");
    assert_eq!(fmt("Squat / 2x5 ,1x5+"), "Squat / 2x5, 1x5+\n");
    assert_eq!(fmt("Squat / progress: custom(a: 1lb ,b: 2lb) {~ x ~}"), "Squat / progress: custom(a: 1lb, b: 2lb) {~ x ~}\n");
}

#[test]
fn blank_lines_are_kept_but_trailing_space_and_crlf_go() {
    assert_eq!(
        fmt("\n\n# Week 1  \r\n \n\n\n## Day 1\r\nSquat / 3x5   \n\n\n"),
        "\n\n# Week 1\n\n\n\n## Day 1\nSquat / 3x5\n\n\n"
    );
}

#[test]
fn script_bodies_and_comments_are_verbatim() {
    let t = "// keep   this\nSquat / 3x5 / progress: custom(i: 1lb) {~\n  if (x)   {\n\ty  \n  }\n~}\n";
    assert_eq!(fmt(t), t);
}

#[test]
fn continuation_lines_get_two_spaces() {
    assert_eq!(fmt("main / used: none / 2x5 \\\n      / progress: lp(5lb)\n"), "main / used: none / 2x5 \\\n  / progress: lp(5lb)\n");
}

#[test]
fn names_and_labels_keep_inner_spacing() {
    assert_eq!(fmt("Bench  Press / 3x5 (5RM  Test)"), "Bench  Press / 3x5 (5RM  Test)\n");
}

#[test]
fn syntax_errors_are_refused_with_diagnostics() {
    match format_planner("Squat / 3x") {
        Err(FormatError::Syntax(d)) => assert!(!d.is_empty() && d[0].suggestion.is_some()),
        other => panic!("{other:?}"),
    }
}

#[test]
fn empty_and_whitespace_only() {
    assert_eq!(fmt(""), "");
    assert_eq!(fmt("  \n\n"), "\n\n");
}

#[test]
fn idempotent_on_fuzz_programs_that_parse() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../testdata/golden/liftoscript/lezer_trees");
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("planner_fuzz.json")).unwrap()).unwrap();
    let (mut ok, mut refused) = (0, 0);
    for c in v.as_array().unwrap() {
        let t = c["input"].as_str().unwrap();
        match format_planner(t) {
            Ok(f) => {
                assert_eq!(format_planner(&f).as_deref(), Ok(f.as_str()), "{t:?}");
                ok += 1;
            }
            Err(FormatError::Syntax(_)) => refused += 1,
            Err(e) => panic!("{t:?}: {e}"),
        }
    }
    assert!(ok > 0, "ok {ok} refused {refused}");
}
