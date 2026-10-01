//! `utils/collection.ts`. Key accessors are closures. Results that JS builds
//! as plain objects are `IndexMap<String, _>` reordered like `Object.keys`
//! (integer-like keys first). All sorting goes through `js_sort_by`.

use crate::js::{js_locale_compare, js_number_to_string, js_order_keys, js_sort_by};
use indexmap::{IndexMap, IndexSet};
use std::hash::Hash;

pub fn in_groups_of<T: Clone>(length: usize, collection: &[T]) -> Vec<Vec<T>> {
    if collection.is_empty() {
        return Vec::new();
    }
    let mut result: Vec<Vec<T>> = vec![Vec::new()];
    for item in collection {
        let full = result.last().map(|l| l.len() >= length).unwrap_or(false);
        if full {
            result.push(Vec::new());
        }
        if let Some(last) = result.last_mut() {
            last.push(item.clone());
        }
    }
    result
}

/// With zero groups the TS throws; this returns an empty vector.
pub fn split_into_n_groups<T: Clone>(coll: &[T], number_of_groups: usize) -> Vec<Vec<T>> {
    let mut result: Vec<Vec<T>> = vec![Vec::new(); number_of_groups];
    if number_of_groups == 0 {
        return result;
    }
    for (i, item) in coll.iter().enumerate() {
        result[i % number_of_groups].push(item.clone());
    }
    result
}

/// Pads only the last group up to `length` with `None`, like the TS.
pub fn in_groups_of_filled<T: Clone>(length: usize, collection: &[T]) -> Vec<Vec<Option<T>>> {
    let mut result: Vec<Vec<Option<T>>> = in_groups_of(length, collection)
        .into_iter()
        .map(|g| g.into_iter().map(Some).collect())
        .collect();
    if let Some(last) = result.last_mut() {
        while last.len() < length {
            last.push(None);
        }
    }
    result
}

/// Starts a new group whenever `cond(last_in_group, item)` is true. Empty input gives `[[]]`, as in the TS.
pub fn group_by<T: Clone>(items: &[T], mut cond: impl FnMut(&T, &T) -> bool) -> Vec<Vec<T>> {
    let mut memo: Vec<Vec<T>> = vec![Vec::new()];
    for item in items {
        let start_new = memo
            .last()
            .and_then(|g| g.last())
            .map(|last| cond(last, item))
            .unwrap_or(false);
        if start_new {
            memo.push(Vec::new());
        }
        if let Some(g) = memo.last_mut() {
            g.push(item.clone());
        }
    }
    memo
}

pub fn repeat<T: Clone>(el: &T, length: usize) -> Vec<T> {
    vec![el.clone(); length]
}

fn by_key<T: Clone>(items: impl Iterator<Item = T>, condition: impl Fn(&T) -> String) -> Vec<T> {
    let mut map: IndexMap<String, T> = IndexMap::new();
    for item in items {
        map.insert(condition(&item), item);
    }
    js_order_keys(map).into_values().collect()
}

/// Later items replace earlier ones with the same key but keep the first position.
pub fn concat_by<T: Clone>(from: &[T], to: &[T], condition: impl Fn(&T) -> String) -> Vec<T> {
    by_key(from.iter().chain(to.iter()).cloned(), condition)
}

/// `CollectionUtils_compatBy` (sic): dedupe by key, last wins.
pub fn compat_by<T: Clone>(arr: &[T], condition: impl Fn(&T) -> String) -> Vec<T> {
    by_key(arr.iter().cloned(), condition)
}

/// Drops `None`. The TS drops every falsy value; callers with numbers or strings filter 0 and "" themselves.
pub fn compact<T>(arr: Vec<Option<T>>) -> Vec<T> {
    arr.into_iter().flatten().collect()
}

/// Same as [`compact`].
pub fn nonnull<T>(from: Vec<Option<T>>) -> Vec<T> {
    from.into_iter().flatten().collect()
}

pub fn group_by_expr<T: Clone>(arr: &[T], expr: impl Fn(&T) -> String) -> IndexMap<String, Vec<T>> {
    let mut memo: IndexMap<String, Vec<T>> = IndexMap::new();
    for item in arr {
        memo.entry(expr(item)).or_default().push(item.clone());
    }
    js_order_keys(memo)
}

/// `groupByKey`: `key` returns the field already converted to its JS property string.
pub fn group_by_key<T: Clone>(arr: &[T], key: impl Fn(&T) -> String) -> IndexMap<String, Vec<T>> {
    group_by_expr(arr, key)
}

pub fn group_by_expr_uniq<T: Clone>(arr: &[T], expr: impl Fn(&T) -> String) -> IndexMap<String, T> {
    let mut memo: IndexMap<String, T> = IndexMap::new();
    for item in arr {
        memo.insert(expr(item), item.clone());
    }
    js_order_keys(memo)
}

pub fn group_by_key_uniq<T: Clone>(arr: &[T], key: impl Fn(&T) -> String) -> IndexMap<String, T> {
    group_by_expr_uniq(arr, key)
}

pub fn collect_to_set<T, K: Hash + Eq>(arr: &[T], key: impl Fn(&T) -> K) -> IndexSet<K> {
    arr.iter().map(key).collect()
}

pub fn collect_to_set_transform<T, K, U: Hash + Eq>(
    arr: &[T],
    key: impl Fn(&T) -> K,
    transformer: impl Fn(K) -> U,
) -> IndexSet<U> {
    arr.iter().map(|e| transformer(key(e))).collect()
}

pub fn flat<T: Clone>(from: &[Vec<T>]) -> Vec<T> {
    from.iter().flat_map(|v| v.iter().cloned()).collect()
}

/// Sorted copy. `cmp` is a JS style comparator (negative, zero, positive; NaN counts as zero).
pub fn sort<T: Clone>(arr: &[T], cmp: impl FnMut(&T, &T) -> f64) -> Vec<T> {
    js_sort_by(arr.to_vec(), cmp)
}

pub fn immutable_sort<T: Clone>(arr: &[T], mut compare: impl FnMut(&T, &T) -> f64) -> Vec<T> {
    for i in 1..arr.len() {
        if compare(&arr[i - 1], &arr[i]) > 0.0 {
            return js_sort_by(arr.to_vec(), compare);
        }
    }
    arr.to_vec()
}

/// Moves the item at `start` to `end`. With `start` out of range the TS would
/// insert `undefined`; this returns the input unchanged. `end` is clamped.
pub fn reorder<T: Clone>(arr: &[T], start: usize, end: usize) -> Vec<T> {
    let mut v = arr.to_vec();
    if start >= v.len() {
        return v;
    }
    let item = v.remove(start);
    let at = end.min(v.len());
    v.insert(at, item);
    v
}

/// Items whose key is not in `order` go last; `-1` handling copied from the TS comparator.
pub fn sort_in_order<T: Clone, K: PartialEq>(arr: &[T], key: impl Fn(&T) -> K, order: &[K]) -> Vec<T> {
    js_sort_by(arr.to_vec(), |a, b| {
        let ai = order.iter().position(|k| *k == key(a));
        let bi = order.iter().position(|k| *k == key(b));
        match (ai, bi) {
            (None, _) => 1.0,
            (_, None) => -1.0,
            (Some(x), Some(y)) => x as f64 - y as f64,
        }
    })
}

/// A dynamically typed sort key for [`sort_by_multiple`].
#[derive(Debug, Clone, PartialEq)]
pub enum SortVal {
    Num(f64),
    Str(String),
    Bool(bool),
    Null,
}

/// `sortByMultiple`. String keys use [`js_locale_compare`], an approximation of `localeCompare`.
pub fn sort_by_multiple<T: Clone>(arr: &[T], keys: &[&dyn Fn(&T) -> SortVal], is_reverse: bool) -> Vec<T> {
    js_sort_by(arr.to_vec(), |a, b| {
        for key in keys {
            let av = key(a);
            let bv = key(b);
            if av == bv {
                continue;
            }
            match (&av, &bv) {
                (SortVal::Num(x), SortVal::Num(y)) => return if is_reverse { y - x } else { x - y },
                (SortVal::Str(x), SortVal::Str(y)) => {
                    return if is_reverse { js_locale_compare(y, x) } else { js_locale_compare(x, y) }
                }
                (SortVal::Bool(x), SortVal::Bool(y)) => {
                    return if is_reverse {
                        if *y { -1.0 } else { 1.0 }
                    } else if *x {
                        -1.0
                    } else {
                        1.0
                    }
                }
                _ => {
                    let a_null = matches!(av, SortVal::Null);
                    let b_null = matches!(bv, SortVal::Null);
                    if a_null || b_null {
                        return if is_reverse {
                            if b_null { -1.0 } else { 1.0 }
                        } else if a_null {
                            -1.0
                        } else {
                            1.0
                        };
                    }
                }
            }
        }
        0.0
    })
}

pub fn sort_by<T: Clone>(arr: &[T], key: impl Fn(&T) -> f64, is_reverse: bool) -> Vec<T> {
    js_sort_by(arr.to_vec(), |a, b| {
        let (x, y) = (key(a), key(b));
        if is_reverse { y - x } else { x - y }
    })
}

pub fn sort_by_expr<T: Clone>(arr: &[T], f: impl Fn(&T) -> f64, is_reverse: bool) -> Vec<T> {
    sort_by(arr, f, is_reverse)
}

/// Symmetric difference, first the items only in `from`, then the items only in `to`.
pub fn diff<T: Clone + PartialEq>(from: &[T], to: &[T]) -> Vec<T> {
    from.iter()
        .filter(|x| !to.contains(x))
        .chain(to.iter().filter(|x| !from.contains(x)))
        .cloned()
        .collect()
}

pub fn diff_by<T: Clone, K: PartialEq>(from: &[T], to: &[T], key: impl Fn(&T) -> K) -> Vec<T> {
    from.iter()
        .filter(|x| !to.iter().any(|y| key(x) == key(y)))
        .chain(to.iter().filter(|x| !from.iter().any(|y| key(x) == key(y))))
        .cloned()
        .collect()
}

pub fn remove<T: Clone + PartialEq>(from: &[T], item: &T) -> Vec<T> {
    from.iter().filter(|t| *t != item).cloned().collect()
}

pub fn remove_all<T: Clone + PartialEq>(from: &[T], items: &[T]) -> Vec<T> {
    from.iter().filter(|t| !items.contains(t)).cloned().collect()
}

/// Out of range indexes remove nothing.
pub fn remove_at<T: Clone>(from: &[T], index: usize) -> Vec<T> {
    let mut v = from.to_vec();
    if index < v.len() {
        v.remove(index);
    }
    v
}

pub fn set_at<T: Clone>(from: &[T], index: usize, item: &T) -> Vec<T> {
    from.iter()
        .enumerate()
        .map(|(i, e)| if i == index { item.clone() } else { e.clone() })
        .collect()
}

pub fn set_by<T: Clone, K: PartialEq>(from: &[T], key: impl Fn(&T) -> K, value: &K, new_item: &T) -> Vec<T> {
    from.iter()
        .map(|e| if key(e) == *value { new_item.clone() } else { e.clone() })
        .collect()
}

pub fn set_or_add_by<T: Clone, K: PartialEq>(from: &[T], key: impl Fn(&T) -> K, value: &K, new_item: &T) -> Vec<T> {
    if from.iter().any(|e| key(e) == *value) {
        set_by(from, key, value, new_item)
    } else {
        let mut v = from.to_vec();
        v.push(new_item.clone());
        v
    }
}

pub fn remove_by<T: Clone, K: PartialEq>(from: &[T], key: impl Fn(&T) -> K, value: &K) -> Vec<T> {
    from.iter().filter(|t| key(t) != *value).cloned().collect()
}

pub fn uniq_by<T: Clone, K: PartialEq>(from: &[T], key: impl Fn(&T) -> K) -> Vec<T> {
    uniq_by_expr(from, key)
}

pub fn uniq_by_expr<T: Clone, V: PartialEq>(from: &[T], f: impl Fn(&T) -> V) -> Vec<T> {
    let mut seen: Vec<V> = Vec::new();
    let mut result = Vec::new();
    for el in from {
        let id = f(el);
        if !seen.contains(&id) {
            result.push(el.clone());
            seen.push(id);
        }
    }
    result
}

pub fn find_by<T: Clone, K: PartialEq>(from: &[T], key: impl Fn(&T) -> K, value: &K) -> Option<T> {
    from.iter().find(|e| key(e) == *value).cloned()
}

/// Index of the last item matching, or -1.
pub fn find_index_reverse<T>(from: &[T], cb: impl Fn(&T) -> bool) -> i64 {
    from.iter().rposition(cb).map(|i| i as i64).unwrap_or(-1)
}

/// Union keeping first occurrences (`Array.from(new Set([...from, ...to]))`).
pub fn merge<T: Clone + Hash + Eq>(from: &[T], to: &[T]) -> Vec<T> {
    let set: IndexSet<T> = from.iter().chain(to.iter()).cloned().collect();
    set.into_iter().collect()
}

/// Run-length compress: runs of `threshold` or more become "NxV".
pub fn compress_array(arr: &[f64], threshold: usize) -> Vec<String> {
    let mut result = Vec::new();
    let mut count = 1usize;
    for i in 1..=arr.len() {
        if arr.get(i) == arr.get(i - 1) {
            count += 1;
        } else {
            let v = js_number_to_string(arr[i - 1]);
            if count >= threshold {
                result.push(format!("{}x{}", count, v));
            } else {
                while count > 0 {
                    result.push(v.clone());
                    count -= 1;
                }
            }
            count = 1;
        }
    }
    result
}

pub fn are_sorted_in_same_order<T, U>(coll1: &[T], coll2: &[U], are_equal: impl Fn(&T, &U) -> bool) -> bool {
    coll1.len() == coll2.len() && coll1.iter().zip(coll2).all(|(a, b)| are_equal(a, b))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected values were derived by running the real CollectionUtils_* functions in deno
    // (scratch script importing packages/liftoscript/src/utils/collection.ts) and printing JSON.

    #[derive(Clone, Debug, PartialEq)]
    struct K {
        k: &'static str,
        v: i32,
    }
    fn k(k: &'static str, v: i32) -> K {
        K { k, v }
    }
    fn cmp(a: &i32, b: &i32) -> f64 {
        (a - b) as f64
    }

    #[test]
    fn grouping() {
        assert_eq!(in_groups_of(3, &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), vec![vec![1, 2, 3], vec![4, 5, 6], vec![7, 8, 9], vec![10]]);
        assert!(in_groups_of::<i32>(3, &[]).is_empty());
        assert_eq!(split_into_n_groups(&[1, 2, 3, 4, 5, 6, 7], 3), vec![vec![1, 4, 7], vec![2, 5], vec![3, 6]]);
        assert!(split_into_n_groups(&[1], 0).is_empty());
        assert_eq!(in_groups_of_filled(3, &[1, 2, 3, 4, 5]), vec![vec![Some(1), Some(2), Some(3)], vec![Some(4), Some(5), None]]);
        assert_eq!(in_groups_of_filled(3, &[1, 2, 3]), vec![vec![Some(1), Some(2), Some(3)]]);
        assert_eq!(group_by(&[1, 1, 2, 2, 2, 3, 1], |l, i| l != i), vec![vec![1, 1], vec![2, 2, 2], vec![3], vec![1]]);
        assert_eq!(group_by::<i32>(&[], |l, i| l != i), vec![Vec::<i32>::new()]);
        assert_eq!(repeat(&7, 3), vec![7, 7, 7]);
        assert_eq!(flat(&[vec![1], vec![2, 3], vec![]]), vec![1, 2, 3]);
    }

    #[test]
    fn keyed() {
        assert_eq!(concat_by(&[k("b", 1), k("a", 2)], &[k("b", 3), k("c", 4)], |e| e.k.to_string()), vec![k("b", 3), k("a", 2), k("c", 4)]);
        // integer-like keys enumerate first
        assert_eq!(
            concat_by(&[k("b", 1), k("10", 2)], &[k("2", 3), k("a", 4), k("10", 5)], |e| e.k.to_string()),
            vec![k("2", 3), k("10", 5), k("b", 1), k("a", 4)]
        );
        assert_eq!(compat_by(&[k("x", 1), k("7", 2), k("x", 3)], |e| e.k.to_string()), vec![k("7", 2), k("x", 3)]);
        let g = group_by_key(&[k("2", 1), k("1", 2), k("2", 3)], |e| e.k.to_string());
        assert_eq!(g.keys().collect::<Vec<_>>(), vec!["1", "2"]);
        assert_eq!(g["2"], vec![k("2", 1), k("2", 3)]);
        let g = group_by_expr(&["apple", "bob", "avocado"], |s| s[..1].to_string());
        assert_eq!(g["a"], vec!["apple", "avocado"]);
        assert_eq!(g["b"], vec!["bob"]);
        let u = group_by_key_uniq(&[k("2", 1), k("1", 2), k("2", 3)], |e| e.k.to_string());
        assert_eq!(u["2"], k("2", 3));
        assert_eq!(u.keys().collect::<Vec<_>>(), vec!["1", "2"]);
        assert_eq!(collect_to_set(&[1, 2, 1], |x| *x).into_iter().collect::<Vec<_>>(), vec![1, 2]);
        assert_eq!(collect_to_set_transform(&[1, 2, 1], |x| *x, |x| x * 10).len(), 2);
        assert_eq!(compact(vec![Some(1), None, Some(2)]), vec![1, 2]);
        assert_eq!(nonnull(vec![None, Some("a")]), vec!["a"]);
    }

    #[test]
    fn sorting() {
        assert_eq!(sort(&[3, 1, 2, 10], cmp), vec![1, 2, 3, 10]);
        assert_eq!(immutable_sort(&[3, 1, 2], cmp), vec![1, 2, 3]);
        assert_eq!(immutable_sort(&[1, 2, 3], cmp), vec![1, 2, 3]);
        assert_eq!(reorder(&[1, 2, 3, 4, 5], 1, 3), vec![1, 3, 4, 2, 5]);
        assert_eq!(reorder(&[1, 2, 3, 4, 5], 4, 0), vec![5, 1, 2, 3, 4]);
        assert_eq!(reorder(&[1, 2, 3], 0, 10), vec![2, 3, 1]);
        assert_eq!(reorder(&[1, 2, 3], 7, 0), vec![1, 2, 3]);
        let order = ["a", "b", "c"];
        assert_eq!(sort_in_order(&["c", "a", "z", "b"], |s| *s, &order), vec!["a", "b", "c", "z"]);
        assert_eq!(sort_by(&[3, 1, 2], |x| *x as f64, false), vec![1, 2, 3]);
        assert_eq!(sort_by(&[3, 1, 2], |x| *x as f64, true), vec![3, 2, 1]);
        assert_eq!(sort_by_expr(&["ccc", "a", "bb"], |s| s.len() as f64, false), vec!["a", "bb", "ccc"]);
        // NaN keys do not panic
        let _ = sort_by(&[1.0, f64::NAN, 0.5], |x| *x, false);
    }

    #[test]
    #[allow(clippy::type_complexity)]
    fn sort_multiple() {
        let rows = [(1, 'x'), (1, 'b'), (0, 'z'), (2, 'a')];
        let ka = |r: &(i32, char)| SortVal::Num(r.0 as f64);
        let kb = |r: &(i32, char)| SortVal::Str(r.1.to_string());
        let keys: [&dyn Fn(&(i32, char)) -> SortVal; 2] = [&ka, &kb];
        assert_eq!(sort_by_multiple(&rows, &keys, false), vec![(0, 'z'), (1, 'b'), (1, 'x'), (2, 'a')]);
        assert_eq!(sort_by_multiple(&rows, &keys, true), vec![(2, 'a'), (1, 'x'), (1, 'b'), (0, 'z')]);
        let kbool = |r: &bool| SortVal::Bool(*r);
        let keys: [&dyn Fn(&bool) -> SortVal; 1] = [&kbool];
        assert_eq!(sort_by_multiple(&[false, true, false], &keys, false), vec![true, false, false]);
        let knull = |r: &Option<i32>| r.map(|x| SortVal::Num(x as f64)).unwrap_or(SortVal::Null);
        let keys: [&dyn Fn(&Option<i32>) -> SortVal; 1] = [&knull];
        assert_eq!(sort_by_multiple(&[Some(1), None, Some(0)], &keys, false), vec![None, Some(0), Some(1)]);
    }

    #[test]
    fn set_like() {
        assert_eq!(diff(&[1, 2, 3], &[2, 3, 4, 5]), vec![1, 4, 5]);
        assert_eq!(diff_by(&[k("1", 0), k("2", 0)], &[k("2", 0), k("3", 0)], |e| e.k), vec![k("1", 0), k("3", 0)]);
        assert_eq!(remove(&[1, 2, 1, 3], &1), vec![2, 3]);
        assert_eq!(remove_all(&[1, 2, 1, 3], &[1, 3]), vec![2]);
        assert_eq!(remove_at(&[1, 2, 3], 1), vec![1, 3]);
        assert_eq!(remove_at(&[1, 2, 3], 5), vec![1, 2, 3]);
        assert_eq!(set_at(&[1, 2, 3], 1, &9), vec![1, 9, 3]);
        assert_eq!(set_by(&[k("1", 1), k("2", 2)], |e| e.k, &"2", &k("2", 9)), vec![k("1", 1), k("2", 9)]);
        assert_eq!(set_or_add_by(&[k("1", 1)], |e| e.k, &"5", &k("5", 9)), vec![k("1", 1), k("5", 9)]);
        assert_eq!(set_or_add_by(&[k("1", 1)], |e| e.k, &"1", &k("1", 9)), vec![k("1", 9)]);
        assert_eq!(remove_by(&[k("1", 1), k("2", 2), k("1", 3)], |e| e.k, &"1"), vec![k("2", 2)]);
        assert_eq!(uniq_by(&[k("1", 1), k("2", 2), k("1", 3)], |e| e.k), vec![k("1", 1), k("2", 2)]);
        assert_eq!(uniq_by_expr(&[1, 2, 3, 4, 5], |x| x % 2), vec![1, 2]);
        assert_eq!(find_by(&[k("1", 1), k("1", 2)], |e| e.k, &"1"), Some(k("1", 1)));
        assert_eq!(find_by(&[k("1", 1)], |e| e.k, &"9"), None);
        assert_eq!(find_index_reverse(&[1, 2, 3, 2], |x| *x == 2), 3);
        assert_eq!(find_index_reverse(&[1], |x| *x == 2), -1);
        assert_eq!(merge(&[1, 2, 2], &[2, 3]), vec![1, 2, 3]);
        assert!(are_sorted_in_same_order(&[1, 2], &[1, 2], |a, b| a == b));
        assert!(!are_sorted_in_same_order(&[1, 2], &[2, 1], |a, b| a == b));
        assert!(!are_sorted_in_same_order(&[1], &[1, 2], |a, b| a == b));
    }

    #[test]
    fn compress() {
        assert_eq!(compress_array(&[45.0, 45.0, 45.0, 25.0, 25.0, 10.0, 10.0, 10.0, 10.0], 3), vec!["3x45", "25", "25", "4x10"]);
        assert_eq!(compress_array(&[5.0, 5.0, 5.0], 3), vec!["3x5"]);
        assert_eq!(compress_array(&[1.5, 2.0], 2), vec!["1.5", "2"]);
        assert!(compress_array(&[], 2).is_empty());
    }
}
