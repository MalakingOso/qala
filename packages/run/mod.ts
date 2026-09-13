// @qala/run: GPS run-recording pipeline. Pure TypeScript, no DOM, no
// Capacitor imports. The phone app injects fixes from the background
// geolocation plugin; every function also accepts fixture arrays.
//
// Full pipeline: filterFixes -> computePauses -> splits + pace (+ guided).

import type { Fix, Run, RunWorkout } from "./types.ts";
import { filterFixes, type FilterOptions } from "./filter.ts";
import { averagePace, cuePace, currentPace } from "./pace.ts";
import {
  type AutoPauseOptions,
  computePauses,
  movingElapsedAt,
} from "./autopause.ts";
import { computeSplits, MILE_M, type SplitOptions } from "./splits.ts";
import { type GuidedEvent, type GuidedOptions, GuidedRun } from "./guided.ts";

export * from "./types.ts";
export * from "./filter.ts";
export * from "./pace.ts";
export * from "./autopause.ts";
export * from "./splits.ts";
export * from "./guided.ts";
export * from "./gpx.ts";
export * from "./tcx.ts";
export * from "./load.ts";

export interface ProcessRunOptions {
  filter?: FilterOptions;
  autopause?: AutoPauseOptions;
  splits?: SplitOptions;
  /** Metres per split boundary. Shorthand for splits.splitM. Default mile. */
  splitM?: number;
  /** When present, the guided machine runs over the whole track. */
  workout?: RunWorkout;
  guided?: GuidedOptions;
}

export interface ProcessedRun extends Run {
  /** Guided events in track order (only when workout was provided). */
  guidedEvents: GuidedEvent[];
}

/**
 * Run the full pipeline over raw fixes in arrival order. Distance sums
 * Vincenty segments on the filtered track; moving time excludes auto-paused
 * intervals; splits interpolate boundary crossings on the fix clock; guided
 * steps advance on moving time with the 30 s cue pace.
 */
export function processRun(
  fixes: Fix[],
  opts: ProcessRunOptions = {},
): ProcessedRun {
  const points = filterFixes(fixes, opts.filter);
  const pauses = points.length >= 2
    ? computePauses(points, opts.autopause)
    : { paused: [], movingSec: 0, elapsedSec: 0 };
  const splits = computeSplits(points, {
    ...opts.splits,
    ...(opts.splitM !== undefined ? { splitM: opts.splitM } : {}),
  });
  const cur = currentPace(points);
  const cue = cuePace(points);
  const avg = points.length >= 2
    ? averagePace(
      points[points.length - 1].distM,
      pauses.movingSec,
    )
    : null;

  const guidedEvents: GuidedEvent[] = [];
  if (opts.workout && points.length > 0) {
    const guided = new GuidedRun(opts.workout, opts.guided);
    const t0 = points[0].t;
    // Points arrive in increasing t (dedupe guarantees it), so the window
    // grows by one each step instead of rescanning the whole track.
    const window = points.slice(0, 1);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (i > 0) window.push(p);
      const moving = movingElapsedAt(pauses.paused, t0, p.t);
      const cueAt = cuePace(window, p.t);
      guidedEvents.push(
        ...guided.update({
          cueSpeedMps: cueAt?.speedMps ?? null,
          distM: p.distM,
          timeSec: moving,
        }),
      );
    }
  }

  return {
    distanceM: points.length > 0 ? points[points.length - 1].distM : 0,
    movingSec: pauses.movingSec,
    elapsedSec: pauses.elapsedSec,
    avgSpeedMps: avg?.speedMps ?? 0,
    currentSpeedMps: cur?.speedMps ?? null,
    cueSpeedMps: cue?.speedMps ?? null,
    splits,
    paused: pauses.paused,
    points,
    guidedEvents,
  };
}

export { MILE_M };
