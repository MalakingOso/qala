// Volume rules (PLAN.md 6.3, evidence in RESEARCH-design-and-programming.md B4).
// Copied here with citation because packages/engine owns the runtime counting;
// the generator must plan against the same numbers. Do not retune one copy
// without the other.
//
// - RP landmarks constrain DIRECT sets: at least MEV lo when trained, at most
//   MRV lo. RP table is practitioner landmarks (RP guides, 2024), not a meta
//   analysis; muscles without a row use chest's numbers.
// - The owner band constrains FRACTIONAL sets (Pelland 2026 fractional counting,
//   direct 1.0 + synergist 0.5): grow [10,20], emphasise [14,20], maintain has
//   no fractional floor and keeps direct sets in [MV hi, MEV hi].
// - Conflicts: RP MRV beats the owner floor (recovery guard); owner 20 beats RP
//   MAV/MRV (thin evidence above 20, Baz-Valle 2022). Hamstrings reach 10 only
//   with hinge/squat credit, else plan fewer and log VOLUME_CAPPED_BY_MRV.
//   Back starts at 14.
// - Block start fracSets = max(band lo, MEV hi + indirect credit), +2/week,
//   capped. The ramp applies only in hypertrophy blocks; strength and peaking
//   hold volume and move intensity/RPE (DECISIONS.md T5). Deload x0.5.
// - Strength blocks: MEV to about 10 fractional sets per muscle (1RM gains
//   flatten beyond ~5, Pelland 2026); time goes to intensity and practice.

import type {
  Approach,
  DayPlan,
  ExerciseClass,
  MuscleGroup,
  PlannedExercise,
  Priority,
} from "./types.ts";
import { VOLUME_CAPPED_BY_MRV } from "./types.ts";

export interface RpRow {
  mv: [number, number];
  mev: [number, number];
  mav: [number, number];
  mrv: [number, number];
}

// PLAN.md 6.3 table, intermediate lifters, sets/week. See module comment.
export const RP_TABLE: Record<string, RpRow> = {
  chest: { mv: [2, 4], mev: [4, 6], mav: [6, 16], mrv: [16, 24] },
  back: { mv: [10, 12], mev: [12, 14], mav: [16, 22], mrv: [22, 30] },
  quads: { mv: [2, 4], mev: [4, 6], mav: [6, 14], mrv: [14, 18] },
  hamstrings: { mv: [0, 2], mev: [2, 4], mav: [2, 8], mrv: [8, 14] },
  glutes: { mv: [2, 6], mev: [6, 8], mav: [8, 24], mrv: [24, 30] },
  sideDelts: { mv: [2, 6], mev: [6, 8], mav: [8, 24], mrv: [24, 30] },
  biceps: { mv: [6, 8], mev: [8, 10], mav: [14, 20], mrv: [20, 26] },
  triceps: { mv: [0, 4], mev: [4, 6], mav: [6, 16], mrv: [16, 20] },
  calves: { mv: [2, 4], mev: [4, 6], mav: [6, 16], mrv: [16, 24] },
};

export function rpRow(muscle: MuscleGroup): RpRow {
  return RP_TABLE[muscle as string] ?? RP_TABLE["chest"];
}

// Owner fractional band lo/hi. Maintain has no fractional floor (NaN lo).
export function bandFor(priority: Priority): { lo: number; hi: number } {
  if (priority === "emphasise") return { lo: 14, hi: 20 };
  if (priority === "grow") return { lo: 10, hi: 20 };
  return { lo: Number.NaN, hi: 20 };
}

export interface FracTarget {
  fracTarget: number;
  directMin: number;
  directMax: number;
  capped: boolean;
  reason?: string;
}

// Weekly fractional target for one muscle. weekIdx is 0-based within the block.
// kind selects the ramp rule: hypertrophy ramps +2/week, strength/peaking hold.
export function weeklyFracTarget(
  muscle: MuscleGroup,
  priority: Priority,
  weekIdx: number,
  indirectCredit: number,
  kind: "hypertrophy" | "strength" = "hypertrophy",
): FracTarget {
  const rp = rpRow(muscle);
  const band = bandFor(priority);
  if (priority === "maintain") {
    return { fracTarget: rp.mev[1], directMin: rp.mv[1], directMax: rp.mev[1], capped: false };
  }
  const start = Math.max(band.lo, rp.mev[1] + indirectCredit);
  // RP MRV (recovery guard) beats the owner floor: the most fractional sets we
  // can defend is MRV lo direct plus half-weighted indirect credit.
  const maxDefensible = rp.mrv[0] + 0.5 * indirectCredit;
  let target = kind === "hypertrophy" ? start + 2 * weekIdx : start;
  target = Math.min(target, band.hi, 20);
  let capped = false;
  let reason: string | undefined;
  if (target > maxDefensible) {
    target = Math.max(maxDefensible, rp.mev[0]);
    capped = true;
    reason = VOLUME_CAPPED_BY_MRV;
  }
  return { fracTarget: target, directMin: rp.mev[0], directMax: rp.mrv[0], capped, reason };
}

// Strength-block volume: MEV to about 10 fractional sets per muscle.
export function strengthFracTarget(
  muscle: MuscleGroup,
  priority: Priority,
  indirectCredit: number,
): FracTarget {
  const rp = rpRow(muscle);
  if (priority === "maintain") {
    return { fracTarget: rp.mev[1], directMin: rp.mv[1], directMax: rp.mev[1], capped: false };
  }
  const lo = priority === "emphasise" ? 14 : 10;
  const target = Math.min(10, Math.max(lo, rp.mev[1] + indirectCredit));
  const maxDefensible = rp.mrv[0] + 0.5 * indirectCredit;
  if (target > maxDefensible) {
    return {
      fracTarget: Math.max(maxDefensible, rp.mev[0]),
      directMin: rp.mev[0],
      directMax: rp.mrv[0],
      capped: true,
      reason: VOLUME_CAPPED_BY_MRV,
    };
  }
  return { fracTarget: target, directMin: rp.mev[0], directMax: rp.mrv[0], capped: false };
}

export const DELOAD_FACTOR = 0.5;

// Hard-set rule (PLAN.md 6.3, RESEARCH B5): a completed work set with target
// RPE >= 7 counts. Main-lift work sets also need load >= 50% of reference 1RM.
export function isHardSet(ex: PlannedExercise, referenceRm?: number): boolean {
  if (ex.rpe < 7) return false;
  if (ex.mainLift && referenceRm !== undefined && ex.load !== undefined) {
    return ex.load >= 0.5 * referenceRm;
  }
  return true;
}

export interface MuscleCounts {
  direct: number;
  frac: number;
}

// Count direct + fractional sets per muscle for one day's exercises.
export function countDaySets(
  exercises: PlannedExercise[],
  referenceRm: Record<string, number>,
): Map<MuscleGroup, MuscleCounts> {
  const out = new Map<MuscleGroup, MuscleCounts>();
  const bump = (m: MuscleGroup, direct: number, frac: number) => {
    const cur = out.get(m) ?? { direct: 0, frac: 0 };
    cur.direct += direct;
    cur.frac += frac;
    out.set(m, cur);
  };
  for (const ex of exercises) {
    if (!isHardSet(ex, referenceRm[ex.exerciseId])) continue;
    for (const m of ex.muscles.target) bump(m, ex.sets, ex.sets);
    for (const m of ex.muscles.synergist) bump(m, 0, 0.5 * ex.sets);
  }
  return out;
}

export function countWeekSets(
  days: DayPlan[],
  referenceRm: Record<string, number>,
): Map<MuscleGroup, MuscleCounts> {
  const out = new Map<MuscleGroup, MuscleCounts>();
  for (const day of days) {
    for (const [m, c] of countDaySets(day.exercises, referenceRm)) {
      const cur = out.get(m) ?? { direct: 0, frac: 0 };
      cur.direct += c.direct;
      cur.frac += c.frac;
      out.set(m, cur);
    }
  }
  return out;
}

// Time model (PLAN.md 12, costs from 6.6): per work set, base rest B plus 40 s
// of set time for hypertrophy/maintenance or 30 s for strength, plus the 6.7
// warm-up (default 8 min, 15 min when the first main lift tops >= 85%).
export function baseRestSec(approach: Approach, klass: ExerciseClass): number {
  if (approach === "strength") {
    return klass === "main" ? 180 : klass === "secondary" ? 150 : 90;
  }
  return klass === "main" ? 150 : klass === "secondary" ? 120 : 90;
}

export function setCostSec(approach: Approach, klass: ExerciseClass): number {
  return baseRestSec(approach, klass) + (approach === "strength" ? 30 : 40);
}

export function warmupMinutes(day: DayPlan, referenceRm: Record<string, number>): number {
  for (const ex of day.exercises) {
    if (ex.mainLift && referenceRm[ex.exerciseId] !== undefined) {
      if (ex.loadPct >= 85) return 15;
      break;
    }
  }
  return 8;
}

export function estimateSessionMinutes(
  day: DayPlan,
  approach: Approach,
  referenceRm: Record<string, number>,
): number {
  let secs = warmupMinutes(day, referenceRm) * 60;
  for (const ex of day.exercises) {
    secs += ex.sets * setCostSec(approach, ex.klass);
  }
  return secs / 60;
}

// Fit a day to the time budget by trimming accessory sets (isolation first),
// never below 1 set per exercise. Returns what was removed.
export function fitToTimeBudget(
  day: DayPlan,
  approach: Approach,
  referenceRm: Record<string, number>,
  budgetMin: number,
): { day: DayPlan; estimatedMin: number; withinBudget: boolean; removedSets: number } {
  const copy: DayPlan = {
    ...day,
    exercises: day.exercises.map((e) => ({ ...e })),
  };
  let removedSets = 0;
  const rank = (e: PlannedExercise) =>
    e.klass === "isolation" ? 0 : e.slot === "accessoryHigh" ? 1 : e.slot === "accessoryLow" ? 2 : 3;
  for (;;) {
    const est = estimateSessionMinutes(copy, approach, referenceRm);
    if (est <= budgetMin) return { day: copy, estimatedMin: est, withinBudget: true, removedSets };
    const candidates = copy.exercises
      .filter((e) => e.sets > 1 && !e.mainLift)
      .sort((a, b) => rank(a) - rank(b));
    if (candidates.length === 0) {
      return { day: copy, estimatedMin: est, withinBudget: est <= budgetMin * 1.1, removedSets };
    }
    candidates[0].sets -= 1;
    removedSets += 1;
  }
}
