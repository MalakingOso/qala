//! `utils/object.ts`. Dynamic helpers work on `serde_json::Value`, generic ones
//! on `IndexMap<String, V>`. `ObjectUtils_clone` is `Clone` in Rust.

use crate::js::js_order_keys;
use indexmap::IndexMap;
use serde_json::{Map, Value};

pub fn keys<V>(obj: &IndexMap<String, V>) -> Vec<String> {
    obj.keys().cloned().collect()
}

pub fn values<V: Clone>(obj: &IndexMap<String, V>) -> Vec<V> {
    obj.values().cloned().collect()
}

pub fn entries<V: Clone>(obj: &IndexMap<String, V>) -> Vec<(String, V)> {
    obj.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
}

pub fn is_empty<V>(obj: &IndexMap<String, V>) -> bool {
    obj.is_empty()
}

pub fn is_not_empty<V>(obj: &IndexMap<String, V>) -> bool {
    !obj.is_empty()
}

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

/// Breadth-first list of dotted paths whose leaf values differ.
pub fn diff_paths(obj1: &Value, obj2: &Value) -> Vec<String> {
    let mut result = Vec::new();
    let mut queue: std::collections::VecDeque<(Option<&Value>, Option<&Value>, String)> = std::collections::VecDeque::new();
    queue.push_back((Some(obj1), Some(obj2), String::new()));
    while let Some((x, y, path)) = queue.pop_front() {
        match (x, y) {
            (Some(x), Some(y)) if is_obj(x) && is_obj(y) => {
                let mut ks = child_keys(x);
                for k in child_keys(y) {
                    if !ks.contains(&k) {
                        ks.push(k);
                    }
                }
                for k in ks {
                    let new_path = if path.is_empty() { k.clone() } else { format!("{}.{}", path, k) };
                    queue.push_back((child(x, &k), child(y, &k), new_path));
                }
            }
            (None, None) => {}
            (Some(x), Some(y)) => {
                // two non-objects, or an object against a primitive: differ unless equal primitives
                if is_obj(x) || is_obj(y) || !prim_eq(x, y) {
                    result.push(path);
                }
            }
            _ => result.push(path),
        }
    }
    result
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

pub fn changed_keys<V: PartialEq>(old_obj: &IndexMap<String, V>, new_obj: &IndexMap<String, V>) -> IndexMap<String, ChangeKind> {
    changed_keys_with(old_obj, new_obj, |a, b| a == b)
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

pub fn map_values<V, W>(obj: &IndexMap<String, V>, f: impl Fn(&V, &str) -> W) -> IndexMap<String, W> {
    obj.iter().map(|(k, v)| (k.clone(), f(v, k))).collect()
}

pub fn filter<V: Clone>(obj: &IndexMap<String, V>, cb: impl Fn(&str, &V) -> bool) -> IndexMap<String, V> {
    obj.iter().filter(|(k, v)| cb(k, v)).map(|(k, v)| (k.clone(), v.clone())).collect()
}

/// Removes keys whose value is JSON null.
pub fn compact(obj: &Map<String, Value>) -> Map<String, Value> {
    obj.iter().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k.clone(), v.clone())).collect()
}

/// Entries for `sorted_keys` first (a missing key gives `None`, like JS `undefined`), then the rest in order.
pub fn sorted_by_keys<V: Clone>(obj: &IndexMap<String, V>, sorted_keys: &[String]) -> Vec<(String, Option<V>)> {
    let mut copy = obj.clone();
    let mut arr = Vec::new();
    for k in sorted_keys {
        arr.push((k.clone(), copy.shift_remove(k)));
    }
    for (k, v) in copy {
        arr.push((k, Some(v)));
    }
    arr
}

/// Object restricted to `the_keys`, in the object's own key order. Non-objects give `{}`.
pub fn pick(obj: &Value, the_keys: &[&str]) -> Value {
    filter_obj(obj, |k| the_keys.contains(&k))
}

/// Object without `the_keys`.
pub fn omit(obj: &Value, the_keys: &[&str]) -> Value {
    filter_obj(obj, |k| !the_keys.contains(&k))
}

fn filter_obj(obj: &Value, keep: impl Fn(&str) -> bool) -> Value {
    let mut out = Map::new();
    if let Value::Object(m) = obj {
        for (k, v) in m {
            if keep(k) {
                out.insert(k.clone(), v.clone());
            }
        }
    }
    Value::Object(out)
}

/// Unique keys of both, first object's keys first.
pub fn combined_keys<V, W>(obj1: &IndexMap<String, V>, obj2: &IndexMap<String, W>) -> Vec<String> {
    let mut out: Vec<String> = obj1.keys().cloned().collect();
    for k in obj2.keys() {
        if !out.contains(k) {
            out.push(k.clone());
        }
    }
    out
}

/// Largest value, at least 0.
pub fn find_max_value(obj: &IndexMap<String, f64>) -> f64 {
    obj.values().fold(0.0, |memo, v| if *v > memo { *v } else { memo })
}

pub fn find_key_by_expression<V>(obj: &IndexMap<String, V>, expression: impl Fn(&str, &V) -> bool) -> Option<String> {
    obj.iter().find(|(k, v)| expression(k, v)).map(|(k, _)| k.clone())
}

/// Deep copy. In Rust this is just `Clone`.
pub fn clone<T: Clone>(v: &T) -> T {
    v.clone()
}

/// Later pairs win; keys end up in JS enumeration order.
pub fn from_array<V>(arr: Vec<(String, V)>) -> IndexMap<String, V> {
    js_order_keys(arr.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Expected values derived by running the real ObjectUtils_* functions in deno.

    fn im(pairs: &[(&str, i32)]) -> IndexMap<String, i32> {
        pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    }

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

    #[test]
    fn paths() {
        assert_eq!(
            diff_paths(&json!({"a":1,"b":{"c":2,"d":[1,2]},"e":3}), &json!({"a":1,"b":{"c":3,"d":[1,5,6]},"f":1})),
            vec!["e", "f", "b.c", "b.d.1", "b.d.2"]
        );
        assert_eq!(diff_paths(&json!({"a":{"b":1}}), &json!({"a":2})), vec!["a"]);
        assert!(diff_paths(&json!({"a":1}), &json!({"a":1})).is_empty());
    }

    #[test]
    fn changes() {
        let old = im(&[("a", 1), ("b", 2), ("c", 3)]);
        let new = im(&[("b", 2), ("c", 4), ("d", 5), ("1", 1)]);
        let ch = changed_keys(&old, &new);
        let got: Vec<(&str, ChangeKind)> = ch.iter().map(|(k, v)| (k.as_str(), *v)).collect();
        assert_eq!(
            got,
            vec![("1", ChangeKind::Add), ("c", ChangeKind::Update), ("d", ChangeKind::Add), ("a", ChangeKind::Delete)]
        );
        let d = diff(&old, &new);
        assert_eq!(d.iter().map(|(k, v)| (k.as_str(), *v)).collect::<Vec<_>>(), vec![("1", 1), ("c", 4), ("d", 5)]);
        // with a reference-like eq, equal values still report update (TS === on objects)
        let ch = changed_keys_with(&old, &old, |_, _| false);
        assert_eq!(ch.len(), 3);
    }

    #[test]
    fn maps() {
        let o = im(&[("a", 1), ("b", 2), ("c", 3)]);
        assert_eq!(map_values(&o, |x, k| format!("{}{}", x * 2, k))["b"], "4b");
        assert_eq!(filter(&o, |_, v| *v > 1), im(&[("b", 2), ("c", 3)]));
        assert_eq!(keys(&o), vec!["a", "b", "c"]);
        assert_eq!(values(&o), vec![1, 2, 3]);
        assert_eq!(entries(&im(&[("a", 1)])), vec![("a".to_string(), 1)]);
        assert!(is_empty(&im(&[])));
        assert!(is_not_empty(&o));
        assert_eq!(combined_keys(&im(&[("a", 1), ("b", 2)]), &im(&[("b", 1), ("c", 2)])), vec!["a", "b", "c"]);
        assert_eq!(find_key_by_expression(&o, |_, v| *v >= 2), Some("b".to_string()));
        assert_eq!(find_key_by_expression(&o, |_, v| *v > 9), None);
        let m: IndexMap<String, f64> = [("a".to_string(), 1.0), ("b".to_string(), 5.0)].into_iter().collect();
        assert_eq!(find_max_value(&m), 5.0);
        let neg: IndexMap<String, f64> = [("a".to_string(), -1.0)].into_iter().collect();
        assert_eq!(find_max_value(&neg), 0.0);
        assert_eq!(clone(&o), o);
    }

    #[test]
    fn value_objects() {
        let v = json!({"a":1,"b":null,"c":"x"});
        let m = v.as_object().cloned().unwrap_or_default();
        assert_eq!(Value::Object(compact(&m)), json!({"a":1,"c":"x"}));
        assert_eq!(pick(&json!({"a":1,"b":2,"c":3}), &["c", "a"]), json!({"a":1,"c":3}));
        assert_eq!(omit(&json!({"a":1,"b":2,"c":3}), &["b"]), json!({"a":1,"c":3}));
        assert_eq!(pick(&json!(5), &["a"]), json!({}));
    }

    #[test]
    fn ordering() {
        let o = im(&[("a", 1), ("b", 2), ("c", 3)]);
        let s = sorted_by_keys(&o, &["c".to_string(), "z".to_string(), "a".to_string(), "a".to_string()]);
        assert_eq!(
            s,
            vec![
                ("c".to_string(), Some(3)),
                ("z".to_string(), None),
                ("a".to_string(), Some(1)),
                ("a".to_string(), None),
                ("b".to_string(), Some(2))
            ]
        );
        let f = from_array(vec![("b".to_string(), 1), ("2".to_string(), 2), ("a".to_string(), 3), ("b".to_string(), 4)]);
        assert_eq!(f.iter().map(|(k, v)| (k.as_str(), *v)).collect::<Vec<_>>(), vec![("2", 2), ("b", 4), ("a", 3)]);
    }
}
