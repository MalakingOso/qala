use super::*;
use crate::runtime;
use crate::util::generator::SequentialUid;
use serde_json::Value;

fn golden(name: &str) -> Value {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../testdata/golden/liftoscript").join(name);
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn evaluate(text: &str) -> (IEvaluatedProgram, ISettings) {
    let doc = golden("finish_day_rotation_gzclp.json");
    let settings: ISettings = serde_json::from_value(doc["fixtures"]["settings"]["gzclp_settings"].clone()).unwrap();
    let mut uid = SequentialUid::new();
    (runtime::force_evaluate_text(text, "t", &settings, &mut uid), settings)
}

/// Over the gzclp rotation golden (8 all-hit sessions), the dry run prescribes exactly the sets
/// the golden fed in, and ends on the golden's final planner text.
#[test]
fn matches_the_rotation_golden() {
    let doc = golden("finish_day_rotation_gzclp.json");
    let program: IEvaluatedProgram = serde_json::from_value(doc["fixtures"]["programs"]["gzclp"].clone()).unwrap();
    let settings: ISettings = serde_json::from_value(doc["fixtures"]["settings"]["gzclp_settings"].clone()).unwrap();
    let cases = doc["cases"].as_array().unwrap();

    let before = serde_json::to_string(&program).unwrap();
    let mut uid = SequentialUid::new();
    let opts = DryRunOpts { from_day: Some(1), sessions: Some(cases.len()), through_week: None };
    let res = dry_run(&program, &settings, &opts, &mut uid).unwrap();
    assert_eq!(serde_json::to_string(&program).unwrap(), before, "dry run changed its input");

    assert_eq!(res.sessions.len(), cases.len());
    for (k, (s, case)) in res.sessions.iter().zip(cases).enumerate() {
        assert_eq!(s.day, case["inputs"]["day"].as_i64().unwrap(), "session {k} day");
        assert!(s.errors.is_empty(), "session {k}: {:?}", s.errors);
        let entries = case["inputs"]["entries"].as_array().unwrap();
        assert_eq!(s.exercises.len(), entries.len(), "session {k} exercise count");
        for (ex, entry) in s.exercises.iter().zip(entries) {
            assert_eq!(Some(ex.key.as_str()), entry["programExerciseId"].as_str(), "session {k}");
            let sets = entry["sets"].as_array().unwrap();
            assert_eq!(ex.sets.len(), sets.len(), "session {k} {} set count", ex.key);
            for (a, b) in ex.sets.iter().zip(sets) {
                assert_eq!(a.reps, b["reps"].as_f64(), "session {k} {} reps", ex.key);
                assert_eq!(serde_json::to_value(a.weight).unwrap(), b["weight"], "session {k} {} weight", ex.key);
            }
        }
    }
    let last = cases.last().unwrap();
    assert_eq!(res.final_text, last["output"]["plannerText"].as_str().unwrap());
}

#[test]
fn through_week_stops_at_the_week_boundary() {
    let (p, s) = evaluate("# Week 1\n## Day 1\nSquat / 3x5 100lb\n## Day 2\nBench Press / 3x5 60lb\n# Week 2\n## Day 1\nSquat / 3x5 105lb\n");
    let mut uid = SequentialUid::new();
    let r = dry_run(&p, &s, &DryRunOpts { through_week: Some(1), ..Default::default() }, &mut uid).unwrap();
    assert_eq!(r.sessions.iter().map(|x| (x.week, x.day_in_week)).collect::<Vec<_>>(), vec![(1, 1), (1, 2)]);
    let mut uid = SequentialUid::new();
    let r = dry_run(&p, &s, &DryRunOpts { through_week: Some(2), ..Default::default() }, &mut uid).unwrap();
    // The program has 3 days, so a bounded run still covers week 2 and then wraps.
    assert!(r.sessions.len() >= 3);
    assert_eq!(r.sessions[2].exercises[0].sets[0].weight.unwrap().value, 105.0);
}

#[test]
fn a_progression_shows_up_in_the_next_session() {
    let (p, s) = evaluate("# Week 1\n## Day 1\nSquat / 3x5 100lb / progress: lp(5lb)\n");
    let mut uid = SequentialUid::new();
    let r = dry_run(&p, &s, &DryRunOpts { sessions: Some(3), ..Default::default() }, &mut uid).unwrap();
    let w: Vec<f64> = r.sessions.iter().map(|x| x.exercises[0].sets[0].weight.unwrap().value).collect();
    assert_eq!(w, vec![100.0, 105.0, 110.0]);
    assert!(r.final_text.contains("115lb"), "{}", r.final_text);
}

#[test]
fn blank_weights_stay_blank() {
    let (p, s) = evaluate("# Week 1\n## Day 1\nSplit Squat / 3x8 ?+\nBench Press / 3x5 100lb\n");
    let before = serde_json::to_string(&p).unwrap();
    let mut uid = SequentialUid::new();
    let r = dry_run(&p, &s, &DryRunOpts { sessions: Some(1), ..Default::default() }, &mut uid).unwrap();
    assert_eq!(serde_json::to_string(&p).unwrap(), before);
    let sq = &r.sessions[0].exercises[0];
    assert!(sq.sets.iter().all(|x| x.blank && x.weight.is_none() && x.ask_weight));
    assert_eq!(r.blank_sets, 3);
    assert!(r.sessions[0].exercises[1].sets.iter().all(|x| !x.blank));
    assert!(!r.final_text.contains("Split Squat / 3x8 0lb"), "no weight was invented: {}", r.final_text);
}

#[test]
fn unknown_start_day_is_an_error() {
    let (p, s) = evaluate("# Week 1\n## Day 1\nSquat / 3x5 100lb\n");
    let mut uid = SequentialUid::new();
    let e = dry_run(&p, &s, &DryRunOpts { from_day: Some(9), ..Default::default() }, &mut uid).unwrap_err();
    assert!(e.0.contains("no day 9"));
}

#[test]
fn same_input_same_output() {
    let (p, s) = evaluate("# Week 1\n## Day 1\nSquat / 3x5 100lb / progress: lp(5lb)\n");
    let run = || {
        let mut uid = SequentialUid::new();
        serde_json::to_string(&dry_run(&p, &s, &DryRunOpts { sessions: Some(4), ..Default::default() }, &mut uid).unwrap()).unwrap()
    };
    assert_eq!(run(), run());
}
