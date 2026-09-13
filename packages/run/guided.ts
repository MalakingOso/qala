// Guided-workout step machine: consumes a RunWorkout, emits step changes and
// pace-zone speed up / slow down events from the 30 s cue pace.
//
// Hysteresis is two-fold so it does not nag at zone edges: prompts fire only
// outside a tolerance band around the zone, and successive prompts are
// rate-limited by a cooldown. Steps with neither distanceM nor seconds never
// auto-complete; advance them with advance().

import type { RunWorkout, WorkoutStep } from "./types.ts";

/** One workout step after repeat expansion. */
export interface ExpandedStep extends WorkoutStep {
  /** Position in the expanded sequence. */
  index: number;
}

export interface GuidedOptions {
  /** Prompt band half-width around the zone (m/s). Default 0.1 (~10 s/mi). */
  toleranceMps?: number;
  /** Minimum seconds between successive speed prompts. Default 45. */
  promptCooldownSec?: number;
}

export type GuidedEvent =
  | { type: "stepStart"; stepIndex: number; step: ExpandedStep }
  | { type: "stepEnd"; stepIndex: number }
  | { type: "workoutComplete" }
  | {
    type: "speedUp" | "slowDown" | "backInZone";
    stepIndex: number;
    cueSpeedMps: number;
  };

export interface StepSummary {
  step: ExpandedStep;
  stepIndex: number;
  startDistM: number;
  endDistM: number;
  startTimeSec: number;
  endTimeSec: number;
}

/** Expand per-step repeats in place (repeat = total executions, default 1). */
export function expandWorkout(workout: RunWorkout): ExpandedStep[] {
  const out: ExpandedStep[] = [];
  for (const step of workout.steps) {
    const n = Math.max(1, Math.floor(step.repeat ?? 1));
    for (let i = 0; i < n; i++) out.push({ ...step, index: out.length });
  }
  return out;
}

interface Zone {
  lo: number;
  hi: number;
}

function zoneOf(step: ExpandedStep, tol: number): Zone | null {
  let lo = step.paceLoMps;
  let hi = step.paceHiMps;
  if (lo === undefined && hi === undefined && step.targetMps !== undefined) {
    lo = step.targetMps - tol;
    hi = step.targetMps + tol;
  }
  if (lo === undefined || hi === undefined) return null;
  if (hi < lo) [lo, hi] = [hi, lo];
  return { lo, hi };
}

export class GuidedRun {
  private readonly steps: ExpandedStep[];
  private readonly toleranceMps: number;
  private readonly promptCooldownSec: number;

  private stepIndex = 0;
  private stepStartDistM = 0;
  private stepStartTimeSec = 0;
  private started = false;
  private done = false;
  private outOfZone: "slow" | "fast" | null = null;
  private lastPromptT = -Infinity;
  private summaries: StepSummary[] = [];

  constructor(workout: RunWorkout, opts: GuidedOptions = {}) {
    this.steps = expandWorkout(workout);
    this.toleranceMps = opts.toleranceMps ?? 0.1;
    this.promptCooldownSec = opts.promptCooldownSec ?? 45;
  }

  /** Expanded steps (one TCX Lap each). */
  get expandedSteps(): ExpandedStep[] {
    return this.steps;
  }

  /** Per-step measured summaries for finished steps. */
  get stepSummaries(): StepSummary[] {
    return this.summaries;
  }

  get currentStepIndex(): number {
    return this.stepIndex;
  }

  get complete(): boolean {
    return this.done;
  }

  /**
   * Advance the machine. distM is cumulative run distance, timeSec the run
   * clock step durations refer to (pass moving time), cueSpeedMps the 30 s
   * pace or null when it is not available yet.
   */
  update(args: {
    cueSpeedMps: number | null;
    distM: number;
    timeSec: number;
  }): GuidedEvent[] {
    const events: GuidedEvent[] = [];
    if (this.done || this.steps.length === 0) {
      if (!this.done && this.steps.length === 0) {
        this.done = true;
        events.push({ type: "workoutComplete" });
      }
      return events;
    }
    const step = this.steps[this.stepIndex];
    if (!this.started) {
      this.started = true;
      this.stepStartDistM = args.distM;
      this.stepStartTimeSec = args.timeSec;
      events.push({ type: "stepStart", stepIndex: this.stepIndex, step });
    }

    const zone = zoneOf(step, this.toleranceMps);
    if (zone !== null && args.cueSpeedMps !== null) {
      const v = args.cueSpeedMps;
      if (this.outOfZone === null) {
        if (
          v < zone.lo - this.toleranceMps &&
          args.timeSec - this.lastPromptT >= this.promptCooldownSec
        ) {
          this.outOfZone = "slow";
          this.lastPromptT = args.timeSec;
          events.push({
            type: "speedUp",
            stepIndex: this.stepIndex,
            cueSpeedMps: v,
          });
        } else if (
          v > zone.hi + this.toleranceMps &&
          args.timeSec - this.lastPromptT >= this.promptCooldownSec
        ) {
          this.outOfZone = "fast";
          this.lastPromptT = args.timeSec;
          events.push({
            type: "slowDown",
            stepIndex: this.stepIndex,
            cueSpeedMps: v,
          });
        }
      } else if (v >= zone.lo && v <= zone.hi) {
        this.outOfZone = null;
        events.push({
          type: "backInZone",
          stepIndex: this.stepIndex,
          cueSpeedMps: v,
        });
      } else if (args.timeSec - this.lastPromptT >= this.promptCooldownSec) {
        // Still out on the same side: re-prompt, never flip sides directly.
        const stillSlow = this.outOfZone === "slow" && v < zone.lo;
        const stillFast = this.outOfZone === "fast" && v > zone.hi;
        if (stillSlow || stillFast) {
          this.lastPromptT = args.timeSec;
          events.push({
            type: stillSlow ? "speedUp" : "slowDown",
            stepIndex: this.stepIndex,
            cueSpeedMps: v,
          });
        } else {
          this.outOfZone = v < zone.lo ? "slow" : "fast";
        }
      }
    }

    const distDone = step.distanceM !== undefined &&
      args.distM - this.stepStartDistM >= step.distanceM;
    const timeDone = step.seconds !== undefined &&
      args.timeSec - this.stepStartTimeSec >= step.seconds;
    if (distDone || timeDone) this.finishStep(args.distM, args.timeSec, events);
    return events;
  }

  /** Manually end the current step (open-ended steps with no end condition). */
  advance(distM: number, timeSec: number): GuidedEvent[] {
    const events: GuidedEvent[] = [];
    if (!this.done && this.steps.length > 0) {
      this.finishStep(distM, timeSec, events);
    }
    return events;
  }

  private finishStep(
    distM: number,
    timeSec: number,
    events: GuidedEvent[],
  ): void {
    const step = this.steps[this.stepIndex];
    events.push({ type: "stepEnd", stepIndex: this.stepIndex });
    this.summaries.push({
      step,
      stepIndex: this.stepIndex,
      startDistM: this.stepStartDistM,
      endDistM: distM,
      startTimeSec: this.stepStartTimeSec,
      endTimeSec: timeSec,
    });
    this.outOfZone = null;
    this.stepIndex++;
    if (this.stepIndex >= this.steps.length) {
      this.done = true;
      events.push({ type: "workoutComplete" });
    } else {
      this.stepStartDistM = distM;
      this.stepStartTimeSec = timeSec;
      events.push({
        type: "stepStart",
        stepIndex: this.stepIndex,
        step: this.steps[this.stepIndex],
      });
    }
  }
}
