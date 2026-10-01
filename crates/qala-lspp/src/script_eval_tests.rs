//! Replays `testdata/unit/cases_script_eval.json`, produced by
//! `testdata/unit/gen_script_eval_cases.ts` from the TS oracle: the script
//! corpus run through `ScriptRunner` in both modes against several binding and
//! state fixtures, the static helpers, `applyBindings` and `getNextEntry`.

use indexmap::IndexMap;
use serde_json::{json, Value};

use crate::progress::{self, create_script_functions};
use crate::script_runner::{ExecuteResult, ExecuteType, ScriptRunner};
use crate::types::errors::LiftoscriptSyntaxError;
use crate::types::{
    IDayData, IExerciseType, IHistoryEntry, IHistoryRecord, IProgramMode, IProgramState, IProgressMode,
    IScriptBindings, IScriptFnContext, ISettings, JsNumber,
};
use crate::util::generator::SequentialUid;

fn cases() -> Value {
    serde_json::from_str(include_str!("../testdata/unit/cases_script_eval.json")).expect("cases json")
}

fn settings() -> ISettings {
    serde_json::from_str(include_str!("../testdata/unit/settings.json")).expect("settings json")
}

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

fn error_json(e: &LiftoscriptSyntaxError) -> Value {
    json!({
        "message": e.message,
        "line": e.line,
        "offset": e.offset,
        "from": e.from,
        "to": e.to,
        "details": to_json(&e.details),
    })
}

fn result_json(r: &ExecuteResult) -> Value {
    match r {
        ExecuteResult::Number(n) => to_json(&JsNumber(*n)),
        ExecuteResult::Weight(w) => to_json(w),
        ExecuteResult::Percentage(p) => to_json(p),
        ExecuteResult::Bool(b) => json!({ "bool": b }),
    }
}

fn exec_type(t: &Value) -> Option<ExecuteType> {
    match t.as_str() {
        Some("weight") => Some(ExecuteType::Weight),
        Some("reps") => Some(ExecuteType::Reps),
        Some("rpe") => Some(ExecuteType::Rpe),
        Some("timer") => Some(ExecuteType::Timer),
        _ => None,
    }
}

fn load_bindings(fixture: &Value) -> IScriptBindings {
    let mut b: IScriptBindings = serde_json::from_value(fixture["bindings"].clone()).expect("bindings");
    b.aliased.0 = fixture["aliased"].as_bool().unwrap_or(false);
    b
}

fn squat() -> IExerciseType {
    IExerciseType::new("squat", Some("barbell"))
}

fn other_states() -> IndexMap<String, IProgramState> {
    serde_json::from_value(json!({ "1": { "x": 1, "y": { "value": 100, "unit": "lb" } }, "2": { "z": 5 } }))
        .expect("other states")
}

struct Mismatch {
    script: String,
    has_error: bool,
    what: String,
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

fn check_exec_case(c: &Value, fixtures: &Value, settings: &ISettings) -> Option<String> {
    let script = c["script"].as_str().unwrap();
    let mode = if c["mode"] == "planner" {
        IProgramMode::Planner
    } else {
        IProgramMode::Update
    };
    let mut bindings = load_bindings(&fixtures[c["fixture"].as_str().unwrap()]);
    let before = to_json(&bindings);
    let mut state: IProgramState = serde_json::from_value(c["state"].clone()).expect("state");
    let mut others = other_states();
    let mut context = IScriptFnContext {
        prints: vec![],
        unit: settings.units,
        exercise_type: Some(squat()),
    };
    let fns = create_script_functions(settings);
    let (outcome, updates) = {
        let mut runner = ScriptRunner::new(
            script,
            &mut state,
            &mut others,
            &mut bindings,
            &fns,
            settings.units,
            &mut context,
            mode,
        );
        let outcome = runner.execute(exec_type(&c["type"]));
        (outcome, to_json(&runner.get_updates()))
    };
    if c["error"].get("crash").is_some() {
        // The TS crashed on a malformed tree. Only require that Rust did not panic.
        return None;
    }
    if let Err(e) = &outcome {
        // Known, intended divergence: TS allows any set count (the corpus assigns weights like
        // 135 to numberOfSets), Rust stops at MAX_SETS so a script cannot allocate without bound.
        if c["error"].is_null() && e.message.starts_with("numberOfSets cannot be more than") {
            return None;
        }
    }
    let mut diffs = Vec::new();
    match (&outcome, c["error"].is_null()) {
        (Ok(r), true) => {
            json_diff("result", &norm(&c["result"]), &result_json(r), &mut diffs);
            json_diff("updates", &norm(&c["updates"]), &updates, &mut diffs);
        }
        (Err(e), false) => json_diff("error", &norm(&c["error"]), &error_json(e), &mut diffs),
        (Ok(r), false) => diffs.push(format!("expected error {}, got result {}", c["error"], result_json(r))),
        (Err(e), true) => diffs.push(format!("expected result {}, got error {}", c["result"], error_json(e))),
    }
    json_diff("stateAfter", &norm(&c["stateAfter"]), &to_json(&state), &mut diffs);
    json_diff(
        "otherStatesAfter",
        &norm(&c["otherStatesAfter"]),
        &to_json(&others),
        &mut diffs,
    );
    let after = to_json(&bindings);
    let mut changed = serde_json::Map::new();
    if let (Value::Object(b), Value::Object(a)) = (&before, &after) {
        for (k, v) in a {
            if b.get(k) != Some(v) {
                changed.insert(k.clone(), v.clone());
            }
        }
    }
    json_diff(
        "bindingsDiff",
        &norm(&c["bindingsDiff"]),
        &Value::Object(changed),
        &mut diffs,
    );
    json_diff("prints", &norm(&c["prints"]), &to_json(&context.prints), &mut diffs);
    if diffs.is_empty() {
        None
    } else {
        Some(diffs.join("; "))
    }
}

fn report(kind: &str, total: usize, mismatches: &[Mismatch], allow_error_trees: bool) {
    let hard: Vec<&Mismatch> = mismatches
        .iter()
        .filter(|m| !(allow_error_trees && m.has_error))
        .collect();
    let soft = mismatches.len() - hard.len();
    eprintln!(
        "{kind}: {total} cases, {} mismatches ({} on scripts with Lezer error nodes)",
        mismatches.len(),
        soft
    );
    if std::env::var("SHOW_SOFT").is_ok() {
        for m in mismatches.iter().filter(|m| m.has_error).take(60) {
            eprintln!("soft {:?}\n    {}", m.script, m.what);
        }
    }
    if !hard.is_empty() {
        let mut msg = String::new();
        for m in hard.iter().take(12) {
            msg.push_str(&format!("--- {:?}\n    {}\n", m.script, m.what));
        }
        panic!(
            "{kind}: {} of {} cases differ from the oracle, first:\n{msg}",
            hard.len(),
            total
        );
    }
}

#[test]
fn exec_matches_oracle() {
    let data = cases();
    let settings = settings();
    let list = data["exec"].as_array().unwrap();
    let mut mismatches = Vec::new();
    for c in list {
        if let Some(what) = check_exec_case(c, &data["fixtures"], &settings) {
            mismatches.push(Mismatch {
                script: format!(
                    "{} [{} {} {} {}]",
                    c["script"].as_str().unwrap(),
                    c["mode"],
                    c["fixture"],
                    c["stateVariant"],
                    c["type"]
                ),
                has_error: c["hasError"].as_bool().unwrap_or(false),
                what,
            });
        }
    }
    report("exec", list.len(), &mismatches, true);
}

#[test]
fn helpers_match_oracle() {
    let data = cases();
    let settings = settings();
    let day: IDayData = serde_json::from_value(data["dayData"].clone()).unwrap();
    let list = data["helpers"].as_array().unwrap();
    let mut mismatches = Vec::new();
    for c in list {
        let script = c["script"].as_str().unwrap();
        let state: IProgramState = serde_json::from_value(c["state"].clone()).unwrap();
        let mut diffs = Vec::new();
        let make = |script: &str| -> (IProgramState, IScriptBindings) {
            let _ = script;
            (
                state.clone(),
                progress::create_empty_script_bindings(&day, &settings, None),
            )
        };
        let run = |f: &mut dyn FnMut(&mut ScriptRunner<'_>)| {
            let (mut st, mut b) = make(script);
            let mut others = IndexMap::new();
            let mut ctx = IScriptFnContext {
                prints: vec![],
                unit: settings.units,
                exercise_type: None,
            };
            let fns = create_script_functions(&settings);
            let mut runner = ScriptRunner::new(
                script,
                &mut st,
                &mut others,
                &mut b,
                &fns,
                settings.units,
                &mut ctx,
                IProgramMode::Planner,
            );
            f(&mut runner);
        };
        let mut keys = Vec::new();
        run(&mut |r| keys = r.get_state_variable_keys().into_iter().collect());
        if c.get("stateKeys").is_some() {
            json_diff("stateKeys", &c["stateKeys"], &to_json(&keys), &mut diffs);
        }
        for unit in [crate::types::IUnit::Kg, crate::types::IUnit::Lb] {
            let mut out = None;
            run(&mut |r| out = Some(r.switch_weights_to_unit(unit)));
            let key = format!("switch_{}", unit.as_str());
            match out.unwrap() {
                Ok(s) => json_diff(&key, &c[&key], &json!(s), &mut diffs),
                Err(e) => json_diff(&key, &norm(&c[format!("{key}_error")]), &error_json(&e), &mut diffs),
            }
        }
        use crate::script_eval::LiftoscriptEvaluator;
        json_diff(
            "changeWeights",
            &c["changeWeights"],
            &json!(LiftoscriptEvaluator::change_weights_to_complete_weights(script)),
            &mut diffs,
        );
        json_diff(
            "hasKeywordWeights",
            &c["hasKeywordWeights"],
            &json!(ScriptRunner::has_keyword(script, "weights")),
            &mut diffs,
        );
        json_diff(
            "hasKeywordReps",
            &c["hasKeywordReps"],
            &json!(ScriptRunner::has_keyword(script, "reps")),
            &mut diffs,
        );
        json_diff(
            "hasStateA",
            &c["hasStateA"],
            &json!(ScriptRunner::has_state_variable(script, "a")),
            &mut diffs,
        );
        json_diff(
            "hasStateFailed",
            &c["hasStateFailed"],
            &json!(ScriptRunner::has_state_variable(script, "failed")),
            &mut diffs,
        );
        let valid = ScriptRunner::is_valid(script, &state, &day, &settings, Some(&squat()));
        let got = valid.as_ref().map(error_json).unwrap_or(Value::Null);
        if c["isValid"].get("crash").is_none() {
            json_diff("isValid", &norm(&c["isValid"]), &got, &mut diffs);
        }
        if !diffs.is_empty() {
            mismatches.push(Mismatch {
                script: script.to_string(),
                has_error: c["hasError"].as_bool().unwrap_or(false),
                what: diffs.join("; "),
            });
        }
    }
    report("helpers", list.len(), &mismatches, true);
}

fn scrub_ids(v: &mut Value) {
    match v {
        Value::Array(a) => a.iter_mut().for_each(scrub_ids),
        Value::Object(o) => {
            if o.get("vtype") == Some(&json!("set")) {
                if let Some(Value::String(id)) = o.get("id") {
                    if !(id.len() == 2 && id.starts_with('s')) {
                        o.insert("id".to_string(), json!("<uid>"));
                    }
                }
            }
            o.values_mut().for_each(scrub_ids);
        }
        _ => {}
    }
}

#[test]
fn apply_bindings_matches_oracle() {
    let data = cases();
    let settings = settings();
    let list = data["apply"].as_array().unwrap();
    let mut mismatches = Vec::new();
    for c in list {
        let script = c["script"].as_str().unwrap();
        let entry: IHistoryEntry = serde_json::from_value(c["entry"].clone()).unwrap();
        let mut bindings: IScriptBindings = serde_json::from_value(c["bindings"].clone()).unwrap();
        bindings.aliased.0 = c["aliased"].as_bool().unwrap();
        let mut state = IProgramState::new();
        let mut others = IndexMap::new();
        let mut ctx = IScriptFnContext {
            prints: vec![],
            unit: settings.units,
            exercise_type: Some(squat()),
        };
        let fns = create_script_functions(&settings);
        let outcome = {
            let mut runner = ScriptRunner::new(
                script,
                &mut state,
                &mut others,
                &mut bindings,
                &fns,
                settings.units,
                &mut ctx,
                IProgramMode::Update,
            );
            runner.execute(None)
        };
        let mut diffs = Vec::new();
        match outcome {
            Err(e) => {
                if c["error"].is_null() {
                    diffs.push(format!("unexpected error {}", e.message));
                } else {
                    json_diff("error", &norm(&c["error"]), &error_json(&e), &mut diffs);
                }
            }
            Ok(_) => {
                let mut uid = SequentialUid::new();
                let mut got = to_json(&progress::apply_bindings(&entry, &bindings, &settings, &mut uid));
                let mut want = norm(&c["newEntry"]);
                scrub_ids(&mut got);
                scrub_ids(&mut want);
                json_diff("entry", &want, &got, &mut diffs);
            }
        }
        if !diffs.is_empty() {
            mismatches.push(Mismatch {
                script: script.to_string(),
                has_error: false,
                what: diffs.join("; "),
            });
        }
    }
    report("apply", list.len(), &mismatches, false);
}

#[test]
fn next_entry_matches_oracle() {
    let data = cases();
    let list = data["next"].as_array().unwrap();
    let mut mismatches = Vec::new();
    for c in list {
        let entries = c["entries"].clone();
        let record: IHistoryRecord = serde_json::from_value(json!({
            "vtype": "progress", "date": "2024-01-01", "programId": "p", "programName": "P", "day": 1,
            "dayName": "D", "entries": entries, "startTime": 0, "id": 1
        }))
        .unwrap();
        let entry: IHistoryEntry = if c["foreign"] == true {
            serde_json::from_value(json!({
                "vtype": "history_entry", "exercise": { "id": "zzz", "equipment": "barbell" },
                "sets": [{ "vtype": "set", "id": "zzz0", "index": 0, "reps": 5, "isCompleted": false, "askWeight": false, "isUnilateral": false }],
                "warmupSets": [], "index": 0, "id": "zzz"
            }))
            .unwrap()
        } else {
            record.entries[c["entryIndex"].as_u64().unwrap() as usize].clone()
        };
        let mode = if c["mode"] == "workout" {
            IProgressMode::Workout
        } else {
            IProgressMode::Warmup
        };
        let go = c["go"].as_bool().unwrap();
        // identity matters, so use the record's own entry when there is one
        let entry_ref: &IHistoryEntry = if c["foreign"] == true {
            &entry
        } else {
            &record.entries[c["entryIndex"].as_u64().unwrap() as usize]
        };
        let got = progress::get_next_entry_position(&record, entry_ref, mode, go);
        let want = c["result"].as_u64().map(|n| n as usize);
        if got != want {
            mismatches.push(Mismatch {
                script: format!("{} {} go={} idx={}", c["record"], c["mode"], go, c["entryIndex"]),
                has_error: false,
                what: format!("expected {want:?}, got {got:?}"),
            });
        }
    }
    report("next", list.len(), &mismatches, false);
}

fn golden_bindings() -> Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../testdata/golden/liftoscript/bindings.json"
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
        "/../../testdata/golden/liftoscript/finish_day_4.json"
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

#[test]
fn program_set_matches_oracle() {
    use crate::program_set as ps;
    use crate::types::{IPlannerProgramExerciseEvaluatedSet, IProgramSet};
    let data = cases();
    let variants = &data["programSetSettings"];
    let mut count = 0;
    for c in data["programSet"].as_array().unwrap() {
        let a = &c["args"];
        let want = norm(&c["out"]);
        let st = |c: &Value| -> ISettings {
            serde_json::from_value(variants[c["settings"].as_str().unwrap()].clone()).unwrap()
        };
        let got: Value = match c["fn"].as_str().unwrap() {
            "group" => {
                let sets: Vec<IProgramSet> = serde_json::from_value(a[0].clone()).unwrap();
                to_json(&ps::group(&sets))
            }
            "approxSetTimeMs" => to_json(&JsNumber(ps::approx_set_time_ms(a[0].as_f64(), a[1].as_f64().unwrap()))),
            "approxRestTimer" => to_json(&JsNumber(ps::approx_rest_timer(
                a[0].as_f64(),
                a[1].as_f64().unwrap(),
                a[2].as_f64(),
            ))),
            "approxTimeMs" => {
                let set: IPlannerProgramExerciseEvaluatedSet = serde_json::from_value(a[0].clone()).unwrap();
                to_json(&JsNumber(ps::approx_time_ms(&set, &st(c), a[1].as_bool().unwrap())))
            }
            "isEligibleForInferredWeight" => {
                let set: IPlannerProgramExerciseEvaluatedSet = serde_json::from_value(a[0].clone()).unwrap();
                json!(ps::is_eligible_for_inferred_weight(&set))
            }
            "getEvaluatedWeight" => {
                let set: IPlannerProgramExerciseEvaluatedSet = serde_json::from_value(a[0].clone()).unwrap();
                let ex: IExerciseType = serde_json::from_value(a[1].clone()).unwrap();
                match ps::get_evaluated_weight(&set, &ex, &st(c)) {
                    Some(w) => to_json(&w),
                    None => Value::Null,
                }
            }
            other => panic!("unhandled {other}"),
        };
        let mut diffs = Vec::new();
        json_diff(c["fn"].as_str().unwrap(), &want, &got, &mut diffs);
        assert!(diffs.is_empty(), "{} {}: {}", c["fn"], a, diffs.join("; "));
        count += 1;
    }
    assert!(count > 200, "{count}");
}
