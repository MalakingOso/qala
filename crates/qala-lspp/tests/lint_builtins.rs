//! The built-in programs are presumed correct, so every lint rule should stay silent on
//! them. A hit here usually means the rule is wrong, not the program. Exceptions are listed
//! in `KNOWN` with the reason.

mod common;

use common::programs;
use qala_lspp::lint::lint_planner;

/// (file, code, count, reason). Both hits are real: arnoldgoldensix declares
/// `custom(weight: 0lb, reps: 1)` on Chin Up, but its script assigns the plain `reps` array
/// (`reps = completedReps[ns] + 1`), so state.weight and state.reps are never used.
const KNOWN: &[(&str, &str, usize)] = &[("builtins/arnoldgoldensix.json", "unused-state", 2)];

#[test]
fn builtins_lint_clean_apart_from_known_hits() {
    let progs = programs();
    assert!(progs.len() >= 60);
    let mut unexpected = vec![];
    let mut seen: Vec<(String, &str, usize)> = vec![];
    for p in &progs {
        for l in lint_planner(&p.text) {
            match seen.iter_mut().find(|s| s.0 == p.file && s.1 == l.code) {
                Some(s) => s.2 += 1,
                None => seen.push((p.file.clone(), l.code, 1)),
            }
            if !KNOWN.iter().any(|k| k.0 == p.file && k.1 == l.code) {
                unexpected.push(format!("{}:{}:{} {} {}", p.file, l.line, l.col, l.code, l.message));
            }
        }
    }
    assert!(unexpected.is_empty(), "{} unexpected lint hits on built-ins:\n{}", unexpected.len(), unexpected.join("\n"));
    for (file, code, count) in KNOWN {
        let got = seen.iter().find(|s| s.0 == *file && s.1 == *code).map(|s| s.2).unwrap_or(0);
        assert_eq!(got, *count, "{file} {code}");
    }
}
