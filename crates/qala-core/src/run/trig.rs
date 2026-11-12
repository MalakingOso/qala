//! The transcendental functions the run math uses, in one place so every target can be made to
//! compute the same numbers.
//!
//! The last bit of `sin`, `cos`, `tan`, `atan`, `atan2` and `asin` differs between libms.
//! Vincenty's `sinSigma` is a difference of two products near 1, so on a segment of `d` metres a
//! last-bit change moves the result by about `1e-16 * 6.4e6 / d` relative: 2e-10 for a 3 m stride.
//! That is inside the golden tolerance (1e-9), so these call the platform's libm.
//!
//! Measured 2026-11-11 against V8 15 on glibc: the golden filter points match V8
//! bit for bit in `lat`, `lon` and `speedMps`, and in 83% of `distM` (worst relative difference
//! 5.8e-12). The pure-Rust `libm` crate was tried in place of std and matched V8 worse (8% of
//! `distM`, worst 8e-10), because V8's `sin` and `cos` come from glibc. So the host build is the
//! closest to the recorded vectors. Android's bionic is a third libm: on the x86_64 emulator the 2 h replay differs
//! from the TS vector by at most 2.5e-10 relative in `distM` and not at all in `lat`, `lon` and
//! `speedMps` (an arm64 phone is unmeasured). If a target ever exceeds 1e-9 on the vectors, change the bodies below and nothing else in
//! `run` moves.
//!
//! `hypot2` is `Math.hypot` as V8 implements it (scale by the larger magnitude, Kahan sum of
//! squares, `sqrt`), not libm's `hypot`: the two differ in the last bit on about a third of inputs.

#[inline]
pub fn sin(x: f64) -> f64 {
    x.sin()
}

#[inline]
pub fn cos(x: f64) -> f64 {
    x.cos()
}

#[inline]
pub fn tan(x: f64) -> f64 {
    x.tan()
}

#[inline]
pub fn atan(x: f64) -> f64 {
    x.atan()
}

#[inline]
pub fn atan2(y: f64, x: f64) -> f64 {
    y.atan2(x)
}

#[inline]
pub fn asin(x: f64) -> f64 {
    x.asin()
}

/// `Math.hypot(a, b)` with V8's algorithm: infinity wins over NaN, NaN over a finite result, zero
/// for two zeros, otherwise `sqrt(sum((|v| / max)^2)) * max` with a Kahan-compensated sum.
pub fn hypot2(a: f64, b: f64) -> f64 {
    let abs = [a.abs(), b.abs()];
    let mut max = 0.0f64;
    let mut any_nan = false;
    for v in abs {
        if v.is_nan() {
            any_nan = true;
        } else if v > max {
            max = v;
        }
    }
    if max == f64::INFINITY {
        return f64::INFINITY;
    }
    if any_nan {
        return f64::NAN;
    }
    if max == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0f64;
    let mut compensation = 0.0f64;
    for v in abs {
        let n = v / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hypot_special_values() {
        assert_eq!(hypot2(0.0, 0.0), 0.0);
        assert_eq!(hypot2(-0.0, 0.0), 0.0);
        assert_eq!(hypot2(3.0, 4.0), 5.0);
        assert_eq!(hypot2(f64::INFINITY, f64::NAN), f64::INFINITY);
        assert!(hypot2(f64::NAN, 1.0).is_nan());
        assert!(hypot2(f64::NAN, 0.0).is_nan());
        assert_eq!(hypot2(-3.0, 4.0), 5.0);
        assert_eq!(hypot2(1e200, 1e200), 2f64.sqrt() * 1e200);
    }
}
