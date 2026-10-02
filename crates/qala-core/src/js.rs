//! JavaScript number semantics the TS engine relies on, and serde helpers that make the JSON
//! text match what `JSON.stringify` writes for numbers.
//!
//! The engine was written in TS, so the port keeps JS behaviour wherever a result can differ:
//! `Math.round` rounds halves toward +infinity, `Math.min` and `Math.max` propagate NaN, and
//! `JSON.stringify` writes an integral double without a fraction (`4`, never `4.0`).

use serde::ser::{SerializeMap, SerializeSeq, Serializer};
use std::collections::BTreeMap;

/// `Math.round`: halves round toward +infinity, so `-2.5` becomes `-2` (Rust's `f64::round`
/// gives `-3`). This is `(x + 0.5).floor()` computed without the addition, which can round up
/// for `0.49999999999999994` and for odd integers at or beyond 2^52. NaN and infinities pass
/// through. A result of zero is always `+0` (JS gives `-0` for inputs in `[-0.5, 0)`; both print
/// as `0` in JSON and compare equal).
pub fn js_round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

/// `Math.max(a, b)`: NaN if either side is NaN (Rust's `f64::max` would drop it).
pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b || (a == b && b.is_sign_negative()) {
        // `Math.max(-0, 0)` is `0`, so a negative-signed zero loses to a positive one.
        a
    } else {
        b
    }
}

/// `Math.min(a, b)`: NaN if either side is NaN (Rust's `f64::min` would drop it).
pub fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b || (a == b && a.is_sign_negative()) {
        // `Math.min(0, -0)` is `-0`.
        a
    } else {
        b
    }
}

/// JS truthiness of a number: false for 0, -0 and NaN.
pub fn js_truthy(x: f64) -> bool {
    x != 0.0 && !x.is_nan()
}

/// `Number.isInteger`: finite with no fractional part.
pub fn js_is_integer(x: f64) -> bool {
    x.is_finite() && x.fract() == 0.0
}

/// True for the characters JS `\s` matches (differs from `char::is_whitespace` on U+0085 and
/// U+FEFF).
pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{9}'
            | '\u{a}'
            | '\u{b}'
            | '\u{c}'
            | '\u{d}'
            | '\u{20}'
            | '\u{a0}'
            | '\u{1680}'
            | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

// ---------------------------------------------------------------------------
// serde helpers: write numbers the way JSON.stringify does
// ---------------------------------------------------------------------------

/// Integral values below 2^53 are written as integers (`-0` as `0`), everything else as an f64.
/// Non-finite values become `null`, as in `JSON.stringify`.
pub fn ser_num<S: Serializer>(x: &f64, s: S) -> Result<S::Ok, S::Error> {
    if x.is_finite() && x.fract() == 0.0 && x.abs() < 9_007_199_254_740_992.0 {
        s.serialize_i64(*x as i64)
    } else {
        s.serialize_f64(*x)
    }
}

/// [`ser_num`] for an `Option<f64>` field that is also skipped when `None`.
pub fn ser_opt_num<S: Serializer>(x: &Option<f64>, s: S) -> Result<S::Ok, S::Error> {
    match x {
        Some(v) => ser_num(v, s),
        None => s.serialize_none(),
    }
}

struct Num<'a>(&'a f64);

impl serde::Serialize for Num<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        ser_num(self.0, s)
    }
}

/// [`ser_num`] for every element of a `Vec<f64>`.
pub fn ser_num_vec<S: Serializer>(xs: &[f64], s: S) -> Result<S::Ok, S::Error> {
    let mut seq = s.serialize_seq(Some(xs.len()))?;
    for x in xs {
        seq.serialize_element(&Num(x))?;
    }
    seq.end()
}

/// [`ser_num`] for every value of a `BTreeMap<String, f64>`.
pub fn ser_num_map<S: Serializer>(m: &BTreeMap<String, f64>, s: S) -> Result<S::Ok, S::Error> {
    let mut map = s.serialize_map(Some(m.len()))?;
    for (k, v) in m {
        map.serialize_entry(k, &Num(v))?;
    }
    map.end()
}

/// [`ser_num_map`] for an optional map that is skipped when `None`.
pub fn ser_opt_num_map<S: Serializer>(
    m: &Option<BTreeMap<String, f64>>,
    s: S,
) -> Result<S::Ok, S::Error> {
    match m {
        Some(m) => ser_num_map(m, s),
        None => s.serialize_none(),
    }
}

/// [`ser_num`] for a 3x3 matrix.
pub fn ser_matrix3<S: Serializer>(m: &[[f64; 3]; 3], s: S) -> Result<S::Ok, S::Error> {
    let mut seq = s.serialize_seq(Some(3))?;
    for row in m {
        seq.serialize_element(&Row3(row))?;
    }
    seq.end()
}

struct Row3<'a>(&'a [f64; 3]);

impl serde::Serialize for Row3<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        ser_num_vec(self.0, s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_halves_go_toward_positive_infinity() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(1.5), 2.0);
        assert_eq!(js_round(0.5), 1.0);
        assert_eq!(js_round(-0.5), 0.0);
        assert_eq!(js_round(-1.5), -1.0);
        assert_eq!(js_round(-2.5), -2.0);
        // The case the spike hit: Rust's round() gives -6.0 here.
        assert_eq!(js_round(-6.5), -6.0);
        assert_eq!(js_round(-6.25), -6.0);
        assert_eq!(js_round(-6.75), -7.0);
        assert_eq!(js_round(2.4999999999999996), 2.0);
        assert_eq!(js_round(7.0), 7.0);
    }

    #[test]
    fn round_edge_values() {
        assert!(js_round(f64::NAN).is_nan());
        assert_eq!(js_round(f64::INFINITY), f64::INFINITY);
        assert_eq!(js_round(f64::NEG_INFINITY), f64::NEG_INFINITY);
        assert_eq!(js_round(-0.2), 0.0);
        assert_eq!(js_round(0.2), 0.0);
        assert_eq!(js_round(-0.0), 0.0);
        // Beyond 2^52 every double is an integer already.
        let big = 4_503_599_627_370_497.0;
        assert_eq!(js_round(big), big);
        assert_eq!(js_round(-big), -big);
        // (x + 0.5).floor() would give 1 here because x + 0.5 rounds up to 1.0.
        assert_eq!(js_round(0.49999999999999994), 0.0);
        assert_eq!(js_round(-0.49999999999999994), 0.0);
    }

    #[test]
    fn min_max_propagate_nan_and_order_zeros() {
        assert!(js_max(f64::NAN, 1.0).is_nan());
        assert!(js_max(1.0, f64::NAN).is_nan());
        assert!(js_min(f64::NAN, 1.0).is_nan());
        assert!(js_min(1.0, f64::NAN).is_nan());
        assert_eq!(js_max(1.0, 2.0), 2.0);
        assert_eq!(js_max(2.0, 1.0), 2.0);
        assert_eq!(js_min(1.0, 2.0), 1.0);
        assert_eq!(js_min(2.0, 1.0), 1.0);
        assert!(js_max(-0.0, 0.0).is_sign_positive());
        assert!(js_max(0.0, -0.0).is_sign_positive());
        assert!(js_min(0.0, -0.0).is_sign_negative());
        assert!(js_min(-0.0, 0.0).is_sign_negative());
        assert_eq!(js_max(f64::NEG_INFINITY, f64::INFINITY), f64::INFINITY);
    }

    #[test]
    fn truthiness_and_integers() {
        assert!(!js_truthy(0.0));
        assert!(!js_truthy(-0.0));
        assert!(!js_truthy(f64::NAN));
        assert!(js_truthy(0.1));
        assert!(js_truthy(-3.0));
        assert!(js_is_integer(5.0));
        assert!(js_is_integer(-0.0));
        assert!(!js_is_integer(5.5));
        assert!(!js_is_integer(f64::INFINITY));
        assert!(!js_is_integer(f64::NAN));
    }

    #[test]
    fn whitespace_matches_js_regex_class() {
        assert!(is_js_whitespace(' '));
        assert!(is_js_whitespace('\t'));
        assert!(is_js_whitespace('\u{a0}'));
        assert!(is_js_whitespace('\u{feff}'));
        assert!(!is_js_whitespace('\u{85}'));
        assert!(!is_js_whitespace('_'));
        assert!(!is_js_whitespace('a'));
    }

    #[derive(serde::Serialize)]
    struct Probe {
        #[serde(serialize_with = "ser_num")]
        a: f64,
        #[serde(serialize_with = "ser_num")]
        b: f64,
        #[serde(serialize_with = "ser_num")]
        c: f64,
        #[serde(serialize_with = "ser_num")]
        d: f64,
        #[serde(serialize_with = "ser_num_vec")]
        v: Vec<f64>,
        #[serde(serialize_with = "ser_num_map")]
        m: BTreeMap<String, f64>,
        #[serde(serialize_with = "ser_matrix3")]
        p: [[f64; 3]; 3],
    }

    #[test]
    fn numbers_serialize_like_json_stringify() {
        let mut m = BTreeMap::new();
        m.insert("x".to_string(), 3.0);
        m.insert("y".to_string(), 0.25);
        let probe = Probe {
            a: 4.0,
            b: -0.0,
            c: 1.5,
            d: f64::NAN,
            v: vec![1.0, 2.5],
            m,
            p: [[10000.0, 0.0, 0.0], [0.0, 1000.0, 0.0], [0.0, 0.0, 1.0]],
        };
        let text = serde_json::to_string(&probe).unwrap();
        assert_eq!(
            text,
            r#"{"a":4,"b":0,"c":1.5,"d":null,"v":[1,2.5],"m":{"x":3,"y":0.25},"p":[[10000,0,0],[0,1000,0],[0,0,1]]}"#
        );
    }
}
