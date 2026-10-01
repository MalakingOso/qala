//! `utils/math.ts`.

use crate::js::{js_max, js_min, js_number_from_str, js_number_to_string, js_round, js_to_fixed};

/// `MathUtils_round`: round `value` to the nearest multiple of `to`, then to 4 decimals.
pub fn round(value: f64, to: f64) -> f64 {
    round_float(js_round(value / to) * to, 4)
}

pub fn round_to_05(value: f64) -> f64 {
    round(value, 0.5)
}

pub fn round_to_005(value: f64) -> f64 {
    round(value, 0.05)
}

pub fn round_to_0005(value: f64) -> f64 {
    round(value, 0.005)
}

pub fn round_to_00005(value: f64) -> f64 {
    round(value, 0.0005)
}

pub fn round_to_000005(value: f64) -> f64 {
    round(value, 0.00005)
}

/// `+value.toFixed(precision)`; NaN becomes 0. Can return `-0` like JS does.
pub fn round_float(value: f64, precision: usize) -> f64 {
    if value.is_nan() {
        return 0.0;
    }
    js_number_from_str(&js_to_fixed(value, precision))
}

/// Assignment operators of Liftoscript.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum IAssignmentOp {
    #[serde(rename = "+=")]
    AddAssign,
    #[serde(rename = "-=")]
    SubAssign,
    #[serde(rename = "*=")]
    MulAssign,
    #[serde(rename = "/=")]
    DivAssign,
    #[serde(rename = "=")]
    Assign,
}

pub fn apply_op(a: f64, b: f64, opr: IAssignmentOp) -> f64 {
    match opr {
        IAssignmentOp::Assign => b,
        IAssignmentOp::AddAssign => a + b,
        IAssignmentOp::SubAssign => a - b,
        IAssignmentOp::MulAssign => round_to_005(a * b),
        IAssignmentOp::DivAssign => round_to_005(a / b),
    }
}

pub fn clamp(value: f64, min: Option<f64>, max: Option<f64>) -> f64 {
    match (min, max) {
        (Some(lo), Some(hi)) => js_max(lo, js_min(hi, value)),
        (Some(lo), None) => js_max(lo, value),
        (None, Some(hi)) => js_min(hi, value),
        (None, None) => value,
    }
}

/// `MathUtils_toWord`: "zero".."twelve", `None` for anything else (JS gives undefined).
pub fn to_word(num: Option<f64>) -> Option<&'static str> {
    const WORDS: [&str; 13] = [
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "eleven", "twelve",
    ];
    let n = num?;
    if n >= 0.0 && n == n.trunc() && (n as usize) < WORDS.len() {
        Some(WORDS[n as usize])
    } else {
        None
    }
}

/// `MathUtils_parse`: `Number(value)`, `None` for NaN. Note `Number("")` is 0.
pub fn parse(value: Option<&str>) -> Option<f64> {
    let num = js_number_from_str(value?);
    if num.is_nan() {
        None
    } else {
        Some(num)
    }
}

/// Replace every "," with ".".
pub fn normalize_num_str(value: &str) -> String {
    value.replace(',', ".")
}

/// `n(value, precision)`: round then print as a JS number string.
pub fn n(value: f64, precision: usize) -> String {
    js_number_to_string(round_float(value, precision))
}

/// `n(value)` with the default precision of 2.
pub fn n2(value: f64) -> String {
    n(value, 2)
}

/// `MathUtils_formatCompact` with `fraction_digits` (TS default 1).
pub fn format_compact(value: f64, fraction_digits: usize) -> String {
    if !value.is_finite() {
        return js_number_to_string(value);
    }
    let abs = value.abs();
    let sign = if value < 0.0 { "-" } else { "" };
    let trim = |num: f64| -> String { strip_trailing_zeros(&js_to_fixed(num, fraction_digits)) };
    if abs >= 1e9 {
        format!("{}{}b", sign, trim(abs / 1e9))
    } else if abs >= 1e6 {
        format!("{}{}m", sign, trim(abs / 1e6))
    } else if abs >= 1e3 {
        format!("{}{}k", sign, trim(abs / 1e3))
    } else {
        format!("{}{}", sign, trim(abs))
    }
}

/// Emulates `s.replace(/\.?0+$/, "")`, including its quirk of eating integer
/// zeros when there is no decimal point ("100" becomes "1").
fn strip_trailing_zeros(s: &str) -> String {
    let b = s.as_bytes();
    for start in 0..b.len() {
        let mut candidates = Vec::new();
        if b[start] == b'.' {
            candidates.push(start + 1);
        }
        candidates.push(start);
        for z in candidates {
            if z < b.len() && b[z..].iter().all(|c| *c == b'0') {
                return s[..start].to_string();
            }
        }
    }
    s.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected values derived by evaluating the TS in deno, see scratch notes
    // in the test body comments (MathUtils_* copied into a deno eval script).

    #[test]
    fn rounding() {
        assert_eq!(round(7.3, 2.5), 7.5);
        assert_eq!(round(1.2345, 0.05), 1.25);
        assert_eq!(round_to_05(2.25), 2.5);
        assert_eq!(round_to_05(-2.25), -2.0);
        assert_eq!(round_to_005(100.026), 100.05);
        assert_eq!(round_to_0005(1.2346), 1.235);
        assert_eq!(round_to_00005(1.23456), 1.2345);
        assert_eq!(round_to_000005(1.234567), 1.2346);
    }

    #[test]
    fn round_float_cases() {
        assert_eq!(round_float(1.005, 2), 1.0);
        assert_eq!(round_float(f64::NAN, 2), 0.0);
        assert_eq!(round_float(2.675, 2), 2.67);
        assert_eq!(round_float(1.23456789, 4), 1.2346);
        assert!(round_float(-1e-9, 4).is_sign_negative());
        assert_eq!(round_float(f64::INFINITY, 2), f64::INFINITY);
    }

    #[test]
    fn ops() {
        assert_eq!(apply_op(5.0, 2.0, IAssignmentOp::Assign), 2.0);
        assert_eq!(apply_op(5.0, 2.0, IAssignmentOp::AddAssign), 7.0);
        assert_eq!(apply_op(5.0, 2.0, IAssignmentOp::SubAssign), 3.0);
        assert_eq!(apply_op(5.0, 0.33, IAssignmentOp::MulAssign), 1.65);
        assert_eq!(apply_op(5.0, 3.0, IAssignmentOp::DivAssign), 1.65);
    }

    #[test]
    fn clamp_cases() {
        assert_eq!(clamp(5.0, Some(1.0), Some(3.0)), 3.0);
        assert_eq!(clamp(0.0, Some(1.0), Some(3.0)), 1.0);
        assert_eq!(clamp(5.0, Some(1.0), None), 5.0);
        assert_eq!(clamp(5.0, None, Some(3.0)), 3.0);
        assert_eq!(clamp(5.0, None, None), 5.0);
        assert!(clamp(f64::NAN, Some(1.0), Some(3.0)).is_nan());
    }

    #[test]
    fn words_and_parse() {
        assert_eq!(to_word(Some(0.0)), Some("zero"));
        assert_eq!(to_word(Some(12.0)), Some("twelve"));
        assert_eq!(to_word(Some(13.0)), None);
        assert_eq!(to_word(Some(1.5)), None);
        assert_eq!(to_word(Some(-1.0)), None);
        assert_eq!(to_word(None), None);
        assert_eq!(parse(Some("")), Some(0.0));
        assert_eq!(parse(Some("1.5")), Some(1.5));
        assert_eq!(parse(Some("abc")), None);
        assert_eq!(parse(None), None);
        assert_eq!(normalize_num_str("1,5,2"), "1.5.2");
    }

    #[test]
    fn n_fn() {
        assert_eq!(n2(1.005), "1");
        assert_eq!(n2(12.3456), "12.35");
        assert_eq!(n(0.000049, 4), "0");
        assert_eq!(n(1e21, 2), "1e+21");
        assert_eq!(n2(f64::NAN), "0");
        assert_eq!(n2(-0.001), "0");
    }

    #[test]
    fn compact() {
        assert_eq!(format_compact(1500.0, 1), "1.5k");
        assert_eq!(format_compact(2_000_000.0, 1), "2m");
        assert_eq!(format_compact(-3_400_000_000.0, 1), "-3.4b");
        assert_eq!(format_compact(0.0, 1), "0");
        assert_eq!(format_compact(100.0, 1), "100");
        assert_eq!(format_compact(100.0, 0), "1");
        assert_eq!(format_compact(999.0, 0), "999");
        assert_eq!(format_compact(f64::INFINITY, 1), "Infinity");
        assert_eq!(format_compact(12.34, 1), "12.3");
    }
}
