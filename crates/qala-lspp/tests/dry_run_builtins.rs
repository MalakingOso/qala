//! Dry run over every built-in program: it must finish, leave its input untouched, and
//! produce at least one session.

mod common;

use common::programs;
use qala_lspp::dry_run::{dry_run, DryRunOpts};
use qala_lspp::runtime;
use qala_lspp::util::generator::SequentialUid;

/// Programs whose own progress script fails when run. The failure is in the built-in, not in
/// the dry run: gzcl-ggbb reads `state.successCounter`, which no `custom(...)` declares.
const KNOWN_BROKEN_SCRIPTS: &[&str] = &["builtins/gzcl-ggbb.json"];

#[test]
fn every_builtin_dry_runs_without_changing_its_input() {
    let progs = programs();
    assert!(progs.len() >= 60);
    let mut script_errors = vec![];
    let mut known_seen = 0;
    for p in &progs {
        let mut uid = SequentialUid::new();
        let program = runtime::force_evaluate_text(&p.text, &p.name, &p.settings, &mut uid);
        let before = serde_json::to_string(&program).unwrap();
        let opts = DryRunOpts { through_week: Some(1), ..Default::default() };
        let mut uid = SequentialUid::new();
        let res = dry_run(&program, &p.settings, &opts, &mut uid).unwrap_or_else(|e| panic!("{}: {e}", p.file));
        assert_eq!(serde_json::to_string(&program).unwrap(), before, "{}: input changed", p.file);
        assert!(!res.sessions.is_empty(), "{}: no sessions", p.file);
        for s in &res.sessions {
            for e in &s.errors {
                if KNOWN_BROKEN_SCRIPTS.contains(&p.file.as_str()) {
                    known_seen += 1;
                } else {
                    script_errors.push(format!("{} session {}: {e}", p.file, s.session));
                }
            }
        }
    }
    assert!(script_errors.is_empty(), "{} finish-day errors:\n{}", script_errors.len(), script_errors.join("\n"));
    assert!(known_seen > 0, "gzcl-ggbb no longer fails; drop it from KNOWN_BROKEN_SCRIPTS");
}
