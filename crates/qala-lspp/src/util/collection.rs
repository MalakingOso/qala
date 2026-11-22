//! `utils/collection.ts`. Key accessors are closures. Results that JS builds
//! as plain objects are `IndexMap<String, _>` reordered like `Object.keys`
//! (integer-like keys first). All sorting goes through `js_sort_by`.

use crate::js::{js_number_to_string, js_order_keys, js_sort_by};
use indexmap::IndexMap;



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

/// Sorted copy. `cmp` is a JS style comparator (negative, zero, positive; NaN counts as zero).
pub fn sort<T: Clone>(arr: &[T], cmp: impl FnMut(&T, &T) -> f64) -> Vec<T> {
    js_sort_by(arr.to_vec(), cmp)
}

pub fn sort_by<T: Clone>(arr: &[T], key: impl Fn(&T) -> f64, is_reverse: bool) -> Vec<T> {
    js_sort_by(arr.to_vec(), |a, b| {
        let (x, y) = (key(a), key(b));
        if is_reverse { y - x } else { x - y }
    })
}

/// Index of the last item matching, or -1.
pub fn find_index_reverse<T>(from: &[T], cb: impl Fn(&T) -> bool) -> i64 {
    from.iter().rposition(cb).map(|i| i as i64).unwrap_or(-1)
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

#[cfg(test)]
mod tests {
    use super::*;

    // Expected values were derived by running the real CollectionUtils_* functions in V8
    // (scratch script importing the deleted TS liftoscript/src/utils/collection.ts) and printing JSON.

    #[test]
    fn compress() {
        assert_eq!(compress_array(&[45.0, 45.0, 45.0, 25.0, 25.0, 10.0, 10.0, 10.0, 10.0], 3), vec!["3x45", "25", "25", "4x10"]);
        assert_eq!(compress_array(&[5.0, 5.0, 5.0], 3), vec!["3x5"]);
        assert_eq!(compress_array(&[1.5, 2.0], 2), vec!["1.5", "2"]);
        assert!(compress_array(&[], 2).is_empty());
    }
}
