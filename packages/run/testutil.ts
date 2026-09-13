// Shared test helpers for @qala/run. Zero imports: no network needed.

import type { Fix } from "./types.ts";

export function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

export function assertClose(
  actual: number,
  expected: number,
  tol: number,
  msg: string,
): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tol) {
    throw new Error(
      `assertClose failed: ${msg}: actual=${actual} expected=${expected} tol=${tol}`,
    );
  }
}

/** Fixes along a due-north line at constant speed, 1 Hz by default. */
export function lineFixes(args: {
  count: number;
  speedMps?: number;
  t0?: number;
  dt?: number;
  startLat?: number;
  startLon?: number;
  acc?: number;
  hr?: number;
}): Fix[] {
  const {
    count,
    speedMps = 3,
    t0 = 0,
    dt = 1,
    startLat = 47.6062,
    startLon = -122.3321,
    acc = 3,
    hr,
  } = args;
  const out: Fix[] = [];
  for (let i = 0; i < count; i++) {
    const f: Fix = {
      t: t0 + i * dt,
      lat: startLat + (speedMps * i * dt) / 111319.49,
      lon: startLon,
      acc,
    };
    if (hr !== undefined) f.hr = hr;
    out.push(f);
  }
  return out;
}

/** Stationary fixes at one spot (filtered speed decays to ~0). */
export function stopFixes(args: {
  count: number;
  t0: number;
  lat: number;
  lon: number;
  dt?: number;
  acc?: number;
}): Fix[] {
  const { count, t0, lat, lon, dt = 1, acc = 3 } = args;
  const out: Fix[] = [];
  for (let i = 0; i < count; i++) out.push({ t: t0 + i * dt, lat, lon, acc });
  return out;
}
