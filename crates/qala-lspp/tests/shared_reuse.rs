//! Regression: sibling instances of a reusing exercise share one progress/update
//! reuse record in the TS, so resolving it on one reaches the others.
//! The TS oracle reports no errors and keeps all three days for both programs.

use std::fs;
use std::path::Path;

use qala_lspp::runtime;
use qala_lspp::types::ISettings;
use qala_lspp::util::generator::SequentialUid;

fn lb_settings() -> ISettings {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/golden/liftoscript/fuzz/programs_fuzz_01.json");
    let doc: serde_json::Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    serde_json::from_value(doc["fixtures"]["settings"]["lb"].clone()).unwrap()
}

fn check(text: &str) {
    let mut uid = SequentialUid::new();
    let p = runtime::force_evaluate_text(text, "t", &lb_settings(), &mut uid);
    assert!(
        p.errors.is_empty(),
        "unexpected errors: {:?}",
        p.errors
            .iter()
            .map(|e| &e.error.message)
            .collect::<Vec<_>>()
    );
    let days: Vec<usize> = p.weeks[0].days.iter().map(|d| d.exercises.len()).collect();
    assert_eq!(days, vec![1, 1, 1]);
}

#[test]
fn sibling_shares_progress_reuse() {
    check(
        "# Peak\n## Day 1\nheavy / used: none / 4x8 / progress: custom(increment: 2.5lb) {~\n  weights += state.increment\n~}\n## Day 2\nLunge / 2x4\n## Day 3\nLunge / ...heavy\n",
    );
}

#[test]
fn sibling_shares_update_reuse() {
    check(
        "# Peak\n## Day 1\nheavy / used: none / 4x8 / update: custom() {~\n  weights += 5lb\n~}\n## Day 2\nLunge / 2x4\n## Day 3\nLunge / ...heavy\n",
    );
}
