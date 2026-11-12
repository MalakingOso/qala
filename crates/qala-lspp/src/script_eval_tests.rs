//! Script bindings and `run_update_script` checked against the tracked goldens
//! under `testdata/golden/lspp`.

use indexmap::IndexMap;
use serde_json::{json, Value};

use crate::progress;
use crate::types::{IDayData, IExerciseType, IHistoryEntry, IProgramState, ISettings};
use crate::util::generator::SequentialUid;

/// Expected values carry non-finite numbers as the strings "NaN", "Infinity"
/// and "-Infinity" while serde writes them as null. Map the strings to null.
fn norm(v: &Value) -> Value {
    match v {
        Value::String(s) if s == "NaN" || s == "Infinity" || s == "-Infinity" => Value::Null,
        Value::Array(a) => Value::Array(a.iter().map(norm).collect()),
        // error details keep their strings: a variable can be named NaN
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, v)| (k.clone(), if k == "details" { v.clone() } else { norm(v) }))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn to_json<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).expect("serialize")
}

fn json_diff(path: &str, a: &Value, b: &Value, out: &mut Vec<String>) {
    if a == b || out.len() > 3 {
        return;
    }
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for (k, v) in x {
                match y.get(k) {
                    Some(w) => json_diff(&format!("{path}.{k}"), v, w, out),
                    None => out.push(format!("{path}.{k}: expected {v}, got missing")),
                }
            }
            for (k, w) in y {
                if !x.contains_key(k) {
                    out.push(format!("{path}.{k}: expected missing, got {w}"));
                }
            }
        }
        (Value::Array(x), Value::Array(y)) if x.len() == y.len() => {
            for (i, (v, w)) in x.iter().zip(y).enumerate() {
                json_diff(&format!("{path}[{i}]"), v, w, out);
            }
        }
        _ => out.push(format!("{path}: expected {a}, got {b}")),
    }
}

fn golden_bindings() -> Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../testdata/golden/lspp/bindings.json"
    );
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).expect("bindings.json"),
        Err(_) => Value::Null,
    }
}

const ENGINE_KEYS: [&str; 7] = [
    "readiness",
    "prs",
    "soreness",
    "fatigueLocal",
    "deload",
    "recWeightPct",
    "recSets",
];

#[test]
fn create_script_bindings_matches_golden() {
    let data = golden_bindings();
    let Some(list) = data["cases"].as_array() else { return };
    let mut checked = 0;
    for c in list.iter().filter(|c| c["fn"] == "createScriptBindings") {
        let i = &c["inputs"];
        let settings: ISettings = serde_json::from_value(i["settings"].clone()).unwrap();
        let day: IDayData = serde_json::from_value(i["dayData"].clone()).unwrap();
        let entry: IHistoryEntry = serde_json::from_value(i["entry"].clone()).unwrap();
        let bodyweight = i
            .get("bodyweight")
            .filter(|v| !v.is_null())
            .map(|v| serde_json::from_value(v.clone()).unwrap());
        let num = |k: &str| i.get(k).and_then(|v| v.as_f64());
        let b = progress::create_script_bindings(
            &day,
            &entry,
            &settings,
            i["programNumberOfSets"].as_f64().unwrap(),
            bodyweight,
            num("setIndex"),
            num("setVariationIndex"),
            num("descriptionIndex"),
            num("exerciseVariationIndex"),
        );
        let mut got = to_json(&b);
        let mut want = norm(&c["output"]);
        if i.get("engine").is_some_and(|e| !e.is_null()) {
            for k in ENGINE_KEYS {
                got.as_object_mut().unwrap().remove(k);
                want.as_object_mut().unwrap().remove(k);
            }
        }
        let mut diffs = Vec::new();
        json_diff("bindings", &want, &got, &mut diffs);
        assert!(diffs.is_empty(), "{}: {}", c["name"], diffs.join("; "));
        assert!(b.aliased.0);
        checked += 1;
    }
    assert!(checked >= 8, "checked {checked}");
}

#[test]
fn fn_signatures_match_golden() {
    use crate::script_fns::{arg_signature, arity, IScriptFnName};
    let data = golden_bindings();
    let Some(list) = data["cases"].as_array() else { return };
    let sigs = list
        .iter()
        .find(|c| c["fn"] == "liftoscriptFnSignatures")
        .expect("signatures case");
    let obj = sigs["output"].as_object().unwrap();
    assert_eq!(obj.len(), IScriptFnName::ALL.len());
    for f in IScriptFnName::ALL {
        let want = &obj[f.name()];
        let ar = arity(f);
        if want["variadic"] == true {
            assert!(want["args"].is_null());
            assert_eq!((ar.min, ar.max), (0, None), "{}", f.name());
            continue;
        }
        let args = want["args"].as_array().unwrap();
        assert_eq!(ar.max, Some(args.len()), "{}", f.name());
        assert_eq!(
            ar.min,
            args.iter().filter(|a| a["optional"] == false).count(),
            "{}",
            f.name()
        );
        for (i, a) in args.iter().enumerate() {
            let s = arg_signature(f, i).unwrap();
            assert_eq!(a["name"].as_str().unwrap(), s.name);
            assert_eq!(a["optional"].as_bool().unwrap(), s.optional);
        }
    }
    let names = list
        .iter()
        .find(|c| c["fn"] == "createScriptFunctions")
        .expect("fns case");
    let listed: Vec<&str> = names["output"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    for n in &listed {
        assert!(IScriptFnName::from_name(n).is_some(), "{n}");
    }
    assert!(IScriptFnName::ALL
        .iter()
        .all(|f| *f == IScriptFnName::ZeroOrGte || listed.contains(&f.name())));
}

fn find_str(v: &Value, paths: &[&[&str]]) -> Option<String> {
    for p in paths {
        let mut cur = v;
        let mut ok = true;
        for k in *p {
            match cur.get(*k) {
                Some(n) if !n.is_null() => cur = n,
                _ => {
                    ok = false;
                    break;
                }
            }
        }
        if ok {
            if let Some(s) = cur.as_str() {
                return Some(s.to_string());
            }
        }
    }
    None
}

/// `PlannerProgramExercise_getState` over raw JSON.
fn exercise_state(ex: &Value, depth: usize) -> serde_json::Map<String, Value> {
    let progress = &ex["progress"];
    if progress.get("state").is_some_and(|s| !s.is_null()) && progress.get("reuse").is_none_or(|r| r.is_null()) {
        return progress["state"].as_object().cloned().unwrap_or_default();
    }
    let mut out = serde_json::Map::new();
    if depth < 4 {
        let reuse_ex = progress
            .get("reuse")
            .and_then(|r| r.get("exercise"))
            .filter(|e| !e.is_null())
            .or_else(|| ex.get("reuse").and_then(|r| r.get("exercise")).filter(|e| !e.is_null()));
        if let Some(r) = reuse_ex {
            out = exercise_state(r, depth + 1);
        }
    }
    if let Some(s) = progress.get("state").and_then(|s| s.as_object()) {
        for (k, v) in s {
            out.insert(k.clone(), v.clone());
        }
    }
    out
}

fn current_index(list: &Value) -> usize {
    list.as_array()
        .and_then(|a| a.iter().position(|x| x["isCurrent"] == true))
        .unwrap_or(0)
}

#[test]
fn run_update_script_matches_golden() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../testdata/golden/lspp/finish_day_4.json"
    );
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
    };
    let data: Value = serde_json::from_str(&text).unwrap();
    let mut checked = 0;
    for c in data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["fn"] == "runUpdateScriptForEntry")
    {
        let i = &c["inputs"];
        let program = &data["fixtures"]["programs"][i["programRef"].as_str().unwrap()];
        let settings: ISettings =
            serde_json::from_value(data["fixtures"]["settings"][i["settingsRef"].as_str().unwrap()].clone()).unwrap();
        let day = i["day"].as_u64().unwrap();
        let mut n = 0;
        let mut program_day = None;
        for week in program["weeks"].as_array().unwrap() {
            for d in week["days"].as_array().unwrap() {
                n += 1;
                if n == day {
                    program_day = Some(d);
                }
            }
        }
        let program_day = program_day.unwrap();
        let ex = program_day["exercises"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["key"] == i["exerciseKey"])
            .unwrap();
        let day_data: IDayData = serde_json::from_value(program_day["dayData"].clone()).unwrap();
        let entry: IHistoryEntry = serde_json::from_value(i["entry"].clone()).unwrap();
        let exercise_type: IExerciseType = serde_json::from_value(ex["exerciseType"].clone()).unwrap();
        let state: IProgramState = serde_json::from_value(Value::Object(exercise_state(ex, 0))).unwrap();
        let others: IndexMap<String, IProgramState> = serde_json::from_value(i["otherStates"].clone()).unwrap();
        let stats = serde_json::from_value(i["stats"].clone()).unwrap();
        let sv = current_index(&ex["evaluatedSetVariations"]);
        let script = find_str(
            ex,
            &[
                &["update", "script"],
                &["update", "reuse", "exercise", "update", "script"],
                &[
                    "update", "reuse", "exercise", "update", "reuse", "exercise", "update", "script",
                ],
                &["reuse", "exercise", "update", "script"],
                &["reuse", "exercise", "update", "reuse", "exercise", "update", "script"],
            ],
        );
        let ue = progress::UpdateScriptExercise {
            script: script.as_deref(),
            exercise_type: &exercise_type,
            state: &state,
            set_variation_index: sv as f64,
            description_index: current_index(&ex["descriptions"]["values"]) as f64,
            exercise_variation_index: current_index(&ex["exerciseVariations"]) as f64,
            program_number_of_sets: ex["evaluatedSetVariations"][sv]["sets"]
                .as_array()
                .map(|a| a.len())
                .unwrap_or(0) as f64,
        };
        let mut uid = SequentialUid::new();
        let got = progress::run_update_script_for_entry(
            &entry,
            &day_data,
            &ue,
            &others,
            i["setIndex"].as_i64().unwrap(),
            &settings,
            &stats,
            &mut uid,
        )
        .unwrap_or_else(|e| panic!("{}: {}", c["name"], e.message));
        let mut got = to_json(&got);
        let mut want = norm(&c["output"]);
        let known: Vec<String> = entry
            .sets
            .iter()
            .map(|s| s.id.clone())
            .chain(entry.warmup_sets.iter().map(|s| s.id.clone()))
            .collect();
        fn scrub_unknown(v: &mut Value, known: &[String]) {
            match v {
                Value::Array(a) => a.iter_mut().for_each(|x| scrub_unknown(x, known)),
                Value::Object(o) => {
                    if o.get("vtype") == Some(&json!("set")) {
                        if let Some(Value::String(id)) = o.get("id") {
                            if !known.contains(id) {
                                o.insert("id".to_string(), json!("<uid>"));
                            }
                        }
                    }
                    o.values_mut().for_each(|x| scrub_unknown(x, known));
                }
                _ => {}
            }
        }
        scrub_unknown(&mut got, &known);
        scrub_unknown(&mut want, &known);
        let mut diffs = Vec::new();
        json_diff("entry", &want, &got, &mut diffs);
        assert!(diffs.is_empty(), "{}: {}", c["name"], diffs.join("; "));
        checked += 1;
    }
    assert!(checked >= 7, "checked {checked}");
}
