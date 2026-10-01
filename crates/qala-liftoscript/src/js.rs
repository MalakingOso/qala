//! JavaScript semantics helpers. The TS oracle runs on V8, so numbers, number
//! formatting, parsing, sorting and object key order must match it exactly.
//!
//! Expected values in the tests were produced with `deno eval` against the same
//! expressions (for example `(1.005).toFixed(2)`, `Math.round(-2.5)`).

use indexmap::IndexMap;

/// JS `WhiteSpace` plus `LineTerminator`, the set used by `trim`, `\s` and `Number()`.
pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}'
            | '\u{000A}'
            | '\u{000B}'
            | '\u{000C}'
            | '\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

/// `String.prototype.trim`.
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// `String.prototype.trimStart`.
pub fn js_trim_start(s: &str) -> &str {
    s.trim_start_matches(is_js_whitespace)
}

/// `String.prototype.trimEnd`.
pub fn js_trim_end(s: &str) -> &str {
    s.trim_end_matches(is_js_whitespace)
}

/// `Math.round`. Ties go toward +Infinity, so `-2.5 -> -2` and `2.5 -> 3`.
/// Uses the spec definition rather than `floor(x + 0.5)`, which is wrong for
/// 0.49999999999999994 (the addition rounds up to 1). Values in `[-0.5, 0)`
/// give `-0`, NaN and infinities pass through.
pub fn js_round(x: f64) -> f64 {
    if !x.is_finite() || x == x.trunc() {
        return x;
    }
    if (-0.5..0.0).contains(&x) {
        return -0.0;
    }
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

/// `Number.prototype.toString()` (radix 10). `-0` prints as "0".
pub fn js_number_to_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".to_string();
    }
    if x == 0.0 {
        return "0".to_string();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    let (neg, digits, n) = decompose(x);
    let k = digits.len() as i32;
    let mut out = String::new();
    if neg {
        out.push('-');
    }
    if k <= n && n <= 21 {
        out.push_str(&digits);
        for _ in 0..(n - k) {
            out.push('0');
        }
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        for _ in 0..(-n) {
            out.push('0');
        }
        out.push_str(&digits);
    } else {
        let e = n - 1;
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        out.push(if e < 0 { '-' } else { '+' });
        out.push_str(&e.abs().to_string());
    }
    out
}

/// Shortest round-trip digits of a finite non-zero float: (negative, digits, n)
/// where value = 0.digits * 10^n, matching the ECMAScript Number::toString setup.
fn decompose(x: f64) -> (bool, String, i32) {
    let s = format!("{:e}", x.abs());
    let (mant, exp) = match s.split_once('e') {
        Some(p) => p,
        None => (s.as_str(), "0"),
    };
    let exp: i32 = exp.parse().unwrap_or(0);
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    (x < 0.0, digits, exp + 1)
}

/// `Number.prototype.toFixed`. Rounds the exact binary value, ties away from
/// zero (spec: pick the larger n on the magnitude). `digits` is clamped to
/// 0..=100 where JS would throw a RangeError. At or above 1e21 it returns the
/// plain number string, like JS.
pub fn js_to_fixed(x: f64, digits: usize) -> String {
    let f = digits.min(100);
    if x.is_nan() {
        return "NaN".to_string();
    }
    if x.abs() >= 1e21 {
        return js_number_to_string(x);
    }
    let abs = x.abs();
    let neg = x < 0.0;
    let mut body = format!("{:.*}", f, abs);
    // Rust rounds exact ties to even. A tie needs abs to be a multiple of
    // 2^-(f+1), in which case the (f+1)-digit rendering is exact.
    let scaled = abs * 2f64.powi(f as i32 + 1);
    if scaled.is_finite() && scaled.fract() == 0.0 {
        let exact = format!("{:.*}", f + 1, abs);
        if exact.ends_with('5') {
            let mut t: Vec<u8> = exact.into_bytes();
            t.pop();
            if f == 0 {
                t.pop();
            }
            body = increment_decimal(t);
        }
    }
    if neg {
        format!("-{}", body)
    } else {
        body
    }
}

fn increment_decimal(mut t: Vec<u8>) -> String {
    let mut i = t.len();
    loop {
        if i == 0 {
            t.insert(0, b'1');
            break;
        }
        i -= 1;
        match t[i] {
            b'.' => continue,
            b'9' => t[i] = b'0',
            d => {
                t[i] = d + 1;
                break;
            }
        }
    }
    String::from_utf8(t).unwrap_or_default()
}

/// Length of the longest prefix of `s` that is a StrDecimalLiteral
/// (`Infinity`, or digits with optional fraction and exponent), after an
/// optional sign. Returns 0 when there is none.
fn scan_decimal(s: &str) -> usize {
    let b = s.as_bytes();
    let mut i = 0;
    if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
        i += 1;
    }
    if s[i..].starts_with("Infinity") {
        return i + 8;
    }
    let int_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    let int_digits = i - int_start;
    let mut frac_digits = 0;
    if i < b.len() && b[i] == b'.' {
        let mut j = i + 1;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        frac_digits = j - (i + 1);
        if int_digits > 0 || frac_digits > 0 {
            i = j;
        }
    }
    if int_digits == 0 && frac_digits == 0 {
        return 0;
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        let mut j = i + 1;
        if j < b.len() && (b[j] == b'+' || b[j] == b'-') {
            j += 1;
        }
        let d = j;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        if j > d {
            i = j;
        }
    }
    i
}

fn parse_decimal_prefix(s: &str) -> f64 {
    let neg = s.starts_with('-');
    let unsigned = s.trim_start_matches(['+', '-']);
    if unsigned == "Infinity" {
        return if neg { f64::NEG_INFINITY } else { f64::INFINITY };
    }
    s.parse::<f64>().unwrap_or(f64::NAN)
}

/// Global `parseFloat`: skips leading whitespace, takes the longest decimal
/// prefix, no hex. Returns NaN when there is no number.
pub fn js_parse_float(s: &str) -> f64 {
    let t = js_trim_start(s);
    let n = scan_decimal(t);
    if n == 0 {
        return f64::NAN;
    }
    parse_decimal_prefix(&t[..n])
}

/// Global `parseInt`. `radix` 0 means "10 unless a 0x prefix". Returns NaN
/// when no digits are found or the radix is outside 2..=36 (other than 0).
pub fn js_parse_int(s: &str, radix: u32) -> f64 {
    let mut t = js_trim_start(s);
    let mut neg = false;
    if let Some(r) = t.strip_prefix('-') {
        neg = true;
        t = r;
    } else if let Some(r) = t.strip_prefix('+') {
        t = r;
    }
    let mut radix = radix;
    if radix != 0 && !(2..=36).contains(&radix) {
        return f64::NAN;
    }
    if (radix == 0 || radix == 16) && (t.starts_with("0x") || t.starts_with("0X")) {
        t = &t[2..];
        radix = 16;
    }
    if radix == 0 {
        radix = 10;
    }
    let end = t
        .char_indices()
        .find(|(_, c)| c.to_digit(radix).is_none())
        .map(|(i, _)| i)
        .unwrap_or(t.len());
    if end == 0 {
        return f64::NAN;
    }
    let digits = &t[..end];
    let v = if radix == 10 {
        digits.parse::<f64>().unwrap_or(f64::NAN)
    } else {
        digits
            .chars()
            .fold(0.0, |acc, c| acc * radix as f64 + c.to_digit(radix).unwrap_or(0) as f64)
    };
    if neg {
        -v
    } else {
        v
    }
}

/// The `Number(string)` conversion (also unary plus). Whitespace is trimmed
/// on both sides, the empty string is 0, `0x`/`0o`/`0b` prefixes are accepted
/// (unsigned), `Infinity` is accepted, anything else that is not a full
/// decimal literal is NaN.
pub fn js_number_from_str(s: &str) -> f64 {
    let t = js_trim(s);
    if t.is_empty() {
        return 0.0;
    }
    let radix_prefix = [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)];
    for (p, radix) in radix_prefix {
        if let Some(rest) = t.strip_prefix(p) {
            if rest.is_empty() || rest.chars().any(|c| c.to_digit(radix).is_none()) {
                return f64::NAN;
            }
            return rest
                .chars()
                .fold(0.0, |acc, c| acc * radix as f64 + c.to_digit(radix).unwrap_or(0) as f64);
        }
    }
    if scan_decimal(t) != t.len() {
        return f64::NAN;
    }
    parse_decimal_prefix(t)
}

/// JS truthiness of a number: false for 0, -0 and NaN.
pub fn js_truthy_num(x: f64) -> bool {
    !(x == 0.0 || x.is_nan())
}

/// JS truthiness of a string: false only for the empty string.
pub fn js_truthy_str(s: &str) -> bool {
    !s.is_empty()
}

/// `Math.min(a, b)`: NaN if either is NaN, and `-0 < +0`.
pub fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a == 0.0 && b == 0.0 {
        return if a.is_sign_negative() { a } else { b };
    }
    if a < b {
        a
    } else {
        b
    }
}

/// `Math.max(a, b)`: NaN if either is NaN, and `+0 > -0`.
pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a == 0.0 && b == 0.0 {
        return if a.is_sign_negative() { b } else { a };
    }
    if a > b {
        a
    } else {
        b
    }
}

/// `Math.min(...values)`; `Infinity` for an empty slice.
pub fn js_min_all(values: &[f64]) -> f64 {
    values.iter().fold(f64::INFINITY, |m, v| js_min(m, *v))
}

/// `Math.max(...values)`; `-Infinity` for an empty slice.
pub fn js_max_all(values: &[f64]) -> f64 {
    values.iter().fold(f64::NEG_INFINITY, |m, v| js_max(m, *v))
}

/// `ToInt32` (what `x | 0` does).
pub fn js_to_int32(x: f64) -> i32 {
    if !x.is_finite() {
        return 0;
    }
    let m = x.trunc().rem_euclid(4294967296.0);
    (m as u64 as u32) as i32
}

/// Is this string a canonical array index ("0", "17", not "01", not "-1").
/// JS objects enumerate such keys first, in ascending numeric order.
pub fn is_array_index(s: &str) -> bool {
    if s.is_empty() || s.len() > 10 {
        return false;
    }
    if s == "0" {
        return true;
    }
    if s.starts_with('0') || !s.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    matches!(s.parse::<u64>(), Ok(n) if n < 4294967295)
}

/// Reorder keys the way `Object.keys` enumerates them: array-index keys
/// ascending first, then the rest in insertion order.
pub fn js_order_keys<V>(map: IndexMap<String, V>) -> IndexMap<String, V> {
    if map.keys().all(|k| !is_array_index(k)) {
        return map;
    }
    let mut idx: Vec<(u64, String, V)> = Vec::new();
    let mut rest: Vec<(String, V)> = Vec::new();
    for (k, v) in map {
        if is_array_index(&k) {
            idx.push((k.parse().unwrap_or(0), k, v));
        } else {
            rest.push((k, v));
        }
    }
    idx.sort_by_key(|(n, _, _)| *n);
    let mut out = IndexMap::new();
    for (_, k, v) in idx {
        out.insert(k, v);
    }
    for (k, v) in rest {
        out.insert(k, v);
    }
    out
}

/// Number of UTF-16 code units, i.e. JS `string.length`.
pub fn js_str_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// `string.slice(start, end)` over UTF-16 code units, with JS negative index
/// handling. A split surrogate pair becomes U+FFFD.
pub fn js_slice(s: &str, start: i64, end: Option<i64>) -> String {
    let u: Vec<u16> = s.encode_utf16().collect();
    let len = u.len() as i64;
    let norm = |i: i64| -> usize {
        if i < 0 {
            (len + i).max(0) as usize
        } else {
            i.min(len) as usize
        }
    };
    let a = norm(start);
    let b = norm(end.unwrap_or(len));
    if a >= b {
        return String::new();
    }
    String::from_utf16_lossy(&u[a..b])
}

/// How many leading elements `arr.slice(0, n)` keeps for a numeric `n` on an
/// array of length `len`: truncates toward zero, negative counts from the end,
/// NaN gives 0.
pub fn js_trunc_len(n: f64, len: usize) -> usize {
    if n.is_nan() {
        return 0;
    }
    let t = n.trunc();
    if t < 0.0 {
        (len as f64 + t).max(0.0) as usize
    } else {
        t.min(len as f64) as usize
    }
}

/// Approximation of `localeCompare` for the ICU root collation: compares
/// case-insensitively first, then lowercase before uppercase. Not a full
/// UCA implementation. Returns -1, 0 or 1.
pub fn js_locale_compare(a: &str, b: &str) -> f64 {
    let la: Vec<char> = a.to_lowercase().chars().collect();
    let lb: Vec<char> = b.to_lowercase().chars().collect();
    match la.cmp(&lb) {
        std::cmp::Ordering::Less => return -1.0,
        std::cmp::Ordering::Greater => return 1.0,
        std::cmp::Ordering::Equal => {}
    }
    for (x, y) in a.chars().zip(b.chars()) {
        if x != y {
            return if x.is_lowercase() { -1.0 } else { 1.0 };
        }
    }
    0.0
}

/// `Array.prototype.sort` with a numeric comparator, returning a new vector.
/// Mirrors V8's TimSort for arrays under 64 elements (initial run detection,
/// then binary insertion), so even inconsistent comparators give the same
/// order as V8 on short inputs. Longer inputs use a stable merge sort. A
/// comparator result that is NaN counts as 0. Never panics, unlike
/// `slice::sort_by`, which may panic on a non-total order.
pub fn js_sort_by<T, F: FnMut(&T, &T) -> f64>(items: Vec<T>, mut cmp: F) -> Vec<T> {
    let n = items.len();
    if n < 2 {
        return items;
    }
    let mut perm: Vec<usize> = (0..n).collect();
    {
        let mut c = |a: usize, b: usize| -> f64 {
            let r = cmp(&items[a], &items[b]);
            if r.is_nan() {
                0.0
            } else {
                r
            }
        };
        if n < 64 {
            binary_insertion_sort(&mut perm, &mut c);
        } else {
            perm = merge_sort(perm, &mut c);
        }
    }
    let mut slots: Vec<Option<T>> = items.into_iter().map(Some).collect();
    perm.into_iter().filter_map(|i| slots[i].take()).collect()
}

fn binary_insertion_sort(perm: &mut [usize], cmp: &mut dyn FnMut(usize, usize) -> f64) {
    let n = perm.len();
    // count the initial run
    let mut run = 2;
    let desc = cmp(perm[1], perm[0]) < 0.0;
    let mut prev = perm[1];
    while run < n {
        let cur = perm[run];
        let order = cmp(cur, prev);
        if desc {
            if order >= 0.0 {
                break;
            }
        } else if order < 0.0 {
            break;
        }
        prev = cur;
        run += 1;
    }
    if desc {
        perm[..run].reverse();
    }
    for start in run..n {
        let pivot = perm[start];
        let mut left = 0;
        let mut right = start;
        while left < right {
            let mid = left + ((right - left) >> 1);
            if cmp(pivot, perm[mid]) < 0.0 {
                right = mid;
            } else {
                left = mid + 1;
            }
        }
        perm[left..=start].rotate_right(1);
    }
}

fn merge_sort(v: Vec<usize>, cmp: &mut dyn FnMut(usize, usize) -> f64) -> Vec<usize> {
    if v.len() < 2 {
        return v;
    }
    let mid = v.len() / 2;
    let right = merge_sort(v[mid..].to_vec(), cmp);
    let left = merge_sort(v[..mid].to_vec(), cmp);
    let mut out = Vec::with_capacity(left.len() + right.len());
    let (mut i, mut j) = (0, 0);
    while i < left.len() && j < right.len() {
        if cmp(right[j], left[i]) < 0.0 {
            out.push(right[j]);
            j += 1;
        } else {
            out.push(left[i]);
            i += 1;
        }
    }
    out.extend_from_slice(&left[i..]);
    out.extend_from_slice(&right[j..]);
    out
}

/// serde helpers so `f64` fields serialize the way `JSON.stringify` writes
/// numbers: integral values without a fraction (`1`, not `1.0`), `-0` as `0`,
/// non-finite as `null`. Use as `#[serde(with = "crate::js::num")]`,
/// `num_opt` for `Option<f64>` and `num_vec` for `Vec<f64>`.
pub mod num {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn write<S: Serializer>(x: f64, s: S) -> Result<S::Ok, S::Error> {
        if !x.is_finite() {
            s.serialize_none()
        } else if x == x.trunc() && x.abs() < 9007199254740992.0 {
            s.serialize_i64(x as i64)
        } else {
            s.serialize_f64(x)
        }
    }

    pub fn serialize<S: Serializer>(x: &f64, s: S) -> Result<S::Ok, S::Error> {
        write(*x, s)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
        Ok(Option::<f64>::deserialize(d)?.unwrap_or(f64::NAN))
    }
}

/// See [`num`]. For `Option<f64>`; pair with `skip_serializing_if = "Option::is_none"`.
pub mod num_opt {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(x: &Option<f64>, s: S) -> Result<S::Ok, S::Error> {
        match x {
            Some(v) => super::num::write(*v, s),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
        Option::<f64>::deserialize(d)
    }
}

/// See [`num`]. For `Vec<f64>`.
pub mod num_vec {
    use serde::ser::SerializeSeq;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    struct W(f64);
    impl Serialize for W {
        fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
            super::num::write(self.0, s)
        }
    }

    pub fn serialize<S: Serializer>(x: &[f64], s: S) -> Result<S::Ok, S::Error> {
        let mut seq = s.serialize_seq(Some(x.len()))?;
        for v in x {
            seq.serialize_element(&W(*v))?;
        }
        seq.end()
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<f64>, D::Error> {
        Vec::<f64>::deserialize(d)
    }
}

/// See [`num`]. For `Option<Vec<f64>>`.
pub mod num_vec_opt {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    struct W<'a>(&'a [f64]);
    impl Serialize for W<'_> {
        fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
            super::num_vec::serialize(self.0, s)
        }
    }

    pub fn serialize<S: Serializer>(x: &Option<Vec<f64>>, s: S) -> Result<S::Ok, S::Error> {
        match x {
            Some(v) => W(v).serialize(s),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<f64>>, D::Error> {
        Option::<Vec<f64>>::deserialize(d)
    }
}

/// See [`num`]. For `Vec<Option<f64>>`: `None` is a JS `undefined` hole and
/// serializes as `null`, like `JSON.stringify` does inside arrays.
pub mod num_opt_vec {
    use serde::ser::SerializeSeq;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    struct W(Option<f64>);
    impl Serialize for W {
        fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
            match self.0 {
                Some(v) => super::num::write(v, s),
                None => s.serialize_none(),
            }
        }
    }

    pub fn serialize<S: Serializer>(x: &[Option<f64>], s: S) -> Result<S::Ok, S::Error> {
        let mut seq = s.serialize_seq(Some(x.len()))?;
        for v in x {
            seq.serialize_element(&W(*v))?;
        }
        seq.end()
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<Option<f64>>, D::Error> {
        Vec::<Option<f64>>::deserialize(d)
    }
}

/// See [`num`]. For `Option<Option<f64>>` (TS `number | null | undefined`):
/// outer `None` is absent, `Some(None)` is `null`. Pair with
/// `default` and `skip_serializing_if = "Option::is_none"`.
pub mod num_opt_opt {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(x: &Option<Option<f64>>, s: S) -> Result<S::Ok, S::Error> {
        match x {
            Some(Some(v)) => super::num::write(*v, s),
            _ => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<f64>>, D::Error> {
        Ok(Some(Option::<f64>::deserialize(d)?))
    }
}

/// A JS number for places `#[serde(with)]` cannot reach (map values, tuples,
/// arrays). Serializes like [`num`]. Derefs to `f64`.
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Default)]
pub struct Num(pub f64);

impl std::ops::Deref for Num {
    type Target = f64;
    fn deref(&self) -> &f64 {
        &self.0
    }
}

impl From<f64> for Num {
    fn from(v: f64) -> Num {
        Num(v)
    }
}

impl serde::Serialize for Num {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        num::write(self.0, s)
    }
}

impl<'de> serde::Deserialize<'de> for Num {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Num, D::Error> {
        num::deserialize(d).map(Num)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected values below were derived with `deno eval` running the matching
    // JS expression, e.g. deno eval 'console.log(Math.round(-2.5))'.

    #[test]
    fn round_halves() {
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(0.5), 1.0);
        assert_eq!(js_round(-0.5), 0.0);
        assert!(js_round(-0.5).is_sign_negative());
        assert!(js_round(-0.4).is_sign_negative());
        assert_eq!(js_round(1.4999999999999998), 1.0);
        assert_eq!(js_round(0.49999999999999994), 0.0);
        assert_eq!(js_round(-1.5), -1.0);
        assert!(js_round(f64::NAN).is_nan());
        assert_eq!(js_round(f64::INFINITY), f64::INFINITY);
        assert_eq!(js_round(4503599627370497.0), 4503599627370497.0);
    }

    #[test]
    fn number_to_string() {
        let cases: &[(f64, &str)] = &[
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (-1.0, "-1"),
            (1.5, "1.5"),
            (0.1 + 0.2, "0.30000000000000004"),
            (1e21, "1e+21"),
            (1e20, "100000000000000000000"),
            (123456789012345680000.0, "123456789012345680000"),
            (1.5e21, "1.5e+21"),
            (1e-6, "0.000001"),
            (1e-7, "1e-7"),
            (1.5e-7, "1.5e-7"),
            (-1e-7, "-1e-7"),
            (0.000001234, "0.000001234"),
            (123.456, "123.456"),
            (5e-324, "5e-324"),
            (1.7976931348623157e308, "1.7976931348623157e+308"),
            (f64::NAN, "NaN"),
            (f64::INFINITY, "Infinity"),
            (f64::NEG_INFINITY, "-Infinity"),
            (100.0, "100"),
            (2.5, "2.5"),
        ];
        for (x, want) in cases {
            assert_eq!(js_number_to_string(*x), *want, "x={x:?}");
        }
    }

    #[test]
    fn to_fixed() {
        let cases: &[(f64, usize, &str)] = &[
            (1.005, 2, "1.00"),
            (1.45, 1, "1.4"),
            (2.5, 0, "3"),
            (-2.5, 0, "-3"),
            (0.5, 0, "1"),
            (1.5, 0, "2"),
            (0.125, 2, "0.13"),
            (0.375, 2, "0.38"),
            (-0.125, 2, "-0.13"),
            (10.235, 2, "10.23"),
            (8.345, 2, "8.35"),
            (0.0, 2, "0.00"),
            (-0.0, 2, "0.00"),
            (-1e-7, 2, "-0.00"),
            (1e21, 2, "1e+21"),
            (123.456, 0, "123"),
            (99.995, 2, "100.00"),
            (9.5, 0, "10"),
            (0.000001, 4, "0.0000"),
            (1234.5678, 4, "1234.5678"),
            (4.35, 1, "4.3"),
            (1.0, 4, "1.0000"),
            (0.045, 2, "0.04"),
        ];
        for (x, d, want) in cases {
            assert_eq!(js_to_fixed(*x, *d), *want, "x={x:?} d={d}");
        }
        assert_eq!(js_to_fixed(f64::NAN, 2), "NaN");
        assert_eq!(js_to_fixed(f64::INFINITY, 2), "Infinity");
    }

    #[test]
    fn parse_float() {
        assert_eq!(js_parse_float("  12.5kg"), 12.5);
        assert_eq!(js_parse_float("1.2.3"), 1.2);
        assert_eq!(js_parse_float(".5"), 0.5);
        assert_eq!(js_parse_float("5."), 5.0);
        assert_eq!(js_parse_float("-3e2x"), -300.0);
        assert_eq!(js_parse_float("1e"), 1.0);
        assert_eq!(js_parse_float("Infinityx"), f64::INFINITY);
        assert_eq!(js_parse_float("-Infinity"), f64::NEG_INFINITY);
        assert_eq!(js_parse_float("0x10"), 0.0);
        assert!(js_parse_float("").is_nan());
        assert!(js_parse_float("abc").is_nan());
        assert!(js_parse_float(".").is_nan());
        assert!(js_parse_float("+.kg").is_nan());
        assert!(js_parse_float("inf").is_nan());
    }

    #[test]
    fn parse_int() {
        assert_eq!(js_parse_int("42abc", 10), 42.0);
        assert_eq!(js_parse_int("  -7", 10), -7.0);
        assert_eq!(js_parse_int("0x1f", 0), 31.0);
        assert_eq!(js_parse_int("0x1f", 10), 0.0);
        assert_eq!(js_parse_int("ff", 16), 255.0);
        assert!(js_parse_int("", 10).is_nan());
        assert!(js_parse_int("x", 10).is_nan());
        assert_eq!(js_parse_int("123456789012345678901", 10), 123456789012345680000.0);
    }

    #[test]
    fn number_from_str() {
        assert_eq!(js_number_from_str(""), 0.0);
        assert_eq!(js_number_from_str("   "), 0.0);
        assert_eq!(js_number_from_str(" 12 "), 12.0);
        assert_eq!(js_number_from_str("0x1F"), 31.0);
        assert_eq!(js_number_from_str("0b101"), 5.0);
        assert_eq!(js_number_from_str("0o17"), 15.0);
        assert!(js_number_from_str("-0x1F").is_nan());
        assert_eq!(js_number_from_str("Infinity"), f64::INFINITY);
        assert_eq!(js_number_from_str("-Infinity"), f64::NEG_INFINITY);
        assert!(js_number_from_str("infinity").is_nan());
        assert!(js_number_from_str("nan").is_nan());
        assert!(js_number_from_str("1_000").is_nan());
        assert!(js_number_from_str("1.2.3").is_nan());
        assert!(js_number_from_str("12px").is_nan());
        assert_eq!(js_number_from_str("1e3"), 1000.0);
        assert_eq!(js_number_from_str(".5"), 0.5);
        assert_eq!(js_number_from_str("5."), 5.0);
        assert_eq!(js_number_from_str("+5"), 5.0);
        assert!(js_number_from_str("-0").is_sign_negative());
        assert!(js_number_from_str("-").is_nan());
        assert!(js_number_from_str("0x").is_nan());
        assert_eq!(js_number_from_str("\u{feff}7\u{a0}"), 7.0);
    }

    #[test]
    fn min_max() {
        assert!(js_min(f64::NAN, 1.0).is_nan());
        assert!(js_max(1.0, f64::NAN).is_nan());
        assert!(js_min(0.0, -0.0).is_sign_negative());
        assert!(js_max(0.0, -0.0).is_sign_positive());
        assert_eq!(js_min(1.0, 2.0), 1.0);
        assert_eq!(js_max(1.0, 2.0), 2.0);
        assert_eq!(js_max_all(&[]), f64::NEG_INFINITY);
        assert_eq!(js_min_all(&[]), f64::INFINITY);
        assert_eq!(js_max_all(&[-1.0, 3.0, 2.0]), 3.0);
    }

    #[test]
    fn int32_and_truthy() {
        assert_eq!(js_to_int32(4294967296.0 + 5.0), 5);
        assert_eq!(js_to_int32(2147483648.0), -2147483648);
        assert_eq!(js_to_int32(-1.5), -1);
        assert_eq!(js_to_int32(f64::NAN), 0);
        assert!(!js_truthy_num(0.0));
        assert!(!js_truthy_num(f64::NAN));
        assert!(js_truthy_num(-1.0));
        assert!(!js_truthy_str(""));
        assert!(js_truthy_str("0"));
    }

    #[test]
    fn key_order() {
        let mut m = IndexMap::new();
        m.insert("b".to_string(), 1);
        m.insert("10".to_string(), 2);
        m.insert("a".to_string(), 3);
        m.insert("2".to_string(), 4);
        m.insert("01".to_string(), 5);
        let o = js_order_keys(m);
        let keys: Vec<&str> = o.keys().map(|k| k.as_str()).collect();
        assert_eq!(keys, vec!["2", "10", "b", "a", "01"]);
    }

    #[test]
    fn slices() {
        assert_eq!(js_slice("hello", 1, Some(3)), "el");
        assert_eq!(js_slice("hello", 0, Some(-1)), "hell");
        assert_eq!(js_slice("hello", -3, None), "llo");
        assert_eq!(js_slice("hello", 3, Some(1)), "");
        assert_eq!(js_str_len("a\u{1F600}"), 3);
    }

    #[test]
    fn sort_matches_stable_order() {
        let v = vec![(3, 'a'), (1, 'b'), (3, 'c'), (2, 'd'), (1, 'e')];
        let s = js_sort_by(v, |a, b| (a.0 - b.0) as f64);
        assert_eq!(s, vec![(1, 'b'), (1, 'e'), (2, 'd'), (3, 'a'), (3, 'c')]);
        let big: Vec<(i32, usize)> = (0..200).map(|i| (((i * 7919) % 13) as i32, i)).collect();
        let sorted = js_sort_by(big.clone(), |a, b| (a.0 - b.0) as f64);
        let mut want = big;
        want.sort_by_key(|x| x.0);
        assert_eq!(sorted, want);
        // inconsistent comparator must not panic
        let _ = js_sort_by(vec![1, 2, 3, 4, 5], |_, _| 1.0);
        let _ = js_sort_by(vec![1.0, f64::NAN, 3.0], |a: &f64, b: &f64| a - b);
    }

    #[test]
    fn serde_num() {
        #[derive(serde::Serialize, serde::Deserialize, PartialEq, Debug)]
        struct S {
            #[serde(with = "crate::js::num")]
            a: f64,
            #[serde(with = "crate::js::num_opt", skip_serializing_if = "Option::is_none", default)]
            b: Option<f64>,
            #[serde(with = "crate::js::num_vec")]
            c: Vec<f64>,
        }
        let s = S { a: 2.0, b: Some(-0.0), c: vec![1.0, 2.5, 3e21] };
        let j = serde_json::to_string(&s).unwrap();
        assert_eq!(j, r#"{"a":2,"b":0,"c":[1,2.5,3e+21]}"#);
        let back: S = serde_json::from_str(&j).unwrap();
        assert_eq!(back.a, 2.0);
        let none = S { a: 1.0, b: None, c: vec![] };
        assert_eq!(serde_json::to_string(&none).unwrap(), r#"{"a":1,"c":[]}"#);
    }
}
