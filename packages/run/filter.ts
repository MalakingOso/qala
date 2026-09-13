// GPS fix filter: dedupe, accuracy gate, speed gate with re-anchor,
// constant-velocity Kalman filter, Vincenty distance.
//
// Pure TypeScript: no DOM, no Capacitor imports. The fix source (Capacitor
// plugin on the phone, fixture arrays in tests) is injected by the caller.
//
// Pipeline order per fix, in timestamp order (RESEARCH-run-tracking.md 3):
//  1. Dedupe by timestamp: drop t <= highest timestamp seen so far. One
//     owner of location, never two merged streams.
//  2. Accuracy gate: drop fixes with horizontal accuracy > 25 m.
//  3. Speed gate: reject a jump implying > 7 m/s from the last accepted fix,
//     unless 3 consecutive fixes agree with each other, in which case the
//     anchor was wrong and we re-anchor (jump distance is not counted).
//  4. Constant-velocity Kalman filter on position and velocity in local
//     metres (east/north), measurement noise R = accuracy squared.
//  5. Distance sums Vincenty segments between filtered positions.
// There is no cap on stored points and no warm-up holdout: the first
// accepted fix is kept.

import type { FilteredPoint, Fix } from "./types.ts";

export interface FilterOptions {
  /** Drop fixes with acc above this (m). Default 25. */
  accuracyGateM?: number;
  /** Reject jumps implying more than this (m/s). Default 7. */
  speedGateMps?: number;
  /** Consecutive mutually-consistent rejects that force a re-anchor. Default 3. */
  reanchorCount?: number;
  /** Process-noise acceleration sd (m/s^2). Default 1.5. */
  accelNoise?: number;
}

const DEFAULTS = {
  accuracyGateM: 25,
  speedGateMps: 7,
  reanchorCount: 3,
  accelNoise: 1.5,
} as const;

const WGS_A = 6378137;
const WGS_F = 1 / 298.257223563;
const DEG_M = (Math.PI * WGS_A) / 180;

/** Geodesic distance in metres (Vincenty inverse, WGS-84). */
export function vincentyM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const a = WGS_A;
  const f = WGS_F;
  const b = (1 - f) * a;
  const toRad = Math.PI / 180;
  const u1 = Math.atan((1 - f) * Math.tan(lat1 * toRad));
  const u2 = Math.atan((1 - f) * Math.tan(lat2 * toRad));
  const L = (lon2 - lon1) * toRad;
  const sinU1 = Math.sin(u1);
  const cosU1 = Math.cos(u1);
  const sinU2 = Math.sin(u2);
  const cosU2 = Math.cos(u2);
  let lambda = L;
  let sinSigma = 0;
  let cosSigma = 0;
  let sigma = 0;
  let sinAlpha = 0;
  let cosSqAlpha = 0;
  let cos2SigmaM = 0;
  for (let i = 0; i < 200; i++) {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt(
      (cosU2 * sinLambda) * (cosU2 * sinLambda) +
        (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) *
          (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda),
    );
    if (sinSigma === 0) return 0; // coincident points
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSqAlpha === 0
      ? 0 // equatorial line
      : cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;
    const C = (f / 16) * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
    const lambdaPrev = lambda;
    lambda = L +
      (1 - C) * f * sinAlpha *
        (sigma +
          C * sinSigma *
            (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    if (Math.abs(lambda - lambdaPrev) < 1e-12) {
      const uSq = cosSqAlpha * (a * a - b * b) / (b * b);
      const A = 1 +
        (uSq / 16384) *
          (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
      const B = (uSq / 1024) *
        (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
      const deltaSigma = B * sinSigma *
        (cos2SigmaM +
          (B / 4) *
            (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
              (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) *
                (-3 + 4 * cos2SigmaM * cos2SigmaM)));
      return b * A * (sigma - deltaSigma);
    }
  }
  // Antipodal or otherwise non-convergent: never happens on a running
  // segment, but stay total rather than NaN.
  return haversineM(lat1, lon1, lat2, lon2);
}

/** Spherical fallback in metres. Stored distance uses Vincenty; the ~0.3%
 *  systematic error is why haversine is fallback-only (RESEARCH-run-tracking.md 3). */
export function haversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
      Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** One axis of the constant-velocity model: state [pos, vel] in local metres. */
class AxisFilter {
  x: number;
  v: number;
  private p00: number;
  private p01: number;
  private p11: number;
  private readonly accelVar: number;

  constructor(pos: number, posVar: number, accelNoise: number) {
    this.x = pos;
    this.v = 0;
    this.p00 = posVar;
    this.p01 = 0;
    // Velocity starts unknown: sd of a fast run so the first seconds converge.
    this.p11 = 9;
    this.accelVar = accelNoise * accelNoise;
  }

  predict(dt: number): void {
    this.x += this.v * dt;
    const p00 = this.p00;
    const p01 = this.p01;
    // Q = G G' a^2 with G = [dt^2/2, dt].
    const q00 = 0.25 * dt * dt * dt * dt * this.accelVar;
    const q01 = 0.5 * dt * dt * dt * this.accelVar;
    const q11 = dt * dt * this.accelVar;
    this.p00 = p00 + dt * (p01 + p01) + dt * dt * this.p11 + q00;
    this.p01 = p01 + dt * this.p11 + q01;
    this.p11 = this.p11 + q11;
  }

  update(z: number, r: number): void {
    const y = z - this.x;
    const s = this.p00 + r;
    const k0 = this.p00 / s;
    const k1 = this.p01 / s;
    this.x += k0 * y;
    this.v += k1 * y;
    const p00 = this.p00;
    const p01 = this.p01;
    this.p00 = (1 - k0) * p00;
    this.p01 = (1 - k0) * p01;
    this.p11 = this.p11 - k1 * p01;
  }
}

/** Streaming filter. Feed fixes in any arrival order; results are identical
 *  for batched-late and on-time delivery because everything keys off fix.t. */
export class FixFilter {
  private readonly accuracyGateM: number;
  private readonly speedGateMps: number;
  private readonly reanchorCount: number;
  private readonly accelNoise: number;

  private origin: { lat: number; lon: number } | null = null;
  private fx: AxisFilter | null = null;
  private fy: AxisFilter | null = null;
  private anchor: Fix | null = null;
  private pending: Fix[] = [];
  private lastT = -Infinity;
  private lastLat = 0;
  private lastLon = 0;
  private distM = 0;
  readonly points: FilteredPoint[] = [];

  constructor(opts: FilterOptions = {}) {
    this.accuracyGateM = opts.accuracyGateM ?? DEFAULTS.accuracyGateM;
    this.speedGateMps = opts.speedGateMps ?? DEFAULTS.speedGateMps;
    this.reanchorCount = opts.reanchorCount ?? DEFAULTS.reanchorCount;
    this.accelNoise = opts.accelNoise ?? DEFAULTS.accelNoise;
  }

  private toLocal(lat: number, lon: number): { x: number; y: number } {
    const o = this.origin!;
    return {
      x: (lon - o.lon) * DEG_M * Math.cos(o.lat * Math.PI / 180),
      y: (lat - o.lat) * DEG_M,
    };
  }

  private fromLocal(x: number, y: number): { lat: number; lon: number } {
    const o = this.origin!;
    return {
      lat: o.lat + y / DEG_M,
      lon: o.lon + x / (DEG_M * Math.cos(o.lat * Math.PI / 180)),
    };
  }

  private emit(fix: Fix, markGap: boolean): void {
    if (this.origin === null) {
      this.origin = { lat: fix.lat, lon: fix.lon };
      const r = Math.max(fix.acc * fix.acc, 1);
      const p = this.toLocal(fix.lat, fix.lon);
      this.fx = new AxisFilter(p.x, r, this.accelNoise);
      this.fy = new AxisFilter(p.y, r, this.accelNoise);
    } else {
      const dt = Math.max(fix.t - this.lastT, 0);
      const p = this.toLocal(fix.lat, fix.lon);
      const r = Math.max(fix.acc * fix.acc, 1);
      if (dt > 0) {
        this.fx!.predict(dt);
        this.fy!.predict(dt);
      }
      this.fx!.update(p.x, r);
      this.fy!.update(p.y, r);
    }
    const ll = this.fromLocal(this.fx!.x, this.fy!.x);
    let step = 0;
    let gap = false;
    if (this.points.length > 0 && !markGap) {
      step = vincentyM(this.lastLat, this.lastLon, ll.lat, ll.lon);
    } else if (this.points.length > 0 && markGap) {
      gap = true;
    }
    this.distM += step;
    this.lastT = fix.t;
    this.lastLat = ll.lat;
    this.lastLon = ll.lon;
    const pt: FilteredPoint = {
      t: fix.t,
      lat: ll.lat,
      lon: ll.lon,
      speedMps: Math.hypot(this.fx!.v, this.fy!.v),
      distM: this.distM,
      acc: fix.acc,
    };
    if (fix.hr !== undefined) pt.hr = fix.hr;
    if (fix.cad !== undefined) pt.cad = fix.cad;
    if (fix.ele !== undefined) pt.ele = fix.ele;
    if (gap) pt.gap = true;
    this.points.push(pt);
  }

  /** Returns true when the fix was accepted (emitted), false when dropped. */
  push(fix: Fix): boolean {
    // Dedupe against the accepted clock only: a rejected fix (bad accuracy,
    // jump) must not consume its timestamp and eat the good fix sharing it.
    if (!Number.isFinite(fix.t)) return false;
    if (this.points.length > 0 && fix.t <= this.lastT) return false;
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return false;
    if (!(fix.acc >= 0) || fix.acc > this.accuracyGateM) return false;

    if (this.anchor === null) {
      this.anchor = fix;
      this.emit(fix, false);
      return true;
    }

    const dt = fix.t - this.anchor.t;
    const jump = vincentyM(this.anchor.lat, this.anchor.lon, fix.lat, fix.lon);
    if (dt > 0 && jump / dt <= this.speedGateMps) {
      // Accept, flushing nothing: pending rejects stay rejected.
      this.pending = [];
      this.anchor = fix;
      this.emit(fix, false);
      return true;
    }

    // Possible jump: buffer and check whether the newcomers agree with each
    // other rather than with the anchor. Only the latest quorum-sized window
    // can trigger, so the buffer never grows past it.
    this.pending.push(fix);
    while (this.pending.length > this.reanchorCount) this.pending.shift();
    if (this.pending.length >= this.reanchorCount) {
      const tail = this.pending.slice(-this.reanchorCount);
      let agree = true;
      for (let i = 1; i < tail.length; i++) {
        const a = tail[i - 1];
        const b = tail[i];
        const d = vincentyM(a.lat, a.lon, b.lat, b.lon);
        if ((b.t - a.t) <= 0 || d / (b.t - a.t) > this.speedGateMps) {
          agree = false;
          break;
        }
      }
      if (agree) {
        // The anchor was wrong, not them: drop the jump, re-anchor at the
        // first agreeing fix and count distance only from there.
        const first = tail[0];
        this.origin = { lat: first.lat, lon: first.lon };
        const r = Math.max(first.acc * first.acc, 1);
        this.fx = new AxisFilter(0, r, this.accelNoise);
        this.fy = new AxisFilter(0, r, this.accelNoise);
        // Pin the clock so the re-anchor point predicts with dt = 0.
        this.lastT = first.t;
        this.anchor = first;
        this.emit(first, true);
        for (let i = 1; i < tail.length; i++) {
          const f = tail[i];
          this.anchor = f;
          this.emit(f, false);
        }
        this.pending = [];
        return true;
      }
    }
    return false;
  }
}

/** Batch convenience over FixFilter. Input order is arrival order; fixes
 *  whose timestamps go backwards are dropped as duplicates. */
export function filterFixes(
  fixes: Fix[],
  opts: FilterOptions = {},
): FilteredPoint[] {
  const f = new FixFilter(opts);
  for (const fix of fixes) f.push(fix);
  return f.points;
}
