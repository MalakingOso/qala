// Linear Kalman filter over e1RM observations (PLAN 6.2, Kolossa 2017).
// State [p0, k1, k2], observation y = p0 + k1*F - k2*(Gw + Gs).
// theta = k2/k1 (prior 4.0 lifts / 2.0 runs) is FIXED until >= 20 observations.

import type { KalmanState } from "./state.ts";

export function initKalman(
  p0: number,
  k1: number,
  thetaPrior: number,
  R = 4,
): KalmanState {
  // Honest prior variances: p0 within ~2 sd of R, gains within ~50%.
  // Oversized P0 makes early innovations (dominated by prior error, not
  // noise) whipsaw the gains and freeze wrong values once P collapses.
  const k2 = thetaPrior * k1;
  return {
    p0,
    k1,
    k2,
    thetaPrior,
    P: [[4 * R, 0, 0], [0, 0.25 * k1 * k1 + 1e-6, 0], [
      0,
      0,
      0.25 * k2 * k2 + 1e-6,
    ]],
    obs: 0,
    R,
  };
}

export function thetaOf(k: KalmanState): number {
  return k.k1 !== 0 ? k.k2 / k.k1 : k.thetaPrior;
}

type V3 = [number, number, number];

function matVecMul3(M: number[][], v: V3): V3 {
  return [
    M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
    M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
    M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
  ];
}

/**
 * One linear Kalman update. fitness F and fatigue (gw + gs) locate the
 * observation; noiseScale multiplies R (x0.25 variance for tested 1RMs...
 * PLAN says noise one quarter, applied as R/4).
 */
export function kalmanUpdate(
  k: KalmanState,
  fitness: number,
  fatigue: number,
  y: number,
  noiseScale = 1,
): KalmanState {
  // First observation anchors p0 (exact fit), transferring slope-prior error
  // into p0 where the honest P0 lets later excited data correct it gradually.
  if (k.obs === 0) {
    const p0 = y - k.k1 * fitness + k.k2 * fatigue;
    return {
      p0,
      k1: k.k1,
      k2: k.k2,
      thetaPrior: k.thetaPrior,
      P: k.P,
      obs: 1,
      R: k.R,
    };
  }
  const H: V3 = [1, fitness, -fatigue];
  const x: V3 = [k.p0, k.k1, k.k2];
  // Small process noise keeps the filter adaptive (Kolossa state-noise variant).
  const Q = 1e-6;
  const P = k.P.map((row, i) => row.map((v, j) => v + (i === j ? Q : 0)));
  const Hx = H[0] * x[0] + H[1] * x[1] + H[2] * x[2];
  const PHt = matVecMul3(P, H);
  const S = H[0] * PHt[0] + H[1] * PHt[1] + H[2] * PHt[2] + k.R * noiseScale;
  let K: V3 = [PHt[0] / S, PHt[1] / S, PHt[2] / S];
  const locked = k.obs < 20;
  if (locked) K = [K[0], K[1], 0]; // theta fixed until 20 observations
  const innov = y - Hx;
  const xn: V3 = [
    x[0] + K[0] * innov,
    x[1] + K[1] * innov,
    x[2] + K[2] * innov,
  ];
  // Joseph form P = (I-KH) P (I-KH)' + R K K' keeps P symmetric positive
  // definite in finite precision where (I-KH)P would drift and blow up.
  const IKH = [
    [1 - K[0] * H[0], -K[0] * H[1], -K[0] * H[2]],
    [-K[1] * H[0], 1 - K[1] * H[1], -K[1] * H[2]],
    [-K[2] * H[0], -K[2] * H[1], 1 - K[2] * H[2]],
  ];
  const Rv = k.R * noiseScale;
  const Pn = IKH.map((row, i) =>
    row.map((_, j) => {
      let v = Rv * K[i] * K[j];
      for (let a = 0; a < 3; a++) {
        let inner = 0;
        for (let b = 0; b < 3; b++) inner += P[a][b] * IKH[j][b];
        v += IKH[i][a] * inner;
      }
      return v;
    })
  );
  // Enforce exact symmetry.
  const Ps = Pn.map((row, i) => row.map((v, j) => (v + Pn[j][i]) / 2));
  let k2 = xn[2];
  if (locked) k2 = k.thetaPrior * xn[1]; // hold theta exactly at prior
  return {
    p0: xn[0],
    k1: xn[1],
    k2,
    thetaPrior: k.thetaPrior,
    P: Ps,
    obs: k.obs + 1,
    R: k.R,
  };
}

/** Model prediction p0 + k1*F - k2*(Gw + Gs) (weekly composite uses this). */
export function kalmanPredict(
  k: KalmanState,
  fitness: number,
  fatigue: number,
): number {
  return k.p0 + k.k1 * fitness - k.k2 * fatigue;
}
