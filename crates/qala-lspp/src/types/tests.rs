//! Type tests: shape checks on hand-written JSON, and round trips of the
//! TS-produced golden files in `testdata/golden/liftoscript/` (skipped when
//! the directory is missing).

use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};

use super::*;

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../testdata/golden/liftoscript")
}

/// First differing path between two JSON values, if any.
fn first_diff(a: &Value, b: &Value, path: &str) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for (k, v) in x {
                match y.get(k) {
                    None => return Some(format!("{path}.{k}: missing after round trip (was {v})")),
                    Some(w) => {
                        if let Some(d) = first_diff(v, w, &format!("{path}.{k}")) {
                            return Some(d);
                        }
                    }
                }
            }
            for k in y.keys() {
                if !x.contains_key(k) {
                    return Some(format!("{path}.{k}: appeared after round trip"));
                }
            }
            None
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                return Some(format!("{path}: length {} vs {}", x.len(), y.len()));
            }
            for (i, (v, w)) in x.iter().zip(y).enumerate() {
                if let Some(d) = first_diff(v, w, &format!("{path}[{i}]")) {
                    return Some(d);
                }
            }
            None
        }
        _ => {
            if a == b {
                None
            } else {
                Some(format!("{path}: {a} vs {b}"))
            }
        }
    }
}

/// Golden JSON has `"stateKeys": {}` for a JS Set; the Rust side writes `[]`.
fn normalize_sets(v: &mut Value) {
    match v {
        Value::Object(m) => {
            if let Some(sk) = m.get_mut("stateKeys") {
                if sk.as_object().is_some_and(|o| o.is_empty()) {
                    *sk = json!([]);
                }
            }
            for x in m.values_mut() {
                normalize_sets(x);
            }
        }
        Value::Array(a) => a.iter_mut().for_each(normalize_sets),
        _ => {}
    }
}

fn round_trip<T: Serialize + DeserializeOwned>(v: &Value, path: &str) -> Result<(), String> {
    let mut v = v.clone();
    normalize_sets(&mut v);
    let v = &v;
    let t: T = serde_json::from_value(v.clone()).map_err(|e| format!("{path}: deserialize: {e}"))?;
    let back = serde_json::to_value(&t).map_err(|e| format!("{path}: serialize: {e}"))?;
    match first_diff(v, &back, path) {
        None => Ok(()),
        Some(d) => Err(d),
    }
}

fn load(rel: &str) -> Option<Value> {
    let p = golden_dir().join(rel);
    let s = std::fs::read_to_string(p).ok()?;
    serde_json::from_str(&s).ok()
}

fn golden_files() -> Vec<String> {
    let mut out = Vec::new();
    let dir = golden_dir();
    let Ok(rd) = std::fs::read_dir(&dir) else { return out };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let p = e.path();
        if p.is_dir() {
            if name == "builtins" || name == "builtins_kg" {
                if let Ok(sub) = std::fs::read_dir(&p) {
                    for s in sub.flatten() {
                        out.push(format!("{}/{}", name, s.file_name().to_string_lossy()));
                    }
                }
            }
        } else if name.ends_with(".json")
            && !name.starts_with("exercise_")
            && name != "uid_fields.json"
            && !name.starts_with("lezer")
        {
            out.push(name);
        }
    }
    out.sort();
    out
}

fn check_all(errors: &mut Vec<String>, r: Result<(), String>) {
    if let Err(e) = r {
        if errors.len() < 20 {
            errors.push(e);
        }
    }
}

#[test]
fn golden_round_trips() {
    let files = golden_files();
    if files.is_empty() {
        eprintln!("golden dir missing, skipping");
        return;
    }
    let mut errors = Vec::new();
    let mut checked = 0usize;
    for f in &files {
        let Some(d) = load(f) else { continue };
        if let Some(fx) = d.get("fixtures") {
            for (id, p) in fx["programs"].as_object().into_iter().flatten() {
                check_all(&mut errors, round_trip::<IEvaluatedProgram>(p, &format!("{f}:fixture program {id}")));
                checked += 1;
            }
            for (id, s) in fx["settings"].as_object().into_iter().flatten() {
                check_all(&mut errors, round_trip::<ISettings>(s, &format!("{f}:fixture settings {id}")));
                checked += 1;
            }
        }
        for c in d["cases"].as_array().into_iter().flatten() {
            let name = format!("{f}:{}:{}", c["fn"].as_str().unwrap_or("?"), c["name"].as_str().unwrap_or("?"));
            let inputs = &c["inputs"];
            let output = &c["output"];
            if let Some(e) = inputs.get("entry") {
                check_all(&mut errors, round_trip::<IHistoryEntry>(e, &format!("{name} input entry")));
                checked += 1;
            }
            for (i, e) in inputs["entries"].as_array().into_iter().flatten().enumerate() {
                check_all(&mut errors, round_trip::<IHistoryEntry>(e, &format!("{name} input entries[{i}]")));
                checked += 1;
            }
            if let Some(s) = inputs.get("stats") {
                if s.is_object() {
                    check_all(&mut errors, round_trip::<IStats>(s, &format!("{name} input stats")));
                    checked += 1;
                }
            }
            let fn_name = c["fn"].as_str().unwrap_or("");
            let r = match fn_name {
                "forceEvaluateText" | "evaluateQalaProgram" if output.get("$pruned").is_none() => {
                    Some(round_trip::<IEvaluatedProgram>(output, &format!("{name} output")))
                }
                "Program_nextHistoryEntry" | "runUpdateScriptForEntry" => {
                    Some(round_trip::<IHistoryEntry>(output, &format!("{name} output")))
                }
                // The dumper writes a NaN startTime as the string "NaN"; real records never carry it.
                "qalaLiftSessionToHistoryRecord" if output.is_object() && output["startTime"].is_number() => {
                    Some(round_trip::<IHistoryRecord>(output, &format!("{name} output")))
                }
                "qalaSettingsToLiftoscript" => Some(round_trip::<ISettings>(output, &format!("{name} output"))),
                "createScriptBindings" | "applyEngineBindings" => {
                    Some(round_trip::<IScriptBindings>(output, &format!("{name} output")))
                }
                "PlannerProgram_evaluateText" => {
                    Some(round_trip::<Vec<IPlannerProgramWeek>>(output, &format!("{name} output")))
                }
                "runAllFinishDayScripts" if output.get("evaluatedProgram").is_some() => Some(round_trip::<
                    IEvaluatedProgram,
                >(
                    &output["evaluatedProgram"],
                    &format!("{name} output.evaluatedProgram"),
                )),
                _ => None,
            };
            if let Some(r) = r {
                check_all(&mut errors, r);
                checked += 1;
            }
        }
    }
    assert!(errors.is_empty(), "{} round trip failures (of {} checked), first:\n{}", errors.len(), checked, errors.join("\n"));
    eprintln!("golden round trips checked: {checked}");
}

#[test]
fn golden_finish_day_data() {
    let Some(d) = load("finish_day_3.json") else { return };
    let mut errors = Vec::new();
    for c in d["cases"].as_array().into_iter().flatten() {
        if c["fn"] != "runFinishDayScript" {
            continue;
        }
        let out = &c["output"];
        if out["success"] == json!(true) {
            let data = &out["data"];
            check_all(&mut errors, round_trip::<IProgramState>(&data["state"], "state"));
            check_all(&mut errors, round_trip::<Vec<ILiftoscriptEvaluatorUpdate>>(&data["updates"], "updates"));
            check_all(&mut errors, round_trip::<IScriptBindings>(&data["bindings"], "bindings"));
        }
    }
    assert!(errors.is_empty(), "{}", errors.join("\n"));
}

#[test]
fn number_format_matches_json_stringify() {
    let w = IWeight { value: 135.0, unit: IUnit::Lb };
    assert_eq!(serde_json::to_string(&w).unwrap(), r#"{"value":135,"unit":"lb"}"#);
    let w = IWeight { value: 2.5, unit: IUnit::Kg };
    assert_eq!(serde_json::to_string(&w).unwrap(), r#"{"value":2.5,"unit":"kg"}"#);
    let w = IWeight { value: -0.0, unit: IUnit::Kg };
    assert_eq!(serde_json::to_string(&w).unwrap(), r#"{"value":0,"unit":"kg"}"#);
}

#[test]
fn script_value_variants() {
    let n: ScriptValue = serde_json::from_value(json!(5)).unwrap();
    assert_eq!(n, ScriptValue::Number(5.0));
    let w: ScriptValue = serde_json::from_value(json!({"value": 100, "unit": "lb"})).unwrap();
    assert!(w.is_weight());
    let p: ScriptValue = serde_json::from_value(json!({"value": 85, "unit": "%"})).unwrap();
    assert!(p.is_percentage());
    assert!(serde_json::from_value::<ScriptValue>(json!({"value": 1, "unit": "stone"})).is_err());
    assert_eq!(serde_json::to_value(ScriptValue::Number(5.0)).unwrap(), json!(5));
}

#[test]
fn literal_vtype_rejects_other_values() {
    let bad = json!({"vtype": "history_entry", "id": "x", "index": 0});
    assert!(serde_json::from_value::<ISet>(bad).is_err());
    let ok = json!({"vtype": "set", "id": "x", "index": 0});
    let s: ISet = serde_json::from_value(ok.clone()).unwrap();
    assert_eq!(serde_json::to_value(&s).unwrap(), ok);
}

#[test]
fn error_details_shape() {
    let v = json!({"type": "unknownVariable", "data": {"name": "foo"}, "subject": "Squat"});
    let d: IErrorDetails = serde_json::from_value(v.clone()).unwrap();
    assert_eq!(d.kind, IErrorKind::UnknownVariable { name: "foo".into() });
    assert_eq!(d.subject.as_deref(), Some("Squat"));
    assert_eq!(serde_json::to_value(&d).unwrap(), v);

    let v = json!({"type": "parse"});
    let d: IErrorDetails = serde_json::from_value(v.clone()).unwrap();
    assert_eq!(d.kind, IErrorKind::Parse);
    assert_eq!(serde_json::to_value(&d).unwrap(), v);

    let v = json!({"type": "fnArity", "data": {"fn": "round", "expected": "1-2", "got": 3}});
    let d: IErrorDetails = serde_json::from_value(v.clone()).unwrap();
    assert_eq!(serde_json::to_value(&d).unwrap(), v);

    let v = json!({"type": "reuseSelf", "data": {"section": "progress"}});
    assert!(serde_json::from_value::<IErrorDetails>(v).is_ok());
}

#[test]
fn from_point_formats_message() {
    let p = IPlannerSyntaxPointer { line: 3, offset: 4, from: 10, to: 12 };
    let e = PlannerSyntaxError::from_point(Some("Squat"), "bad thing", p, IErrorKind::Parse.into());
    assert_eq!(e.message, "Squat: bad thing (3:4)");
    assert_eq!(e.details.subject.as_deref(), Some("Squat"));
    let e = PlannerSyntaxError::from_point(None, "bad thing", p, IErrorKind::Parse.into());
    assert_eq!(e.message, "bad thing (3:4)");
    assert_eq!(e.details.subject, None);
    assert_eq!(e.to_string(), "bad thing (3:4)");
}

#[test]
fn either_shape() {
    let ok: IEither<Vec<i64>, String> = serde_json::from_value(json!({"success": true, "data": [1, 2]})).unwrap();
    assert_eq!(ok, IEither::Success(vec![1, 2]));
    let err: IEither<Vec<i64>, String> = serde_json::from_value(json!({"success": false, "error": "no"})).unwrap();
    assert_eq!(err.error().map(|s| s.as_str()), Some("no"));
    assert_eq!(serde_json::to_value(&ok).unwrap(), json!({"success": true, "data": [1, 2]}));
    assert!(serde_json::from_value::<IEither<i64, i64>>(json!({"success": true})).is_err());
}

#[test]
fn exercise_type_keys() {
    assert_eq!(IExerciseType::new("squat", Some("barbell")).to_key(), "squat_barbell");
    assert_eq!(IExerciseType::new("squat", None).to_key(), "squat");
    assert_eq!(IExerciseType::new("squat", Some("")).to_key(), "squat");
    assert_eq!(IExerciseType::from_key("squat_barbell"), IExerciseType::new("squat", Some("barbell")));
    assert_eq!(IExerciseType::from_key("squat"), IExerciseType::new("squat", None));
    assert_eq!(IExerciseType::from_key("a_b_c"), IExerciseType::new("a", Some("b")));
    assert_eq!(IExerciseType::from_key("a_"), IExerciseType::new("a", Some("")));
}

#[test]
fn double_option_and_timers() {
    let t: ISettingsTimers = serde_json::from_value(json!({"warmup": null, "workout": 90})).unwrap();
    assert_eq!(t.warmup, Some(None));
    assert_eq!(t.workout, Some(Some(90.0)));
    assert_eq!(serde_json::to_value(&t).unwrap(), json!({"warmup": null, "workout": 90}));
    let t: ISettingsTimers = serde_json::from_value(json!({})).unwrap();
    assert_eq!(t.warmup, None);
    assert_eq!(serde_json::to_value(&t).unwrap(), json!({}));
}

#[test]
fn bindings_defaults_and_holes() {
    let v = json!({
        "day": 1, "week": 1, "dayInWeek": 1, "originalWeights": [], "weights": [], "completedWeights": [],
        "rm1": {"value": 100, "unit": "lb"}, "reps": [5, null], "minReps": [], "amraps": [], "askweights": [],
        "logrpes": [], "timers": [], "setTime": [], "completedSetTime": [], "completedSetTimeLeft": [],
        "RPE": [], "completedRPE": [], "completedReps": [null], "completedRepsLeft": [], "isCompleted": [0, 1],
        "w": [], "r": [], "mr": [], "cr": [], "cw": [], "ns": 0, "programNumberOfSets": 0, "numberOfSets": 0,
        "completedNumberOfSets": 0, "setVariationIndex": 1, "exerciseVariationIndex": 1,
        "bodyweight": {"value": 0, "unit": "lb"}, "descriptionIndex": 1, "setIndex": 0
    });
    let b: IScriptBindings = serde_json::from_value(v).unwrap();
    assert_eq!(b.reps, vec![Some(5.0), None]);
    assert_eq!(b.readiness, 1.0);
    assert_eq!(b.soreness, 1.0);
    assert_eq!(b.deload, 0.0);
    let out = serde_json::to_value(&b).unwrap();
    assert_eq!(out["reps"], json!([5, null]));
    assert_eq!(out["readiness"], json!(1));
}

#[test]
fn updates_shape() {
    let v = json!({"type": "weights", "value": {"value": {"value": 5, "unit": "lb"}, "op": "+=", "target": ["*", 1, "_"]}});
    let u: ILiftoscriptEvaluatorUpdate = serde_json::from_value(v.clone()).unwrap();
    match &u {
        ILiftoscriptEvaluatorUpdate::Weights(x) => {
            assert_eq!(x.op, IAssignmentOp::AddAssign);
            assert_eq!(x.target, vec![ITargetIndex::Wildcard, ITargetIndex::Index(1.0), ITargetIndex::Underscore]);
        }
        _ => panic!("wrong variant"),
    }
    assert_eq!(serde_json::to_value(&u).unwrap(), v);
}

#[test]
fn interval_pair() {
    let v = json!([[1700000000000i64, null], [5, 7]]);
    let i: IIntervals = serde_json::from_value(v.clone()).unwrap();
    assert_eq!(i[0].1, None);
    assert_eq!(serde_json::to_value(&i).unwrap(), v);
}

// ---------------------------------------------------------------------------
// shared helpers for the oracle-derived unit tests in weight/equipment/set/stats.
// The cases live in `testdata/unit/cases_*.json`, generated by
// `testdata/unit/gen_unit_cases.ts` running the TS oracle.

pub(crate) struct Case {
    pub f: String,
    pub args: Vec<Value>,
    pub out: Option<Value>,
    pub throws: bool,
}

pub(crate) fn parse_cases(src: &str) -> Vec<Case> {
    let v: Value = serde_json::from_str(src).expect("cases json");
    v.as_array()
        .expect("cases array")
        .iter()
        .map(|c| Case {
            f: c["fn"].as_str().unwrap_or("").to_string(),
            args: c["args"].as_array().cloned().unwrap_or_default(),
            out: c.get("out").cloned(),
            throws: c.get("throws").is_some(),
        })
        .collect()
}

pub(crate) fn settings_named(name: &str) -> ISettings {
    let mut v: Value = serde_json::from_str(include_str!("../../testdata/unit/settings.json")).expect("settings json");
    match name {
        "other" => v["currentGymId"] = json!("other"),
        "kg" => v["units"] = json!("kg"),
        _ => {}
    }
    serde_json::from_value(v).expect("settings")
}

pub(crate) fn arg<T: DeserializeOwned>(v: &Value) -> T {
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("bad arg {v}: {e}"))
}

pub(crate) fn json_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| json_eq(p, q)),
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| json_eq(v, w)))
        }
        _ => a == b,
    }
}

/// The generator writes NaN and +-Infinity as strings; JSON (and the Rust
/// serializer) writes them as null.
fn nonfinite_to_null(v: &mut Value) {
    match v {
        Value::String(s) if s == "NaN" || s == "Infinity" || s == "-Infinity" => *v = Value::Null,
        Value::Object(m) => m.values_mut().for_each(nonfinite_to_null),
        Value::Array(a) => a.iter_mut().for_each(nonfinite_to_null),
        _ => {}
    }
}

/// Replace every `"id"` string with "<uid>" (set ids are random in TS).
pub(crate) fn scrub_ids(v: &mut Value) {
    match v {
        Value::Object(m) => {
            for (k, x) in m.iter_mut() {
                if k == "id" && x.is_string() {
                    *x = json!("<uid>");
                } else {
                    scrub_ids(x);
                }
            }
        }
        Value::Array(a) => a.iter_mut().for_each(scrub_ids),
        _ => {}
    }
}

/// Compare one Rust result with the oracle's. `actual` is `Err` when the Rust
/// function reports a failure (TS threw).
pub(crate) fn check(c: &Case, args_desc: &str, actual: Result<Value, String>, scrub: bool, errors: &mut Vec<String>) {
    let mut push = |m: String| {
        if errors.len() < 25 {
            errors.push(m);
        }
    };
    if c.throws {
        if actual.is_ok() {
            push(format!("{} {}: TS threw but Rust returned {:?}", c.f, args_desc, actual));
        }
        return;
    }
    match actual {
        Err(e) => push(format!("{} {}: Rust failed ({e}) but TS returned {:?}", c.f, args_desc, c.out)),
        Ok(mut got) => {
            let mut want = c.out.clone().unwrap_or(Value::Null);
            nonfinite_to_null(&mut want);
            if scrub {
                scrub_ids(&mut got);
                scrub_ids(&mut want);
            }
            if !json_eq(&got, &want) {
                push(format!("{} {}: Rust {} vs TS {}", c.f, args_desc, got, want));
            }
        }
    }
}
