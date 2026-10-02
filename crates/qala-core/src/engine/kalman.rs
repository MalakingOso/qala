//! Linear Kalman filter over e1RM observations: `packages/engine/kalman.ts` (PLAN 6.2, Kolossa
//! 2017).
//!
//! State `[p0, k1, k2]`, observation `y = p0 + k1*F - k2*(Gw + Gs)`. `theta = k2/k1` (prior 4.0
//! for lifts, 2.0 for runs) stays fixed until 20 observations. The arithmetic keeps the TS
//! operation order so the doubles match.

use super::state::KalmanState;

type V3 = [f64; 3];

/// `initKalman`. TS defaults `r` to 4; pass 4.0 for the lift filters. Honest prior variances:
/// `p0` within about 2 sd of `r`, gains within about 50%. Oversized priors make early
/// innovations whipsaw the gains.
pub fn init_kalman(p0: f64, k1: f64, theta_prior: f64, r: f64) -> KalmanState {
    let k2 = theta_prior * k1;
    KalmanState {
        p0,
        k1,
        k2,
        theta_prior,
        p: [
            [4.0 * r, 0.0, 0.0],
            [0.0, 0.25 * k1 * k1 + 1e-6, 0.0],
            [0.0, 0.0, 0.25 * k2 * k2 + 1e-6],
        ],
        obs: 0.0,
        r,
    }
}

/// `thetaOf`: `k2 / k1`, or the prior when `k1` is exactly 0.
pub fn theta_of(k: &KalmanState) -> f64 {
    if k.k1 != 0.0 {
        k.k2 / k.k1
    } else {
        k.theta_prior
    }
}

fn mat_vec_mul3(m: &[[f64; 3]; 3], v: V3) -> V3 {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

/// One linear Kalman update. `fitness` F and `fatigue` (Gw + Gs) locate the observation `y`;
/// `noise_scale` multiplies `R` (0.25 for a tested 1RM, doubled after a run). TS defaults it
/// to 1.
///
/// The first observation only anchors `p0` (exact fit, so slope-prior error lands in `p0`) and
/// leaves `P` untouched. After that the update is the Joseph form, which keeps `P` symmetric
/// positive definite where `(I-KH)P` would drift.
#[allow(clippy::needless_range_loop)] // index loops keep the TS summation order visible
pub fn kalman_update(
    k: &KalmanState,
    fitness: f64,
    fatigue: f64,
    y: f64,
    noise_scale: f64,
) -> KalmanState {
    if k.obs == 0.0 {
        let p0 = y - k.k1 * fitness + k.k2 * fatigue;
        return KalmanState {
            p0,
            k1: k.k1,
            k2: k.k2,
            theta_prior: k.theta_prior,
            p: k.p,
            obs: 1.0,
            r: k.r,
        };
    }
    let h: V3 = [1.0, fitness, -fatigue];
    let x: V3 = [k.p0, k.k1, k.k2];
    // Small process noise keeps the filter adaptive (Kolossa state-noise variant).
    let q = 1e-6;
    let mut p = k.p;
    for (i, row) in p.iter_mut().enumerate() {
        for (j, v) in row.iter_mut().enumerate() {
            *v += if i == j { q } else { 0.0 };
        }
    }
    let hx = h[0] * x[0] + h[1] * x[1] + h[2] * x[2];
    let pht = mat_vec_mul3(&p, h);
    let s = h[0] * pht[0] + h[1] * pht[1] + h[2] * pht[2] + k.r * noise_scale;
    let mut kg: V3 = [pht[0] / s, pht[1] / s, pht[2] / s];
    let locked = k.obs < 20.0;
    if locked {
        kg = [kg[0], kg[1], 0.0]; // theta fixed until 20 observations
    }
    let innov = y - hx;
    let xn: V3 = [
        x[0] + kg[0] * innov,
        x[1] + kg[1] * innov,
        x[2] + kg[2] * innov,
    ];
    let ikh = [
        [1.0 - kg[0] * h[0], -kg[0] * h[1], -kg[0] * h[2]],
        [-kg[1] * h[0], 1.0 - kg[1] * h[1], -kg[1] * h[2]],
        [-kg[2] * h[0], -kg[2] * h[1], 1.0 - kg[2] * h[2]],
    ];
    let rv = k.r * noise_scale;
    let mut pn = [[0.0f64; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            let mut v = rv * kg[i] * kg[j];
            for a in 0..3 {
                let mut inner = 0.0;
                for b in 0..3 {
                    inner += p[a][b] * ikh[j][b];
                }
                v += ikh[i][a] * inner;
            }
            pn[i][j] = v;
        }
    }
    // Enforce exact symmetry.
    let mut ps = [[0.0f64; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            ps[i][j] = (pn[i][j] + pn[j][i]) / 2.0;
        }
    }
    let mut k2 = xn[2];
    if locked {
        k2 = k.theta_prior * xn[1]; // hold theta exactly at the prior
    }
    KalmanState {
        p0: xn[0],
        k1: xn[1],
        k2,
        theta_prior: k.theta_prior,
        p: ps,
        obs: k.obs + 1.0,
        r: k.r,
    }
}

/// `kalmanPredict`: the model value `p0 + k1*F - k2*fatigue` (the weekly composite uses this).
pub fn kalman_predict(k: &KalmanState, fitness: f64, fatigue: f64) -> f64 {
    k.p0 + k.k1 * fitness - k.k2 * fatigue
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_matches_the_ts_priors() {
        let k = init_kalman(100.0, 0.5, 4.0, 4.0);
        assert_eq!(k.p0, 100.0);
        assert_eq!(k.k1, 0.5);
        assert_eq!(k.k2, 2.0);
        assert_eq!(k.theta_prior, 4.0);
        assert_eq!(k.obs, 0.0);
        assert_eq!(k.r, 4.0);
        assert_eq!(k.p[0], [16.0, 0.0, 0.0]);
        assert_eq!(k.p[1], [0.0, 0.25 * 0.5 * 0.5 + 1e-6, 0.0]);
        assert_eq!(k.p[2], [0.0, 0.0, 0.25 * 2.0 * 2.0 + 1e-6]);
    }

    #[test]
    fn theta_falls_back_to_the_prior_when_k1_is_zero() {
        let mut k = init_kalman(100.0, 0.5, 4.0, 4.0);
        assert_eq!(theta_of(&k), 4.0);
        k.k1 = 0.0;
        assert_eq!(theta_of(&k), 4.0);
        k.k1 = 2.0;
        k.k2 = 3.0;
        assert_eq!(theta_of(&k), 1.5);
    }

    #[test]
    fn first_observation_anchors_p0_and_keeps_p() {
        let k = init_kalman(100.0, 0.5, 4.0, 4.0);
        let n = kalman_update(&k, 3.0, 2.0, 150.0, 1.0);
        assert_eq!(n.obs, 1.0);
        assert_eq!(n.p0, 150.0 - 0.5 * 3.0 + 2.0 * 2.0);
        assert_eq!(
            (n.k1, n.k2, n.p, n.r, n.theta_prior),
            (k.k1, k.k2, k.p, k.r, k.theta_prior)
        );
        assert_eq!(kalman_predict(&n, 3.0, 2.0), 150.0);
    }

    #[test]
    fn theta_stays_at_the_prior_until_20_observations() {
        let mut k = init_kalman(100.0, 0.5, 4.0, 4.0);
        for i in 0..20 {
            let fitness = 1.0 + f64::from(i % 5);
            let fatigue = f64::from(i % 3);
            k = kalman_update(&k, fitness, fatigue, 120.0 + f64::from(i), 1.0);
            // While locked, k2 is held at exactly thetaPrior * k1.
            if k.obs <= 20.0 {
                assert_eq!(k.k2, k.theta_prior * k.k1, "after {} observations", k.obs);
            }
        }
        assert_eq!(k.obs, 20.0);
    }

    #[test]
    fn unlock_lets_theta_move() {
        let mut k = init_kalman(100.0, 0.5, 4.0, 4.0);
        for i in 0..40 {
            let fitness = 1.0 + f64::from(i % 7);
            let fatigue = f64::from(i % 4) * 1.5;
            k = kalman_update(&k, fitness, fatigue, 120.0 + f64::from(i % 5), 1.0);
        }
        assert_eq!(k.obs, 40.0);
        assert_ne!(k.k2, k.theta_prior * k.k1);
        // P stays symmetric by construction.
        for i in 0..3 {
            for j in 0..3 {
                assert_eq!(k.p[i][j], k.p[j][i]);
            }
        }
    }

    #[test]
    fn smaller_noise_scale_pulls_harder_toward_the_observation() {
        let base = kalman_update(&init_kalman(100.0, 0.5, 4.0, 4.0), 3.0, 2.0, 150.0, 1.0);
        let tested = kalman_update(&base, 4.0, 1.0, 160.0, 0.25);
        let normal = kalman_update(&base, 4.0, 1.0, 160.0, 1.0);
        let target = 160.0;
        let pred = |k: &KalmanState| kalman_predict(k, 4.0, 1.0);
        assert!((pred(&tested) - target).abs() < (pred(&normal) - target).abs());
    }
}
