// Auto-pause: below 0.6 m/s held 5 s pauses; above 1.0 m/s held 3 s resumes.
// Paused time is excluded from moving time, never from elapsed.
//
// The pause interval starts retroactively at the first sub-threshold sample
// and ends at the first above-resume sample, so the still seconds and the
// 3 s confirmation run-up count as documented: stillness excluded, running
// included. A run that ends mid-pause closes the interval at the last fix.

import type { PauseInterval } from "./types.ts";

export interface AutoPauseOptions {
  /** Speed under which the low timer runs (m/s). Default 0.6. */
  lowMps?: number;
  /** Seconds under lowMps that triggers a pause. Default 5. */
  lowHoldSec?: number;
  /** Speed above which the resume timer runs (m/s). Default 1.0. */
  highMps?: number;
  /** Seconds above highMps that resumes. Default 3. */
  highHoldSec?: number;
}

export interface SpeedSample {
  t: number;
  speedMps: number;
}

/** Streaming state machine. Feed samples in timestamp order. */
export class AutoPause {
  private readonly lowMps: number;
  private readonly lowHoldSec: number;
  private readonly highMps: number;
  private readonly highHoldSec: number;

  state: "moving" | "paused" = "moving";
  private lowStart: number | null = null;
  private highStart: number | null = null;
  private pauseStart = 0;
  private lastT = -Infinity;
  readonly intervals: PauseInterval[] = [];

  constructor(opts: AutoPauseOptions = {}) {
    this.lowMps = opts.lowMps ?? 0.6;
    this.lowHoldSec = opts.lowHoldSec ?? 5;
    this.highMps = opts.highMps ?? 1.0;
    this.highHoldSec = opts.highHoldSec ?? 3;
  }

  update(t: number, speedMps: number): "moving" | "paused" {
    if (t > this.lastT) this.lastT = t;
    if (this.state === "moving") {
      if (speedMps < this.lowMps) {
        if (this.lowStart === null) this.lowStart = t;
        if (t - this.lowStart >= this.lowHoldSec) {
          this.state = "paused";
          this.pauseStart = this.lowStart;
          this.lowStart = null;
          this.highStart = null;
        }
      } else {
        this.lowStart = null;
      }
    } else {
      if (speedMps > this.highMps) {
        if (this.highStart === null) this.highStart = t;
        if (t - this.highStart >= this.highHoldSec) {
          this.state = "moving";
          this.intervals.push({
            startT: this.pauseStart,
            endT: this.highStart,
          });
          this.highStart = null;
          this.lowStart = null;
        }
      } else {
        this.highStart = null;
      }
    }
    return this.state;
  }

  /** Call after the last sample: closes an open pause at the final timestamp. */
  finish(): PauseInterval[] {
    if (this.state === "paused" && this.lastT !== -Infinity) {
      this.intervals.push({ startT: this.pauseStart, endT: this.lastT });
      this.state = "moving";
    }
    return this.intervals;
  }
}

/** Total paused seconds overlapping [fromT, toT]. */
export function pausedOverlap(
  intervals: PauseInterval[],
  fromT: number,
  toT: number,
): number {
  let total = 0;
  for (const p of intervals) {
    const s = Math.max(p.startT, fromT);
    const e = Math.min(p.endT, toT);
    if (e > s) total += e - s;
  }
  return total;
}

/** Moving seconds on the fix clock between two timestamps. */
export function movingElapsedAt(
  intervals: PauseInterval[],
  fromT: number,
  toT: number,
): number {
  if (toT <= fromT) return 0;
  return toT - fromT - pausedOverlap(intervals, fromT, toT);
}

export interface PauseResult {
  paused: PauseInterval[];
  movingSec: number;
  elapsedSec: number;
}

/** Batch convenience: pauses, moving time and elapsed time for one run. */
export function computePauses(
  points: SpeedSample[],
  opts: AutoPauseOptions = {},
): PauseResult {
  const machine = new AutoPause(opts);
  for (const p of points) machine.update(p.t, p.speedMps);
  const paused = machine.finish();
  if (points.length < 2) return { paused, movingSec: 0, elapsedSec: 0 };
  const elapsedSec = points[points.length - 1].t - points[0].t;
  const movingSec = Math.max(
    0,
    elapsedSec -
      pausedOverlap(paused, points[0].t, points[points.length - 1].t),
  );
  return { paused, movingSec, elapsedSec };
}
