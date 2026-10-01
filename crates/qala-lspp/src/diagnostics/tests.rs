use super::*;

fn first(text: &str) -> Diagnostic {
    let d = planner_diagnostics(text);
    assert!(!d.is_empty(), "no diagnostics for {text:?}");
    d.into_iter().next().unwrap()
}

#[test]
fn clean_text_has_no_diagnostics() {
    assert!(planner_diagnostics("# Week 1\n## Day 1\nSquat / 3x5 100lb\n").is_empty());
    assert!(script_diagnostics("if (completedReps >= reps) { weights += 5lb }").is_empty());
}

#[test]
fn keeps_the_original_fields() {
    let d = first("Squat / 3x");
    assert_eq!((d.from, d.to), (9, 10));
    assert!(d.message.starts_with("Syntax error"));
}

#[test]
fn missing_rep_count() {
    let d = first("Squat / 3x");
    assert_eq!((d.line, d.col), (1, 10));
    assert_eq!(d.suggestion.as_deref(), Some("put a rep count after the x, for example 3x5"));
}

#[test]
fn doubled_x() {
    let d = first("# Week 1\n## Day 1\nSquat / 3x5 100lb\nBench / 3xx5");
    assert_eq!(d.line, 4);
    assert!(d.suggestion.unwrap().starts_with("remove the extra x"));
}

#[test]
fn unknown_unit() {
    let d = first("Squat / 3x5 100kgs");
    assert_eq!(d.line, 1);
    assert_eq!(d.suggestion.as_deref(), Some("weights end in lb or kg, for example 100lb or 100kg"));
}

#[test]
fn unclosed_script() {
    let d = planner_diagnostics("Squat / 3x5 / progress: custom() {~ if (1 ").pop().unwrap();
    assert_eq!(d.suggestion.as_deref(), Some("close the script with ~} on its own line"));
}

#[test]
fn unclosed_paren_in_call() {
    let d = first("Squat / 3x5 / progress: lp(1lb");
    assert_eq!(d.suggestion.as_deref(), Some("add the missing closing )"));
}

#[test]
fn line_and_col_are_one_based_utf16_on_later_lines() {
    // The emoji is one UTF-16 pair (2 units), so columns count it as 2.
    let text = "# Week 1\n\u{1F3CB} Squat / 3x";
    let d = first(text);
    assert_eq!(d.line, 2);
    let units: Vec<u16> = text.encode_utf16().collect();
    assert_eq!(d.from, units.len() - 1);
    // line 2 starts at offset 9
    assert_eq!(d.col, d.from - 9 + 1);
    assert_eq!((d.end_line, d.end_col), (2, d.col + 1));
}

#[test]
fn fuzz_inputs_never_panic_and_stay_in_range() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../testdata/golden/liftoscript/lezer_trees");
    for (file, planner) in [("planner_fuzz.json", true), ("scripts_fuzz.json", false)] {
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join(file)).unwrap()).unwrap();
        let cases = v.as_array().unwrap();
        assert!(cases.len() >= 400);
        for c in cases {
            let t = c["input"].as_str().unwrap();
            let n = t.encode_utf16().count();
            let ds = if planner { planner_diagnostics(t) } else { script_diagnostics(t) };
            for d in ds {
                assert!(d.from <= d.to && d.to <= n, "{file} {t:?} {d:?}");
                assert!(d.line >= 1 && d.col >= 1 && d.end_line >= d.line);
            }
        }
    }
}

#[test]
fn line_col_helper() {
    let u: Vec<u16> = "ab\ncd\n".encode_utf16().collect();
    assert_eq!(line_col(&u, 0), (1, 1));
    assert_eq!(line_col(&u, 2), (1, 3));
    assert_eq!(line_col(&u, 3), (2, 1));
    assert_eq!(line_col(&u, 99), (3, 1));
}

#[test]
fn script_operator_without_value() {
    let d = script_diagnostics("if (completedReps >= ) { weights += }");
    assert!(!d.is_empty());
    assert!(d.iter().all(|x| x.line == 1));
    assert_eq!(d[0].suggestion.as_deref(), Some("the operator needs a value on its right, for example weights += 5lb"));
}

#[test]
fn every_diagnostic_is_in_range_for_garbage() {
    for t in ["", "((((", "\u{1F3CB}\u{FE0F} / 3x5", "Squat / 3x5 / progress: custom() { if } ", "{~", "~}\n\n/"] {
        let n = t.encode_utf16().count();
        for d in planner_diagnostics(t).into_iter().chain(script_diagnostics(t)) {
            assert!(d.from <= d.to && d.to <= n, "{t:?} {d:?}");
            assert!(d.line >= 1 && d.col >= 1);
        }
    }
}
