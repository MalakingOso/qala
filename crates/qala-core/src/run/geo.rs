//! Geodesy: `packages/run/filter.ts` lines 36-130 (Vincenty inverse on WGS-84, haversine).
//!
//! Every arithmetic expression keeps the TS association, so the same operations run in the same
//! order: JS and Rust both evaluate `a * b - c * d * e` as `(a * b) - ((c * d) * e)`.

use super::trig::{asin, atan, atan2, cos, sin, tan};
use crate::js::js_min;
use std::f64::consts::PI;

pub const WGS_A: f64 = 6378137.0;
pub const WGS_F: f64 = 1.0 / 298.257223563;
/// Metres per degree of latitude on the sphere of radius `WGS_A`, as filter.ts writes it.
pub const DEG_M: f64 = (PI * WGS_A) / 180.0;

/// Geodesic distance in metres (Vincenty inverse, WGS-84). Falls back to haversine when the
/// iteration does not converge in 200 steps (near antipodal, or non-finite input).
pub fn vincenty_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let a = WGS_A;
    let f = WGS_F;
    let b = (1.0 - f) * a;
    let to_rad = PI / 180.0;
    let u1 = atan((1.0 - f) * tan(lat1 * to_rad));
    let u2 = atan((1.0 - f) * tan(lat2 * to_rad));
    let l = (lon2 - lon1) * to_rad;
    let sin_u1 = sin(u1);
    let cos_u1 = cos(u1);
    let sin_u2 = sin(u2);
    let cos_u2 = cos(u2);
    let mut lambda = l;
    for _ in 0..200 {
        let sin_lambda = sin(lambda);
        let cos_lambda = cos(lambda);
        let sin_sigma = ((cos_u2 * sin_lambda) * (cos_u2 * sin_lambda)
            + (cos_u1 * sin_u2 - sin_u1 * cos_u2 * cos_lambda)
                * (cos_u1 * sin_u2 - sin_u1 * cos_u2 * cos_lambda))
            .sqrt();
        if sin_sigma == 0.0 {
            return 0.0; // coincident points
        }
        let cos_sigma = sin_u1 * sin_u2 + cos_u1 * cos_u2 * cos_lambda;
        let sigma = atan2(sin_sigma, cos_sigma);
        let sin_alpha = (cos_u1 * cos_u2 * sin_lambda) / sin_sigma;
        let cos_sq_alpha = 1.0 - sin_alpha * sin_alpha;
        let cos2_sigma_m = if cos_sq_alpha == 0.0 {
            0.0 // equatorial line
        } else {
            cos_sigma - (2.0 * sin_u1 * sin_u2) / cos_sq_alpha
        };
        let c = (f / 16.0) * cos_sq_alpha * (4.0 + f * (4.0 - 3.0 * cos_sq_alpha));
        let lambda_prev = lambda;
        lambda = l
            + (1.0 - c)
                * f
                * sin_alpha
                * (sigma
                    + c * sin_sigma
                        * (cos2_sigma_m
                            + c * cos_sigma * (-1.0 + 2.0 * cos2_sigma_m * cos2_sigma_m)));
        if (lambda - lambda_prev).abs() < 1e-12 {
            let u_sq = cos_sq_alpha * (a * a - b * b) / (b * b);
            let big_a =
                1.0 + (u_sq / 16384.0) * (4096.0 + u_sq * (-768.0 + u_sq * (320.0 - 175.0 * u_sq)));
            let big_b = (u_sq / 1024.0) * (256.0 + u_sq * (-128.0 + u_sq * (74.0 - 47.0 * u_sq)));
            let delta_sigma = big_b
                * sin_sigma
                * (cos2_sigma_m
                    + (big_b / 4.0)
                        * (cos_sigma * (-1.0 + 2.0 * cos2_sigma_m * cos2_sigma_m)
                            - (big_b / 6.0)
                                * cos2_sigma_m
                                * (-3.0 + 4.0 * sin_sigma * sin_sigma)
                                * (-3.0 + 4.0 * cos2_sigma_m * cos2_sigma_m)));
            return b * big_a * (sigma - delta_sigma);
        }
    }
    // Antipodal or otherwise non-convergent: never happens on a running segment, but stay total
    // rather than NaN.
    haversine_m(lat1, lon1, lat2, lon2)
}

/// Spherical fallback in metres. Stored distance uses Vincenty; the 0.3% systematic error is why
/// haversine is fallback only.
pub fn haversine_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let to_rad = PI / 180.0;
    let d_lat = (lat2 - lat1) * to_rad;
    let d_lon = (lon2 - lon1) * to_rad;
    // `x ** 2` in V8 is exactly `x * x` (checked over 2e6 random doubles).
    let s_lat = sin(d_lat / 2.0);
    let s_lon = sin(d_lon / 2.0);
    let s = s_lat * s_lat + cos(lat1 * to_rad) * cos(lat2 * to_rad) * (s_lon * s_lon);
    2.0 * 6371000.0 * asin(js_min(1.0, s.sqrt()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_degree_of_latitude_on_the_equator() {
        // 110574 m on the WGS-84 ellipsoid (the haversine sphere gives 111195 m).
        let d = vincenty_m(0.0, 0.0, 1.0, 0.0);
        assert!((d - 110574.389).abs() < 0.01, "{d}");
        let h = haversine_m(0.0, 0.0, 1.0, 0.0);
        assert!((h - 111194.9).abs() < 0.1, "{h}");
    }

    #[test]
    fn coincident_points_are_zero() {
        assert_eq!(vincenty_m(47.6, -122.3, 47.6, -122.3), 0.0);
        assert_eq!(haversine_m(47.6, -122.3, 47.6, -122.3), 0.0);
    }

    #[test]
    fn antipodal_falls_back_to_haversine() {
        let d = vincenty_m(0.0, 0.0, 0.0, 180.0);
        assert_eq!(d, haversine_m(0.0, 0.0, 0.0, 180.0));
        assert!(vincenty_m(f64::NAN, 0.0, 1.0, 1.0).is_nan());
    }
}
