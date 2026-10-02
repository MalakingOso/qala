//! Golden replays for the adapter and the derived numbers: every case in
//! `testdata/golden/derived/*.json` goes through the JSON entry points of `derived_api`.
//!
//! The files are hand-worked (`oracle: "manual"`); each case's `reason` shows the arithmetic.
//! Format, as in `testdata/golden/engine/`:
//!
//! ```json
//! { "fn": "weight_trend", "version": 1, "oracle": "manual", "cases": [
//!   { "name": "...", "reason": "...", "input": { "v": 1, ... },
//!     "expected": ..., "tolerance": 1e-9 } ] }
//! ```
//!
//! `input` is the request object, `v` included; `expected` is the envelope's `result`. A case may
//! carry `expectedError` (`invalid_input`, `evaluation` or `internal`) instead of `expected`.
//! Floats compare as `|a - e| <= tolerance * max(|a|, |e|) + 1e-12`; everything else exactly,
//! object key order ignored. A file with `"match": "subset"` lists in `expected` only the object
//! keys that were worked by hand (every one must be present and equal; arrays still need the
//! same length).

use qala_core::api::ApiResult;
use qala_core::derived_api::{build_engine_state, readiness_summary, week_load, weight_trend};
use serde_json::{json, Value};
use std::collections::BTreeSet;

const DIR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/golden/derived/"
);

/// A JSON entry point under test.
type EntryPoint = fn(&str) -> ApiResult;

/// Every file in `testdata/golden/derived/` with the function it replays.
const FILES: [(&str, EntryPoint); 4] = [
    ("build_engine_state", build_engine_state),
    ("readiness_summary", readiness_summary),
    ("week_load", week_load),
    ("weight_trend", weight_trend),
];

fn numbers_match(a: f64, e: f64, tol: f64) -> bool {
    a == e || (a - e).abs() <= tol * a.abs().max(e.abs()) + 1e-12
}

fn compare(
    path: &str,
    expected: &Value,
    actual: &Value,
    tol: f64,
    subset: bool,
    errs: &mut Vec<String>,
) {
    match (expected, actual) {
        (Value::Number(e), Value::Number(a)) => {
            let (e, a) = (e.as_f64().expect("finite"), a.as_f64().expect("finite"));
            if !numbers_match(a, e, tol) {
                errs.push(format!("{path}: expected {e}, got {a}"));
            }
        }
        (Value::Object(e), Value::Object(a)) => {
            for (k, ev) in e {
                match a.get(k) {
                    Some(av) => compare(&format!("{path}.{k}"), ev, av, tol, subset, errs),
                    None => errs.push(format!("{path}.{k}: missing")),
                }
            }
            if !subset {
                for k in a.keys().filter(|k| !e.contains_key(*k)) {
                    errs.push(format!("{path}.{k}: unexpected key"));
                }
            }
        }
        (Value::Array(e), Value::Array(a)) => {
            if e.len() != a.len() {
                errs.push(format!(
                    "{path}: expected {} items, got {}",
                    e.len(),
                    a.len()
                ));
                return;
            }
            for (i, (ev, av)) in e.iter().zip(a).enumerate() {
                compare(&format!("{path}[{i}]"), ev, av, tol, subset, errs);
            }
        }
        (e, a) if e == a => {}
        (e, a) => errs.push(format!("{path}: expected {e}, got {a}")),
    }
}

fn load(file: &str) -> Value {
    let path = format!("{DIR}{file}.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {path}: {e}"));
    let doc: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path}: {e}"));
    assert_eq!(
        doc["fn"],
        json!(file),
        "{file}: fn must match the file name"
    );
    assert_eq!(doc["version"], json!(1), "{file}: version");
    assert_eq!(doc["oracle"], json!("manual"), "{file}: oracle");
    doc
}

fn replay(file: &str, f: EntryPoint) -> usize {
    let doc = load(file);
    let subset = match doc.get("match").and_then(Value::as_str) {
        None => false,
        Some("subset") => true,
        Some(other) => panic!("{file}: unknown match mode {other:?}"),
    };
    let cases = doc["cases"]
        .as_array()
        .unwrap_or_else(|| panic!("{file}: no cases"));
    assert!(!cases.is_empty(), "{file}: no cases");
    let mut names = BTreeSet::new();
    let mut errs = Vec::new();
    for c in cases {
        let name = c["name"]
            .as_str()
            .unwrap_or_else(|| panic!("{file}: case without a name"));
        assert!(
            names.insert(name.to_string()),
            "{file}: duplicate case name {name:?}"
        );
        assert!(
            c["reason"].as_str().is_some_and(|r| !r.is_empty()),
            "{file}: {name:?} has no reason"
        );
        let request = c["input"].to_string();
        let got = f(&request);
        if let Some(kind) = c.get("expectedError").and_then(Value::as_str) {
            match got {
                Err(e) if e.kind() == kind => {}
                Err(e) => errs.push(format!(
                    "{file}: {name:?}: expected error {kind}, got {}: {e}",
                    e.kind()
                )),
                Ok(v) => errs.push(format!("{file}: {name:?}: expected error {kind}, got {v}")),
            }
            continue;
        }
        let text = match got {
            Ok(t) => t,
            Err(e) => {
                errs.push(format!(
                    "{file}: {name:?}: unexpected error {}: {e}",
                    e.kind()
                ));
                continue;
            }
        };
        let envelope: Value = serde_json::from_str(&text).expect("envelope is JSON");
        assert_eq!(
            envelope["v"],
            json!(1),
            "{file}: {name:?}: envelope version"
        );
        let tol = c.get("tolerance").and_then(Value::as_f64).unwrap_or(0.0);
        let mut diffs = Vec::new();
        compare(
            "$",
            &c["expected"],
            &envelope["result"],
            tol,
            subset,
            &mut diffs,
        );
        errs.extend(diffs.into_iter().map(|d| format!("{file}: {name:?}: {d}")));
    }
    assert!(errs.is_empty(), "\n{}", errs.join("\n"));
    cases.len()
}

#[test]
fn golden_build_engine_state() {
    assert!(replay("build_engine_state", build_engine_state) >= 8);
}

#[test]
fn golden_readiness_summary() {
    assert!(replay("readiness_summary", readiness_summary) >= 11);
}

#[test]
fn golden_week_load() {
    assert!(replay("week_load", week_load) >= 8);
}

#[test]
fn golden_weight_trend() {
    assert!(replay("weight_trend", weight_trend) >= 13);
}

/// A new vector file cannot sit in the directory without being replayed.
#[test]
fn every_golden_file_is_replayed() {
    let listed: BTreeSet<String> = FILES.iter().map(|(n, _)| format!("{n}.json")).collect();
    let on_disk: BTreeSet<String> = std::fs::read_dir(DIR)
        .expect("golden directory")
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".json"))
        .collect();
    assert_eq!(on_disk, listed);
    // Each file replays through the function named like it (a swapped pair would fail here).
    for (name, f) in FILES {
        replay(name, f);
    }
}

#[test]
fn comparator_rules() {
    let check = |e: Value, a: Value, tol: f64, subset: bool| {
        let mut errs = Vec::new();
        compare("$", &e, &a, tol, subset, &mut errs);
        errs.len()
    };
    assert_eq!(check(json!(1), json!(1.0), 0.0, false), 0);
    assert_eq!(check(json!(1.000000002), json!(1.0), 1e-9, false), 1);
    assert_eq!(check(json!(1.000000002), json!(1.0), 1e-6, false), 0);
    assert_eq!(check(json!(1e-13), json!(0), 1e-9, false), 0);
    assert_eq!(check(json!(1e-11), json!(0), 1e-9, false), 1);
    assert_eq!(check(json!(null), json!(null), 0.0, false), 0);
    assert_eq!(check(json!(null), json!(0), 0.0, false), 1);
    assert_eq!(
        check(
            json!({"a": 1, "b": [1, 2]}),
            json!({"b": [1, 2], "a": 1}),
            0.0,
            false
        ),
        0
    );
    // Exact mode rejects extra keys, subset mode allows them, both reject missing ones.
    assert_eq!(
        check(json!({"a": 1}), json!({"a": 1, "b": 2}), 0.0, false),
        1
    );
    assert_eq!(
        check(json!({"a": 1}), json!({"a": 1, "b": 2}), 0.0, true),
        0
    );
    assert_eq!(
        check(json!({"a": 1, "b": 2}), json!({"a": 1}), 0.0, true),
        1
    );
    // Arrays keep their length even in subset mode; their elements may be subsets.
    assert_eq!(
        check(json!([{"a": 1}]), json!([{"a": 1, "b": 2}]), 0.0, true),
        0
    );
    assert_eq!(
        check(json!([{"a": 1}]), json!([{"a": 1}, {"a": 2}]), 0.0, true),
        1
    );
    assert_eq!(check(json!([1, 2]), json!([2, 1]), 0.0, false), 2);
    assert_eq!(check(json!("a"), json!("b"), 0.0, false), 1);
    assert_eq!(check(json!(true), json!(false), 0.0, false), 1);
}
