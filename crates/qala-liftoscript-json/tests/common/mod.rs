//! Shared golden helpers for the shim crates' tests. Same normalizations as
//! `crates/qala-liftoscript/tests/golden.rs`: `<uid>` placeholders, NaN strings read as
//! null, `liftoscriptNode` dropped, `stateKeys` array read as `{}`, nested `reuse`
//! pruned, field order ignored on `vtype: set` / `history_entry` objects.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

pub fn golden_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../testdata/golden/liftoscript")
}

pub fn load(rel: &str) -> Value {
    let path = golden_dir().join(rel);
    let text = fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()))
}

pub fn case<'a>(doc: &'a Value, fn_name: &str, name_prefix: &str) -> &'a Value {
    doc["cases"]
        .as_array()
        .and_then(|cs| {
            cs.iter().find(|c| c["fn"] == fn_name && c["name"].as_str().unwrap_or("").starts_with(name_prefix))
        })
        .unwrap_or_else(|| panic!("no case {fn_name} / {name_prefix}"))
}

/// Unwraps `{"v":1,"result":...}`, panicking on an error envelope.
pub fn result_of(envelope: &str) -> Value {
    let v: Value = serde_json::from_str(envelope).expect("envelope is JSON");
    assert_eq!(v["v"], 1, "envelope version: {envelope}");
    assert!(v.get("error").is_none(), "unexpected error envelope: {envelope}");
    v["result"].clone()
}

pub fn error_of(envelope: &str) -> (String, String) {
    let v: Value = serde_json::from_str(envelope).expect("envelope is JSON");
    assert_eq!(v["v"], 1);
    let e = v.get("error").unwrap_or_else(|| panic!("expected error envelope: {envelope}"));
    (e["kind"].as_str().unwrap_or("").to_string(), e["message"].as_str().unwrap_or("").to_string())
}

/// Compares `actual` with the golden `expected` (which may be a `$pruned` wrapper).
pub fn assert_matches(actual: &Value, expected: &Value, what: &str) {
    let (exp, act) = match expected.get("$pruned") {
        Some(_) => {
            let value = expected.get("value").cloned().unwrap_or(Value::Null);
            (norm_expected(&value), prune_reuse(&norm_actual(actual), false))
        }
        None => (norm_expected(expected), norm_actual(actual)),
    };
    if let Some(d) = diff(&act, &exp, "$") {
        panic!("{what}: {d}");
    }
}

/// Field order of these objects depends on how the TS built them (and, for
/// evaluated sets, on which scripts later assigned `weight`), not on data.
fn is_unordered_object(m: &Map<String, Value>) -> bool {
    matches!(m.get("vtype").and_then(Value::as_str), Some("set") | Some("history_entry"))
        || (m.contains_key("isQuickAddSet") && m.contains_key("askWeight"))
}

/// Expected side: non-finite number strings become null, lezer nodes and
/// `liftoscriptNode` keys are dropped.
fn norm_expected(v: &Value) -> Value {
    match v {
        Value::String(s) if s == "NaN" || s == "Infinity" || s == "-Infinity" => Value::Null,
        Value::Array(a) => Value::Array(a.iter().map(norm_expected).collect()),
        Value::Object(m) => {
            let mut out = Map::new();
            for (k, x) in m {
                if k == "liftoscriptNode" || k == "$error" {
                    continue;
                }
                out.insert(k.clone(), norm_expected(x));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

fn norm_actual(v: &Value) -> Value {
    match v {
        Value::Array(a) => Value::Array(a.iter().map(norm_actual).collect()),
        Value::Object(m) => {
            let mut out = Map::new();
            for (k, x) in m {
                if k == "liftoscriptNode" {
                    continue;
                }
                if k == "stateKeys" && x.is_array() {
                    out.insert(k.clone(), Value::Object(Map::new()));
                    continue;
                }
                out.insert(k.clone(), norm_actual(x));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

/// Removes every `reuse` that sits inside another `reuse`.
fn prune_reuse(v: &Value, in_reuse: bool) -> Value {
    match v {
        Value::Array(a) => Value::Array(a.iter().map(|x| prune_reuse(x, in_reuse)).collect()),
        Value::Object(m) => {
            let mut out = Map::new();
            for (k, x) in m {
                if k == "reuse" {
                    if in_reuse {
                        continue;
                    }
                    out.insert(k.clone(), prune_reuse(x, true));
                } else {
                    out.insert(k.clone(), prune_reuse(x, in_reuse));
                }
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

fn short(v: &Value) -> String {
    let s = v.to_string();
    if s.len() > 160 {
        let mut end = 160;
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}...", &s[..end])
    } else {
        s
    }
}

/// First difference between actual and expected, as a path plus detail.
fn diff(actual: &Value, expected: &Value, path: &str) -> Option<String> {
    match (actual, expected) {
        (Value::String(a), Value::String(e)) if e == "<uid>" => {
            if a.is_empty() {
                Some(format!("{path}: expected a non-empty id, got empty string"))
            } else {
                None
            }
        }
        (Value::Number(a), Value::Number(e)) => {
            let (a, e) = (a.as_f64(), e.as_f64());
            if a == e {
                None
            } else {
                Some(format!("{path}: actual {a:?}, expected {e:?}"))
            }
        }
        (Value::Array(a), Value::Array(e)) => {
            if a.len() != e.len() {
                return Some(format!("{path}: array length actual {}, expected {}", a.len(), e.len()));
            }
            for (i, (x, y)) in a.iter().zip(e).enumerate() {
                if let Some(d) = diff(x, y, &format!("{path}[{i}]")) {
                    return Some(d);
                }
            }
            None
        }
        (Value::Object(a), Value::Object(e)) => {
            let unordered = is_unordered_object(e);
            if !unordered {
                let ak: Vec<&String> = a.keys().collect();
                let ek: Vec<&String> = e.keys().collect();
                if ak != ek {
                    let missing: Vec<&&String> = ek.iter().filter(|k| !a.contains_key(k.as_str())).collect();
                    let extra: Vec<&&String> = ak.iter().filter(|k| !e.contains_key(k.as_str())).collect();
                    if missing.is_empty() && extra.is_empty() {
                        return Some(format!("{path}: key order actual {ak:?}, expected {ek:?}"));
                    }
                    return Some(format!("{path}: keys missing {missing:?}, extra {extra:?}"));
                }
            } else {
                for k in e.keys() {
                    if !a.contains_key(k) {
                        return Some(format!("{path}: missing key {k}"));
                    }
                }
                for k in a.keys() {
                    if !e.contains_key(k) {
                        return Some(format!("{path}: extra key {k}"));
                    }
                }
            }
            for (k, ev) in e {
                if let Some(av) = a.get(k) {
                    if let Some(d) = diff(av, ev, &format!("{path}.{k}")) {
                        return Some(d);
                    }
                }
            }
            None
        }
        (a, e) if a == e => None,
        (a, e) => Some(format!("{path}: actual {}, expected {}", short(a), short(e))),
    }
}


/// Turns a golden case's inputs into a request: `programRef` / `settingsRef` are resolved
/// from the file's fixtures and renamed `program` / `settings`, and `"v": 1` is added.
pub fn request_from(doc: &Value, case: &Value) -> String {
    let mut m = Map::new();
    m.insert("v".to_string(), Value::from(1));
    for (k, v) in case["inputs"].as_object().expect("inputs object") {
        match k.as_str() {
            "programRef" => {
                let name = v.as_str().expect("programRef");
                m.insert("program".to_string(), doc["fixtures"]["programs"][name].clone());
            }
            "settingsRef" => {
                let name = v.as_str().expect("settingsRef");
                m.insert("settings".to_string(), doc["fixtures"]["settings"][name].clone());
            }
            _ => {
                m.insert(k.clone(), v.clone());
            }
        }
    }
    Value::Object(m).to_string()
}

/// Cases of `fn_name` in `doc`, first `limit` of them.
pub fn cases_of_fn<'a>(doc: &'a Value, fn_name: &str, limit: usize) -> Vec<&'a Value> {
    doc["cases"].as_array().map(|cs| cs.iter().filter(|c| c["fn"] == fn_name).take(limit).collect()).unwrap_or_default()
}
