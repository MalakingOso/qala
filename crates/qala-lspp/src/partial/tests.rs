use super::*;
use crate::runtime;
use crate::types::ISettings;
use crate::util::generator::SequentialUid;

fn settings() -> ISettings {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/golden/liftoscript/finish_day_rotation_gzclp.json");
    let doc: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
    serde_json::from_value(doc["fixtures"]["settings"]["gzclp_settings"].clone()).unwrap()
}

fn program(text: &str) -> IEvaluatedProgram {
    let mut uid = SequentialUid::new();
    runtime::force_evaluate_text(text, "t", &settings(), &mut uid)
}

#[test]
fn question_mark_plus_is_blank_and_not_an_error() {
    let p = program("# Week 1\n## Day 1\nSplit Squat / 3x8 ?+\nBench Press / 3x5 100lb\n");
    assert!(p.errors.is_empty(), "{:?}", p.errors);
    let u = unresolved_sets(&p);
    assert_eq!(u.len(), 3);
    for (i, s) in u.iter().enumerate() {
        assert_eq!(s.state, PartialState::Blank);
        assert_eq!((s.week, s.day_in_week, s.day, s.set_index, s.line), (1, 1, 1, i, 1));
        assert_eq!(s.exercise_name, "Split Squat");
        assert!(s.weight.is_none());
        assert_eq!(s.reps, Some(8.0));
    }
}

#[test]
fn a_starting_weight_with_a_plus_is_seeded() {
    let u = unresolved_sets(&program("# Week 1\n## Day 1\nSplit Squat / 2x8 0lb+\n"));
    assert_eq!(u.len(), 2);
    assert!(u.iter().all(|s| s.state == PartialState::Seeded && s.weight.is_some()));
}

#[test]
fn bodyweight_and_fixed_weights_are_not_partial() {
    assert!(unresolved_sets(&program("# Week 1\n## Day 1\nChin Up / 3x8\nSquat / 3x5 100lb\n")).is_empty());
}

#[test]
fn every_week_an_exercise_covers_is_listed() {
    let u = unresolved_sets(&program("# Week 1\n## Day 1\nSplit Squat[1-2] / 1x8 ?+\n# Week 2\n## Day 1\n"));
    assert_eq!(u.iter().map(|s| (s.week, s.day)).collect::<Vec<_>>(), vec![(1, 1), (2, 2)]);
}

#[test]
fn one_set_of_several_can_be_blank() {
    let u = unresolved_sets(&program("# Week 1\n## Day 1\nSplit Squat / 1x8 50lb, 2x8 ?+\n"));
    assert_eq!(u.iter().map(|s| s.set_index).collect::<Vec<_>>(), vec![1, 2]);
}
