// Splits: one boundary per split unit (mile default, configurable), with the
// crossing time interpolated linearly between the two fixes straddling it.

import type { Split } from "./types.ts";

/** Metres per mile (default split unit: settings.units.distance = 'mi'). */
export const MILE_M = 1609.344;
/** Metres per kilometre. */
export const KM_M = 1000;

export interface SplitOptions {
  /** Boundary spacing in metres. Default MILE_M. */
  splitM?: number;
  /** Trailing partial splits under this length (m) are dropped. Default 1. */
  minPartialM?: number;
}

export interface SplitPoint {
  t: number;
  distM: number;
  hr?: number;
}

/**
 * Split times use the fix clock (elapsed time, pauses included): a split
 * covers the wall time between its boundary crossings. Partial trailing
 * splits are included when they reach minPartialM.
 */
export function computeSplits(
  points: SplitPoint[],
  opts: SplitOptions = {},
): Split[] {
  const splitM = opts.splitM ?? MILE_M;
  const minPartialM = opts.minPartialM ?? 1;
  if (!(splitM > 0) || points.length < 2) return [];
  const t0 = points[0].t;
  const total = points[points.length - 1].distM;
  const full = Math.floor(total / splitM);
  const splits: Split[] = [];
  let prevT = t0;
  let prevBoundary = 0;
  let seg = 1;
  for (let n = 1; n <= full; n++) {
    const boundary = n * splitM;
    const cross = crossingAt(points, prevBoundary, boundary);
    if (cross === null) break;
    splits.push({
      index: seg++,
      distM: splitM,
      sec: cross.t - prevT,
      cumDistM: boundary,
      cumSec: cross.t - t0,
      ...(cross.hrAvg !== undefined ? { hrAvg: cross.hrAvg } : {}),
    });
    prevT = cross.t;
    prevBoundary = boundary;
  }
  const rest = total - full * splitM;
  if (rest >= minPartialM) {
    const endT = points[points.length - 1].t;
    const hrs = points.filter((p) =>
      p.distM > full * splitM && p.hr !== undefined
    );
    splits.push({
      index: seg,
      distM: rest,
      sec: endT - prevT,
      cumDistM: total,
      cumSec: endT - t0,
      ...(hrs.length > 0
        ? { hrAvg: hrs.reduce((s, p) => s + p.hr!, 0) / hrs.length }
        : {}),
    });
  }
  return splits;
}

function crossingAt(
  points: SplitPoint[],
  fromDist: number,
  boundary: number,
): { t: number; hrAvg?: number } | null {
  let prev: SplitPoint | null = null;
  const hrs: number[] = [];
  for (const p of points) {
    if (p.distM > fromDist && p.distM < boundary && p.hr !== undefined) {
      hrs.push(p.hr);
    }
    if (prev !== null && prev.distM < boundary && p.distM >= boundary) {
      const span = p.distM - prev.distM;
      const t = span > 0
        ? prev.t + (p.t - prev.t) * ((boundary - prev.distM) / span)
        : p.t;
      if (p.hr !== undefined) hrs.push(p.hr);
      return {
        t,
        ...(hrs.length > 0
          ? { hrAvg: hrs.reduce((s, h) => s + h, 0) / hrs.length }
          : {}),
      };
    }
    prev = p;
  }
  return null;
}
