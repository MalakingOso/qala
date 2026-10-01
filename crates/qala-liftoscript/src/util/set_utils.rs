//! `utils/setUtils.ts`.

use indexmap::IndexSet;
use std::hash::Hash;

pub fn are_equal<T: Hash + Eq>(a: &IndexSet<T>, b: &IndexSet<T>) -> bool {
    a.len() == b.len() && a.iter().all(|item| b.contains(item))
}

pub fn are_all_equal<T: Hash + Eq>(sets: &[IndexSet<T>]) -> bool {
    if sets.len() < 2 {
        return true;
    }
    sets[1..].iter().all(|s| are_equal(&sets[0], s))
}

pub fn contains_any_values<T: Hash + Eq>(within: &IndexSet<T>, from: &IndexSet<T>) -> bool {
    from.iter().any(|item| within.contains(item))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[i32]) -> IndexSet<i32> {
        v.iter().copied().collect()
    }

    // Expected values follow directly from the TS definitions (checked in deno).
    #[test]
    fn set_ops() {
        assert!(are_equal(&s(&[1, 2]), &s(&[2, 1])));
        assert!(!are_equal(&s(&[1, 2]), &s(&[1, 3])));
        assert!(!are_equal(&s(&[1]), &s(&[1, 2])));
        assert!(are_all_equal::<i32>(&[]));
        assert!(are_all_equal(&[s(&[1])]));
        assert!(are_all_equal(&[s(&[1, 2]), s(&[2, 1]), s(&[1, 2])]));
        assert!(!are_all_equal(&[s(&[1, 2]), s(&[2, 1]), s(&[1, 3])]));
        assert!(contains_any_values(&s(&[1, 2]), &s(&[2, 9])));
        assert!(!contains_any_values(&s(&[1, 2]), &s(&[8, 9])));
        assert!(!contains_any_values(&s(&[1, 2]), &s(&[])));
    }
}
