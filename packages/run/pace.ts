// Pace: 20 s current pace, 30 s audio-cue pace, average pace.
//
// All windows key off fix timestamps, never callback wall clock, so a batch
// delivered late after screen lock gives the same pace as on-time delivery.
// Speeds in m/s; paceSecPerM (s/m) converts to min/mi in the UI.

export interface PaceSample {
  t: number;
  distM: number;
}

export interface PaceResult {
  speedMps: number;
  /** Seconds per metre; multiply by 1609.344 and divide by 60 for min/mi. */
  paceSecPerM: number;
}

export const CURRENT_PACE_WINDOW_SEC = 20;
export const CUE_PACE_WINDOW_SEC = 30;
/** Minimum window span before a pace reads out instead of null. */
const MIN_SPAN_SEC = 5;

function toResult(speedMps: number): PaceResult | null {
  if (!Number.isFinite(speedMps) || speedMps <= 0) return null;
  return { speedMps, paceSecPerM: 1 / speedMps };
}

/** Linearly interpolated cumulative distance at time t. */
export function distAt(points: PaceSample[], t: number): number | null {
  if (points.length === 0) return null;
  if (t <= points[0].t) return points[0].distM;
  const last = points[points.length - 1];
  if (t >= last.t) return last.distM;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = b.t - a.t;
  if (span <= 0) return a.distM;
  return a.distM + (b.distM - a.distM) * ((t - a.t) / span);
}

/**
 * Speed over the trailing windowSec ending at nowT: interpolated distance
 * covered divided by the actual time span. Returns null when the covered
 * span is under MIN_SPAN_SEC (run just started) or there are no points.
 */
export function windowSpeed(
  points: PaceSample[],
  nowT: number,
  windowSec: number,
): PaceResult | null {
  if (points.length < 2) return null;
  const endT = Math.min(nowT, points[points.length - 1].t);
  const startT = endT - windowSec;
  const firstT = points[0].t;
  const span = endT - Math.max(startT, firstT);
  if (span < MIN_SPAN_SEC) return null;
  const dEnd = distAt(points, endT);
  const dStart = distAt(points, Math.max(startT, firstT));
  if (dEnd === null || dStart === null) return null;
  return toResult((dEnd - dStart) / span);
}

/** Live pace over the 20 s window. Defaults to the last fix's timestamp. */
export function currentPace(
  points: PaceSample[],
  nowT?: number,
): PaceResult | null {
  if (points.length === 0) return null;
  return windowSpeed(
    points,
    nowT ?? points[points.length - 1].t,
    CURRENT_PACE_WINDOW_SEC,
  );
}

/** Guided-workout and audio-cue pace over the 30 s window. */
export function cuePace(
  points: PaceSample[],
  nowT?: number,
): PaceResult | null {
  if (points.length === 0) return null;
  return windowSpeed(
    points,
    nowT ?? points[points.length - 1].t,
    CUE_PACE_WINDOW_SEC,
  );
}

/** Average pace = distance / moving time (paused time excluded, elapsed kept). */
export function averagePace(
  distanceM: number,
  movingSec: number,
): PaceResult | null {
  if (!(movingSec > 0) || !(distanceM >= 0)) return null;
  return toResult(distanceM / movingSec);
}
