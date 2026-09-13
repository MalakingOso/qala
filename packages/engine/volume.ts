// Volume rules (PLAN 6.3, RESEARCH B4-B5): RP landmarks, direct/fracSets
// counting, band logic, RP set-progression, deload triggers, double
// progression + Helms in-session adjustment, flags, ReasonCode enum.

export enum ReasonCode {
  // Volume / progression
  VOLUME_CAPPED_BY_MRV = "VOLUME_CAPPED_BY_MRV",
  RP_ADD_2 = "RP_ADD_2",
  RP_ADD_1 = "RP_ADD_1",
  RP_HOLD = "RP_HOLD",
  MUSCLE_DELOAD = "MUSCLE_DELOAD",
  WHOLE_BODY_DELOAD = "WHOLE_BODY_DELOAD",
  PLANNED_DELOAD = "PLANNED_DELOAD",
  DOUBLE_PROGRESSION = "DOUBLE_PROGRESSION",
  HELMS_ADJUST = "HELMS_ADJUST",
  NO_LOAD_INCREASE = "NO_LOAD_INCREASE",
  // Flags
  RECOVERY_NUDGE = "RECOVERY_NUDGE",
  INJURY_RISK = "INJURY_RISK",
  // Cross-modal (PLAN 6.4)
  RUN_BEFORE_LIFT = "RUN_BEFORE_LIFT",
  LIFT_BEFORE_HARD_RUN = "LIFT_BEFORE_HARD_RUN",
  SAME_DAY_ORDER = "SAME_DAY_ORDER",
  RUN_FATIGUE_HOLD = "RUN_FATIGUE_HOLD",
  POST_RACE_48H = "POST_RACE_48H",
  POST_RACE_5D = "POST_RACE_5D",
  HEAVY_LIFT_BEFORE_RUN = "HEAVY_LIFT_BEFORE_RUN",
  RUN_SPIKE = "RUN_SPIKE",
  MILEAGE_JUMP = "MILEAGE_JUMP",
  // Rest (PLAN 6.6)
  REST_FAILURE = "REST_FAILURE",
  REST_EFFORT_HIGH = "REST_EFFORT_HIGH",
  REST_EFFORT_LOW = "REST_EFFORT_LOW",
  REST_REPS_SHORT = "REST_REPS_SHORT",
  REST_LATE_SET = "REST_LATE_SET",
  REST_DRIFT = "REST_DRIFT",
  REST_LOW_READINESS = "REST_LOW_READINESS",
  REST_SUPERSET = "REST_SUPERSET",
}

export interface RpRow {
  mv: [number, number];
  mev: [number, number];
  mav: [number, number];
  mrv: [number, number];
}

/** RP landmarks, intermediate lifters, sets/week (PLAN 6.3). */
export const RP_LANDMARKS: Record<string, RpRow> = {
  chest: { mv: [2, 4], mev: [4, 6], mav: [6, 16], mrv: [16, 24] },
  back: { mv: [10, 12], mev: [12, 14], mav: [16, 22], mrv: [22, 30] },
  quads: { mv: [2, 4], mev: [4, 6], mav: [6, 14], mrv: [14, 18] },
  hamstrings: { mv: [0, 2], mev: [2, 4], mav: [2, 8], mrv: [8, 14] },
  glutes: { mv: [2, 6], mev: [6, 8], mav: [8, 24], mrv: [24, 30] },
  sidedelts: { mv: [2, 6], mev: [6, 8], mav: [8, 24], mrv: [24, 30] },
  biceps: { mv: [6, 8], mev: [8, 10], mav: [14, 20], mrv: [20, 26] },
  triceps: { mv: [0, 4], mev: [4, 6], mav: [6, 16], mrv: [16, 20] },
  calves: { mv: [2, 4], mev: [4, 6], mav: [6, 16], mrv: [16, 24] },
};

function normMuscle(m: string): string {
  return m.toLowerCase().replace(/[_\s-]/g, "");
}

/** Muscles without a row use chest's numbers (PLAN 6.3). */
export function rpRow(muscle: string): RpRow {
  return RP_LANDMARKS[normMuscle(muscle)] ?? RP_LANDMARKS.chest;
}

export type Priority = "grow" | "emphasise" | "maintain";

export interface BandTarget {
  fracMin: number | null; // null = no fractional floor (maintain)
  fracMax: number;
  directMin: number | null;
  directMax: number | null;
}

/** Owner's band constrains fracSets; RP constrains directSets (PLAN 6.3). */
export function bandTarget(muscle: string, priority: Priority): BandTarget {
  const rp = rpRow(muscle);
  if (priority === "maintain") {
    return { fracMin: null, fracMax: 20, directMin: rp.mv[1], directMax: rp.mev[1] };
  }
  const lo = priority === "emphasise" ? 14 : 10;
  return { fracMin: lo, fracMax: 20, directMin: rp.mev[0], directMax: rp.mrv[0] };
}

/** Block-start fracSets = max(band lo, MEV hi + indirect credit) (PLAN 6.3). */
export function blockStartFrac(muscle: string, priority: Priority, indirectCredit: number): number {
  const band = bandTarget(muscle, priority);
  const rp = rpRow(muscle);
  const start = rp.mev[1] + indirectCredit;
  return Math.max(band.fracMin ?? start, start);
}

/** Weekly ramp +2, capped (PLAN 6.3). Back starts at 14 via MEV. */
export function rampWeek(blockStart: number, weekIndex1: number, cap = 20): number {
  return Math.min(cap, blockStart + 2 * (weekIndex1 - 1));
}

export interface CountedSet {
  muscle: string;
  direct: boolean; // target (true) vs synergist (false)
  hard: boolean; // RPE >= 7 (or target RPE >= 7)
  runningEquivalent?: boolean; // NEVER counts toward targets
}

/**
 * Work set (B5.1): completed, not warm-up; main lifts also need load >= 50%
 * of the reference 1RM.
 */
export function isWorkSet(args: {
  completed: boolean;
  warmup?: boolean;
  load?: number;
  referenceRm?: number;
  isMain?: boolean;
}): boolean {
  if (!args.completed || args.warmup) return false;
  if (args.isMain && args.load !== undefined && args.referenceRm) {
    return args.load >= 0.5 * args.referenceRm;
  }
  return true;
}

/** Monday-Sunday week key (user timezone date string YYYY-MM-DD input). */
export function mondayKey(dateIso: string): string {
  const d = new Date(Date.parse(dateIso));
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return mon.toISOString().slice(0, 10);
}

/** Hard set: logged RPE >= 7, else program target RPE >= 7 (PLAN 6.3/B5). */
export function isHardSet(rpe?: number, targetRpe?: number): boolean {
  if (rpe !== undefined) return rpe >= 7;
  if (targetRpe !== undefined) return targetRpe >= 7;
  return false;
}

export function countSets(sets: CountedSet[]): { direct: number; frac: number } {
  let direct = 0;
  let frac = 0;
  for (const s of sets) {
    if (!s.hard || s.runningEquivalent) continue;
    if (s.direct) {
      direct += 1;
      frac += 1;
    } else {
      frac += 0.5;
    }
  }
  return { direct, frac };
}

/** RP set progression per muscle (PLAN 6.3): soreness/performance 1-4 taps. */
export type RpDecision =
  | { sets: 2; code: ReasonCode.RP_ADD_2 }
  | { sets: 1; code: ReasonCode.RP_ADD_1 }
  | { sets: 0; code: ReasonCode.RP_HOLD }
  | { sets: 0; code: ReasonCode.MUSCLE_DELOAD; deload: true };

export function rpProgression(
  soreness: 1 | 2 | 3 | 4,
  performance: 1 | 2 | 3 | 4,
  prs: number,
): RpDecision {
  if (performance === 4 || prs <= 4) {
    // Per-muscle reactive deload: 50% sets, +2 RIR, one session.
    return { sets: 0, code: ReasonCode.MUSCLE_DELOAD, deload: true };
  }
  if (soreness === 1 && performance === 1) return { sets: 2, code: ReasonCode.RP_ADD_2 };
  if (soreness <= 2 && performance <= 2) return { sets: 1, code: ReasonCode.RP_ADD_1 };
  return { sets: 0, code: ReasonCode.RP_HOLD };
}

export interface WholeBodyDeload {
  deload: boolean;
  setsFactor: number; // 0.6 = sets -40%
  loadFactor: number; // 0.9 = load -10%
  days: number;
}

/**
 * Whole-body reactive deload (Bell 2023): e1RM observations on two main lifts
 * below their own 4-week median on two consecutive sessions -> 5-7 d deload.
 */
export function wholeBodyDeload(
  recentObs: Record<string, number[]>, // lift -> last two session bests, oldest first
  medians: Record<string, number>, // lift -> 4-week median
): WholeBodyDeload {
  let below = 0;
  for (const lift of Object.keys(recentObs)) {
    const last2 = recentObs[lift];
    const med = medians[lift];
    if (last2.length >= 2 && med !== undefined && last2[0] < med && last2[1] < med) below += 1;
  }
  if (below >= 2) return { deload: true, setsFactor: 0.6, loadFactor: 0.9, days: 7 };
  return { deload: false, setsFactor: 1, loadFactor: 1, days: 0 };
}

/** Round to the user's plate step (default 5 lb barbell / dumbbell). */
export function roundWeight(weight: number, step = 5): number {
  return Math.round(weight / step) * step;
}

export interface DoubleProgression {
  increase: boolean;
  nextWeight: number;
  factor: number;
}

/**
 * Double progression (ACSM 2009 increments): top of rep range hit at or below
 * target RPE on two consecutive sessions -> +2.5% upper / +5% lower.
 */
export function doubleProgression(
  weight: number,
  lowerBody: boolean,
  hitTopAtOrBelowTarget: [boolean, boolean],
  step = 5,
): DoubleProgression {
  if (!(hitTopAtOrBelowTarget[0] && hitTopAtOrBelowTarget[1])) {
    return { increase: false, nextWeight: roundWeight(weight, step), factor: 1 };
  }
  const factor = lowerBody ? 1.05 : 1.025;
  const raw = weight * factor;
  const stepped = Math.max(raw, weight + step); // smallest plate step wins
  return { increase: true, nextWeight: roundWeight(stepped, step), factor };
}

export interface HelmsAdjust {
  factor: number; // 1 = no change
  pct: number; // signed percent, capped at +/-6%
}

/** In-session Helms 2018: 2% load per 0.5 RPE outside target, cap +/-6%. */
export function helmsAdjust(loggedRpe: number, targetRpe: number): HelmsAdjust {
  const steps = (loggedRpe - targetRpe) / 0.5;
  const pct = Math.min(6, Math.max(-6, -steps * 2));
  return { factor: 1 + pct / 100, pct };
}

export interface Flags {
  recoveryNudge: boolean;
  injuryRisk: boolean;
  flagReasons: string[];
}

/**
 * Rule-based flags, never diagnostic (PLAN 6.3). dailyLoads: last 7+ daily
 * sRPE-loads; baseline: prior 4-week weekly strains for z-score.
 */
export function computeFlags(args: {
  dailyLoads: number[]; // last 7 days, oldest first
  baselineStrains: number[]; // prior weekly strains (4-week baseline)
  sessionsLast7: { srpe: number }[];
  sorenessLast2: Record<string, number[]>; // muscle -> last two check-ins
  jointPain7d: Record<string, number>; // exercise -> taps in last 7 d
}): Flags {
  const reasons: string[] = [];
  let recoveryNudge = false;
  const loads = args.dailyLoads;
  if (loads.length >= 2) {
    const m = loads.reduce((a, b) => a + b, 0) / loads.length;
    const sd = Math.sqrt(loads.reduce((a, b) => a + (b - m) * (b - m), 0) / (loads.length - 1 || 1));
    const monotony = sd > 1e-9 ? m / sd : 0;
    if (monotony > 2.0) {
      recoveryNudge = true;
      reasons.push("monotony>2.0");
    }
    const strain = loads.reduce((a, b) => a + b, 0) * monotony;
    if (args.baselineStrains.length >= 2) {
      const bm = args.baselineStrains.reduce((a, b) => a + b, 0) / args.baselineStrains.length;
      const bsd = Math.sqrt(
        args.baselineStrains.reduce((a, b) => a + (b - bm) * (b - bm), 0) / (args.baselineStrains.length - 1),
      );
      if (bsd > 1e-9 && (strain - bm) / bsd > 1.5) {
        recoveryNudge = true;
        reasons.push("strain-z>1.5");
      }
    }
  }
  const hardSessions = args.sessionsLast7.filter((s) => s.srpe >= 8).length;
  if (args.sessionsLast7.length >= 4 && hardSessions >= 4) {
    recoveryNudge = true;
    reasons.push("4x-srpe8+");
  }
  let injuryRisk = false;
  for (const [muscle, last2] of Object.entries(args.sorenessLast2)) {
    if (last2.length >= 2 && last2[0] === 4 && last2[1] === 4) {
      injuryRisk = true;
      reasons.push(`sore4x2:${muscle}`);
    }
  }
  for (const [ex, n] of Object.entries(args.jointPain7d)) {
    if (n >= 2) {
      injuryRisk = true;
      reasons.push(`jointpain:${ex}`);
    }
  }
  return { recoveryNudge, injuryRisk, flagReasons: reasons };
}
