//! `utils/object.ts`. Dynamic helpers work on `serde_json::Value`, generic ones
//! on `IndexMap<String, V>`. `ObjectUtils_clone` is `Clone` in Rust.

use crate::js::js_order_keys;
use indexmap::IndexMap;
use serde_json::Value;

fn child_keys(v: &Value) -> Vec<String> {
    match v {
        Value::Object(m) => m.keys().cloned().collect(),
        Value::Array(a) => (0..a.len()).map(|i| i.to_string()).collect(),
        _ => Vec::new(),
    }
}

fn child<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    match v {
        Value::Object(m) => m.get(key),
        Value::Array(a) => key.parse::<usize>().ok().and_then(|i| a.get(i)),
        _ => None,
    }
}

fn is_obj(v: &Value) -> bool {
    matches!(v, Value::Object(_) | Value::Array(_))
}

fn prim_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        _ => a == b,
    }
}

/// Deep structural equality. A key present on one side only is unequal
/// (JS compares against `undefined`). Arrays compare like objects keyed by index.
/// Keys in `ignore_keys` are skipped at every depth.
pub fn is_equal(a: &Value, b: &Value, ignore_keys: &[&str]) -> bool {
    let mut stack: Vec<(Option<&Value>, Option<&Value>)> = vec![(Some(a), Some(b))];
    while let Some((x, y)) = stack.pop() {
        match (x, y) {
            (None, None) => {}
            (Some(x), Some(y)) if is_obj(x) && is_obj(y) => {
                let mut ks = child_keys(x);
                for k in child_keys(y) {
                    if !ks.contains(&k) {
                        ks.push(k);
                    }
                }
                for k in ks {
                    if ignore_keys.contains(&k.as_str()) {
                        continue;
                    }
                    stack.push((child(x, &k), child(y, &k)));
                }
            }
            (Some(x), Some(y)) => {
                if !prim_eq(x, y) {
                    return false;
                }
            }
            _ => return false,
        }
    }
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeKind {
    Delete,
    Update,
    Add,
}

/// Which keys were added, updated or deleted. A key counts as present when it is
/// in the map. Pass your own `eq`. Trap: the TS default is `===`, which for
/// object values (weights, percentages) is reference equality, so there an
/// unchanged-but-recreated value reports "update". Use [`changed_keys`] for
/// structural equality, or supply a reference-like predicate to mimic the TS.
pub fn changed_keys_with<V>(
    old_obj: &IndexMap<String, V>,
    new_obj: &IndexMap<String, V>,
    eq: impl Fn(&V, &V) -> bool,
) -> IndexMap<String, ChangeKind> {
    let mut changes = IndexMap::new();
    for (k, nv) in new_obj {
        match old_obj.get(k) {
            None => {
                changes.insert(k.clone(), ChangeKind::Add);
            }
            Some(ov) => {
                if !eq(nv, ov) {
                    changes.insert(k.clone(), ChangeKind::Update);
                }
            }
        }
    }
    for k in old_obj.keys() {
        if !new_obj.contains_key(k) {
            changes.insert(k.clone(), ChangeKind::Delete);
        }
    }
    js_order_keys(changes)
}

/// New values of added and updated keys.
pub fn diff_with<V: Clone>(
    old_obj: &IndexMap<String, V>,
    new_obj: &IndexMap<String, V>,
    eq: impl Fn(&V, &V) -> bool,
) -> IndexMap<String, V> {
    let mut result = IndexMap::new();
    for (k, kind) in changed_keys_with(old_obj, new_obj, eq) {
        if kind != ChangeKind::Delete {
            if let Some(v) = new_obj.get(&k) {
                result.insert(k, v.clone());
            }
        }
    }
    result
}

pub fn diff<V: Clone + PartialEq>(old_obj: &IndexMap<String, V>, new_obj: &IndexMap<String, V>) -> IndexMap<String, V> {
    diff_with(old_obj, new_obj, |a, b| a == b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Expected values derived by running the real ObjectUtils_* functions in V8.

    #[test]
    fn equality() {
        assert!(is_equal(&json!({"a":1,"b":{"c":[1,2]}}), &json!({"a":1,"b":{"c":[1,2]}}), &[]));
        assert!(!is_equal(&json!({"a":1,"b":{"c":[1,2]}}), &json!({"a":1,"b":{"c":[1,3]}}), &[]));
        assert!(is_equal(&json!({"a":1,"x":5}), &json!({"a":1,"x":6}), &["x"]));
        assert!(!is_equal(&json!({"a":1}), &json!({"a":1,"b":2}), &[]));
        assert!(!is_equal(&json!({"a":null}), &json!({"a":{}}), &[]));
        assert!(is_equal(&json!({"a":[1]}), &json!({"a":{"0":1}}), &[]));
        assert!(is_equal(&json!({"a":1}), &json!({"a":1.0}), &[]));
    }

}
