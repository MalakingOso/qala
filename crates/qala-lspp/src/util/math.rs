//! `utils/math.ts`.

use crate::js::{js_max, js_min, js_number_from_str, js_number_to_string, js_round, js_to_fixed};

/// `MathUtils_round`: round `value` to the nearest multiple of `to`, then to 4 decimals.
pub fn round(value: f64, to: f64) -> f64 {
    round_float(js_round(value / to) * to, 4)
}

pub fn round_to_005(value: f64) -> f64 {
    round(value, 0.05)
}

pub fn round_to_0005(value: f64) -> f64 {
    round(value, 0.005)
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

/// `n(value, precision)`: round then print as a JS number string.
pub fn n(value: f64, precision: usize) -> String {
    js_number_to_string(round_float(value, precision))
}

/// `n(value)` with the default precision of 2.
pub fn n2(value: f64) -> String {
    n(value, 2)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected values derived by evaluating the TS in V8, see scratch notes
    // in the test body comments (MathUtils_* copied into a V8 script).

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
    fn n_fn() {
        assert_eq!(n2(1.005), "1");
        assert_eq!(n2(12.3456), "12.35");
        assert_eq!(n(0.000049, 4), "0");
        assert_eq!(n(1e21, 2), "1e+21");
        assert_eq!(n2(f64::NAN), "0");
        assert_eq!(n2(-0.001), "0");
    }

}
