//! Golden tests for the plate port: every case in `testdata/golden/plates/*.json`, produced by
//! the TS plate math, must be reproduced by `qala_core::plates`.
//!
//! The shape of the file is documented in `testdata/golden/plates/README.md`. Cases are exact:
//! every expected number is a multiple of 0.25 or rounded to two decimals by the oracle, so
//! numbers compare as `f64` with no tolerance and everything else compares exactly.

use qala_core::plates::{
    choose_next_plates, default_barbell_step, describe_change, nearest_loadable, plan_plates,
    plates_shorthand, round_weight, PlateEntry,
};
use serde_json::{json, Value};

const DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/golden/plates/");

struct Case {
    name: String,
    input: Value,
    expected: Value,
}

fn load() -> Vec<Case> {
    let path = format!("{DIR}plates.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {path}: {e}"));
    let doc: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path}: {e}"));
    assert_eq!(doc["version"], json!(1), "{path}: unknown version");
    assert_eq!(
        doc["fn"],
        json!("plates"),
        "{path}: fn does not match the file name"
    );
    doc["cases"]
        .as_array()
        .unwrap_or_else(|| panic!("{path}: no cases"))
        .iter()
        .map(|c| Case {
            name: c["name"].as_str().expect("case name").to_string(),
            input: c["input"].clone(),
            expected: c["expected"].clone(),
        })
        .collect()
}

/// A JSON number, or one of the strings the file uses for inputs JSON cannot hold.
fn num(v: &Value) -> f64 {
    match v.as_str() {
        Some("NaN") => f64::NAN,
        Some("Infinity") => f64::INFINITY,
        Some("-Infinity") => f64::NEG_INFINITY,
        _ => v.as_f64().unwrap_or_else(|| panic!("not a number: {v}")),
    }
}

fn nums(v: &Value) -> Vec<f64> {
    v.as_array().expect("number list").iter().map(num).collect()
}

fn plates(v: &Value) -> Vec<PlateEntry> {
    serde_json::from_value(v.clone()).expect("plate inventory")
}

/// Numbers compare as exact `f64`s, everything else exactly; object key order is ignored.
fn assert_value_eq(case: &str, expected: &Value, actual: &Value, path: &str) {
    match (expected, actual) {
        (Value::Number(_), Value::Number(_)) => assert_eq!(
            num(expected),
            num(actual),
            "{case}: {path}: expected {expected}, got {actual}"
        ),
        (Value::Array(e), Value::Array(a)) => {
            assert_eq!(
                e.len(),
                a.len(),
                "{case}: {path}: expected {expected}, got {actual}"
            );
            for (i, (x, y)) in e.iter().zip(a).enumerate() {
                assert_value_eq(case, x, y, &format!("{path}[{i}]"));
            }
        }
        (Value::Object(e), Value::Object(a)) => {
            assert_eq!(
                e.len(),
                a.len(),
                "{case}: {path}: expected {expected}, got {actual}"
            );
            for (k, x) in e {
                let y = a
                    .get(k)
                    .unwrap_or_else(|| panic!("{case}: {path}.{k} missing in {actual}"));
                assert_value_eq(case, x, y, &format!("{path}.{k}"));
            }
        }
        _ => assert_eq!(expected, actual, "{case}: {path}"),
    }
}

fn run(case: &Case) -> Value {
    let input = &case.input;
    let plates = input.get("plates").map(plates).unwrap_or_default();
    let collar = input.get("collarWeight").map(num).unwrap_or(0.0);
    match input["call"].as_str().expect("call") {
        "plan_plates" => {
            let plan = plan_plates(
                num(&input["requestedTotal"]),
                num(&input["barWeight"]),
                &plates,
                collar,
            );
            serde_json::to_value(plan).expect("plan to json")
        }
        "nearest_loadable" => {
            let plan = plan_plates(
                num(&input["requestedTotal"]),
                num(&input["barWeight"]),
                &plates,
                collar,
            );
            serde_json::to_value(nearest_loadable(&plan)).expect("load to json")
        }
        "round_weight" => {
            json!(round_weight(
                num(&input["targetWeight"]),
                num(&input["barWeight"]),
                &plates,
                collar
            ))
        }
        "choose_next" => {
            let choice = choose_next_plates(
                &nums(&input["currentPerSide"]),
                num(&input["nextTotal"]),
                num(&input["barWeight"]),
                &plates,
                collar,
            );
            match choice {
                Some(c) => json!({
                    "perSide": c.load.per_side,
                    "total": c.load.total,
                    "instruction": c.instruction,
                    "keptInner": c.kept_inner,
                    "platesMoved": c.plates_moved,
                }),
                None => Value::Null,
            }
        }
        "describe_change" => json!(describe_change(
            &nums(&input["currentPerSide"]),
            &nums(&input["nextPerSide"])
        )),
        "shorthand" => json!(plates_shorthand(&nums(&input["perSide"]))),
        "barbell_step" => {
            let fallback = match &input["fallback"] {
                Value::Null => None,
                v => Some(num(v)),
            };
            json!(default_barbell_step(&plates, fallback))
        }
        other => panic!("unknown call {other}"),
    }
}

#[test]
fn golden_plates() {
    let cases = load();
    assert!(
        cases.len() >= 20,
        "expected the full oracle set, got {}",
        cases.len()
    );
    for case in &cases {
        let actual = run(case);
        assert_value_eq(&case.name, &case.expected, &actual, "$");
    }
}

/// The two loadability loops in `packages/core/rounding_test.ts`, as properties: every rounded
/// weight in range must be exactly loadable, with the full and the one-pair-of-45s inventories.
#[test]
fn round_weight_always_loadable() {
    let full: Vec<PlateEntry> = serde_json::from_value(json!([
        {"weight": 45, "pairs": "enough", "color": "blue"},
        {"weight": 35, "pairs": "enough", "color": "yellow"},
        {"weight": 25, "pairs": "enough", "color": "green"},
        {"weight": 10, "pairs": "enough", "color": "white"},
        {"weight": 5, "pairs": "enough", "color": "charcoal"},
        {"weight": 2.5, "pairs": "enough", "color": "silver"},
        {"weight": 1.25, "pairs": 0, "color": "silver"}
    ]))
    .expect("full inventory");
    let limited: Vec<PlateEntry> = full
        .iter()
        .map(|p| {
            let mut p = p.clone();
            if p.weight == 45.0 {
                p.pairs = qala_core::plates::Pairs::Count(1.0);
            }
            p
        })
        .collect();
    let mut w = 45.0;
    while w <= 315.0 {
        let rounded = round_weight(w, 45.0, &full, 0.0);
        assert!(
            plan_plates(rounded, 45.0, &full, 0.0).exact.is_some(),
            "{w} rounded to unloadable {rounded}"
        );
        w += 1.25;
    }
    let mut w = 45.0;
    while w <= 315.0 {
        let rounded = round_weight(w, 45.0, &limited, 0.0);
        assert!(
            plan_plates(rounded, 45.0, &limited, 0.0).exact.is_some(),
            "{w} rounded to unloadable {rounded} (limited)"
        );
        w += 2.5;
    }
}
