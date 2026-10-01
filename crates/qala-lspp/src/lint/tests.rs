use super::*;

fn codes(text: &str) -> Vec<&'static str> {
    lint_planner(text).into_iter().map(|l| l.code).collect()
}

#[test]
fn clean_program_has_no_lints() {
    assert!(codes("# Week 1\n## Day 1\nSquat / 3x5 100lb\n").is_empty());
}

#[test]
fn syntax_errors_are_not_linted() {
    assert!(codes("Squat / 3x").is_empty());
}

#[test]
fn empty_days_and_weeks_are_fine() {
    // Header-only days are rest days, and `Bench[1-3]` covers later weeks.
    assert!(codes("# Week 1\n## Day 1\nSquat[1-2] / 3x5 100lb\n## Rest\n# Week 2\n## Day 1\n").is_empty());
}

#[test]
fn program_without_exercises() {
    assert_eq!(codes("// just a note\n"), vec!["empty-program"]);
    assert_eq!(codes("# Week 1\n## Day 1\n"), vec!["empty-program"]);
    assert!(codes("").is_empty());
    assert!(codes("\n\n").is_empty());
}

#[test]
fn too_many_sets_single_line_and_total() {
    let l = lint_planner("# Week 1\n## Day 1\nSquat / 31x5 100lb\n");
    assert_eq!(l.len(), 1);
    assert_eq!(l[0].code, "too-many-sets");
    assert_eq!(l[0].line, 3);
    assert_eq!(codes("# Week 1\n## Day 1\nSquat / 20x5, 11x3 100lb\n"), vec!["too-many-sets"]);
    assert!(codes("# Week 1\n## Day 1\nSquat / 30x5 100lb\n").is_empty());
}

#[test]
fn mixed_units_flags_the_minority() {
    let t = "# Week 1\n## Day 1\nSquat / 3x5 100lb\nBench / 3x5 80lb\nRow / 3x5 40kg\n";
    let l = lint_planner(t);
    assert_eq!(l.len(), 1);
    assert_eq!(l[0].code, "mixed-units");
    assert_eq!(&t[l[0].from..l[0].to], "40kg");
    assert_eq!(l[0].suggestion.as_deref(), Some("write it in lb (for example 40lb) so the program uses one unit"));
}

#[test]
fn a_single_unit_is_fine_whatever_the_settings() {
    assert!(codes("# Week 1\n## Day 1\nSquat / 3x5 100kg / progress: lp(5lb)\n").is_empty());
}

#[test]
fn unused_state() {
    let t = "# Week 1\n## Day 1\nSquat / 3x5 100lb / progress: custom(inc: 5lb, spare: 1) {~ weights += state.inc ~}\n";
    let l = lint_planner(t);
    assert_eq!(l.len(), 1);
    assert_eq!(l[0].code, "unused-state");
    assert!(l[0].message.contains("\"spare\""));
    assert_eq!(&t[l[0].from..l[0].to], "spare");
}

#[test]
fn state_read_by_the_update_script_counts() {
    let t = "Squat / 3x5 100lb / progress: custom(n: 1) {~ ~} / update: custom() {~ x = state.n ~}\n";
    assert!(codes(t).is_empty());
}

#[test]
fn assigning_state_counts_as_use() {
    let t = "Squat / 3x5 100lb / progress: custom(n: 1) {~ state.n = completedReps[1] ~}\n";
    assert!(codes(t).is_empty());
}

#[test]
fn state_prefix_is_not_a_match() {
    let t = "Squat / 3x5 100lb / progress: custom(inc: 5lb) {~ weights += state.increase ~}\n";
    assert_eq!(codes(t), vec!["unused-state"]);
}

#[test]
fn reused_scripts_are_skipped() {
    let t = "# Week 1\n## Day 1\nmain / 3x5 100lb / progress: custom(inc: 5lb) {~ weights += state.inc ~}\nSquat / ...main / progress: custom(inc: 10lb) { ...main }\n";
    assert!(codes(t).is_empty());
}

#[test]
fn unknown_weight_is_not_a_warning() {
    assert!(codes("# Week 1\n## Day 1\nSquat / 3x8 ?+\n").is_empty());
}
