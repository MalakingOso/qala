// Automatic rest timer (PLAN 6.6, RESEARCH-rest-and-warmup.md part 1).
// Tags in research: [meta]/[RCT]/[obs] sourced; [derived] assumed to tune.

import type { Approach } from "./state.ts";
import { ReasonCode } from "./volume.ts";

export type ExerciseClass = "main" | "secondary" | "isolation";

export interface RestTableCell {
  base: number;
  min: number;
  max: number;
}

const TABLE: Record<Approach, Record<ExerciseClass, RestTableCell>> = {
  strength: {
    main: { base: 180, min: 120, max: 300 },
    secondary: { base: 150, min: 90, max: 240 },
    isolation: { base: 90, min: 60, max: 150 },
  },
  hypertrophy: {
    main: { base: 150, min: 90, max: 240 },
    secondary: { base: 120, min: 90, max: 180 },
    isolation: { base: 90, min: 60, max: 150 },
  },
  maintenance: {
    main: { base: 150, min: 90, max: 240 },
    secondary: { base: 120, min: 90, max: 180 },
    isolation: { base: 90, min: 60, max: 150 },
  },
};

export function restCell(approach: Approach, cls: ExerciseClass): RestTableCell {
  return TABLE[approach][cls];
}

export interface RestInput {
  approach: Approach;
  cls: ExerciseClass;
  /** Explicit liftoscript timers value replaces B (clamps/adjustments/m apply). */
  explicitBase?: number;
  m?: number; // personal multiplier, default 1
  rpeLogged?: number;
  rpeTarget?: number;
  failed?: boolean; // RPE>=10 or short with RPE>=9.5
  repsShort?: boolean; // below bottom of range, no failure
  setIndex?: number; // 1-based index of the set just logged
  drift?: boolean; // rep drift >=20% (hyp) or RPE drift >=1 (strength)
  lowReadiness?: boolean; // soreness 4 on targets, prs<=4, fatigueLocal>=0.7
  superset?: boolean; // inside antagonist pair (strength mains never pair)
  overTimeBudget?: boolean; // >10% over session time budget
}

export interface RestResult {
  seconds: number;
  base: number;
  m: number;
  adjustments: number;
  reasons: ReasonCode[];
  warnBelowMinStrengthMain: boolean;
}

export function round15(s: number): number {
  return Math.round(s / 15) * 15;
}

/** Effort adjustment: clamp(30*d, -30, +45); failure replaces it. */
export function effortAdjust(rpeLogged: number | undefined, rpeTarget: number | undefined): number {
  if (rpeLogged === undefined || rpeTarget === undefined) return 0;
  return Math.min(45, Math.max(-30, 30 * (rpeLogged - rpeTarget)));
}

export function computeRest(input: RestInput): RestResult {
  const cell = restCell(input.approach, input.cls);
  const B = input.explicitBase ?? cell.base;
  const m = input.m ?? 1;
  let adj = 0;
  const reasons: ReasonCode[] = [];

  if (input.superset) {
    const secs = input.overTimeBudget ? 60 : 90; // Paz 2019
    return { seconds: secs, base: B, m, adjustments: 0, reasons: [ReasonCode.REST_SUPERSET], warnBelowMinStrengthMain: false };
  }

  if (input.failed) {
    const a = input.cls === "isolation" ? 30 : 60;
    adj += a;
    reasons.push(ReasonCode.REST_FAILURE);
  } else {
    const e = effortAdjust(input.rpeLogged, input.rpeTarget);
    if (e > 0) {
      adj += e;
      reasons.push(ReasonCode.REST_EFFORT_HIGH);
    } else if (e < 0) {
      adj += e;
      reasons.push(ReasonCode.REST_EFFORT_LOW);
    }
  }
  if (input.repsShort && !input.failed) {
    adj += 30;
    reasons.push(ReasonCode.REST_REPS_SHORT);
  }
  const lateSet = input.approach === "strength" && input.cls === "main" && (input.setIndex ?? 0) >= 4;
  if (lateSet) {
    adj += 30;
    reasons.push(ReasonCode.REST_LATE_SET);
  }
  if (input.drift && !lateSet) {
    adj += 30;
    reasons.push(ReasonCode.REST_DRIFT);
  } else if (input.drift && lateSet) {
    reasons.push(ReasonCode.REST_DRIFT); // larger of the two: still +30 once
  }
  if (input.lowReadiness) {
    adj += 30;
    reasons.push(ReasonCode.REST_LOW_READINESS);
  }
  const seconds = Math.min(cell.max, Math.max(cell.min, round15(B * m + adj)));
  return { seconds, base: B, m, adjustments: adj, reasons, warnBelowMinStrengthMain: false };
}

/** Rest after an antagonist pair: 120 s (Behenck 2022). */
export const REST_AFTER_PAIR = 120;

/** "Ready early" tap: may start below R; warning only below min on strength main. */
export function earlyStartWarning(approach: Approach, cls: ExerciseClass, prescribed: number, actual: number): boolean {
  const cell = restCell(approach, cls);
  return approach === "strength" && cls === "main" && actual < cell.min && actual < prescribed;
}

export interface LearnInput {
  m: number;
  B: number;
  adjustments: number;
  actual: number; // actual rest taken
  prescribed: number; // R that was shown
  hitTarget: boolean; // reps in range and RPE <= target + 0.5
  warmup?: boolean;
}

export interface LearnResult {
  m: number;
  samples: number;
  updated: boolean;
}

/**
 * Personal multiplier learning, alpha 0.1 (~10 rests memory) [derived].
 * Early start that misses: no update. Warm-up sets: never update.
 */
export function learnRestMultiplier(
  cur: { m: number; samples: number },
  input: LearnInput,
): LearnResult {
  if (input.warmup) return { ...cur, updated: false };
  const mObs = Math.min(1.5, Math.max(0.75, (input.actual - input.adjustments) / input.B));
  if (input.hitTarget) {
    const m = cur.m + 0.1 * (mObs - cur.m);
    return { m, samples: cur.samples + 1, updated: true };
  }
  if (input.actual < input.prescribed) return { ...cur, updated: false }; // early miss: no update
  const m = cur.m + 0.1 * (Math.min(1.5, 1.15 * cur.m) - cur.m);
  return { m, samples: cur.samples + 1, updated: true };
}

/** Human reason line, e.g. "3:15 · base 3:00, your pace -15 s, last set RPE 9 vs 8 +30 s". */
export function restReasonLine(res: RestResult, rpeLogged?: number, rpeTarget?: number): string {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  const parts = [`base ${fmt(res.base)}`];
  if (Math.abs(res.m - 1) > 1e-9) {
    const d = Math.round(res.base * res.m - res.base);
    parts.push(`your pace ${d > 0 ? "+" : "-"}${fmt(Math.abs(d))}`);
  }
  if (res.reasons.includes(ReasonCode.REST_EFFORT_HIGH) && rpeLogged !== undefined && rpeTarget !== undefined) {
    parts.push(`last set RPE ${rpeLogged} vs ${rpeTarget} +30 s/point`);
  }
  if (res.reasons.includes(ReasonCode.REST_FAILURE)) parts.push("failure +60 s");
  if (res.reasons.includes(ReasonCode.REST_REPS_SHORT)) parts.push("reps short +30 s");
  if (res.reasons.includes(ReasonCode.REST_LATE_SET)) parts.push("late set +30 s");
  if (res.reasons.includes(ReasonCode.REST_DRIFT)) parts.push("drift +30 s");
  if (res.reasons.includes(ReasonCode.REST_LOW_READINESS)) parts.push("low readiness +30 s");
  return `${fmt(res.seconds)} · ${parts.join(", ")}`;
}
