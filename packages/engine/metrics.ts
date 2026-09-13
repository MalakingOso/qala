// Key metrics (PLAN 6.3, RESEARCH B5-B6) in packages/engine/metrics.ts:
// 1RM progression, NL85/T85/NL/ARI zones, VL_m, PRs.

import type { KalmanState } from "./state.ts";
import { kalmanPredict } from "./kalman.ts";

export interface ZoneCounts {
  nl: number; // reps of work sets
  tonnage: number; // T = sum(load x reps)
  nl85: number; // reps at >= 85% of reference 1RM
  t85: number; // tonnage at >= 85%
  nl90: number; // reps at >= 90%
  t90: number; // tonnage at >= 90%
  ari: number; // T / NL / reference 1RM
  byZone: Record<string, number>; // reps per zone label
}

export function zoneOf(load: number, referenceRm: number): string {
  const pct = (load / referenceRm) * 100;
  if (pct < 70) return "<70";
  if (pct < 80) return "70-79.9";
  if (pct < 85) return "80-84.9";
  if (pct < 90) return "85-89.9";
  return "90+";
}

/** NL/T/NL85/T85/ARI per lift per week from work sets (load >= 50% ref for mains). */
export function intensityZones(
  sets: { load: number; reps: number }[],
  referenceRm: number,
): ZoneCounts {
  const byZone: Record<string, number> = { "<70": 0, "70-79.9": 0, "80-84.9": 0, "85-89.9": 0, "90+": 0 };
  let nl = 0;
  let tonnage = 0;
  let nl85 = 0;
  let t85 = 0;
  let nl90 = 0;
  let t90 = 0;
  for (const s of sets) {
    nl += s.reps;
    tonnage += s.load * s.reps;
    byZone[zoneOf(s.load, referenceRm)] += s.reps;
    if (s.load / referenceRm >= 0.85) {
      nl85 += s.reps;
      t85 += s.load * s.reps;
    }
    if (s.load / referenceRm >= 0.9) {
      nl90 += s.reps;
      t90 += s.load * s.reps;
    }
  }
  return { nl, tonnage, nl85, t85, nl90, t90, ari: nl > 0 ? tonnage / nl / referenceRm : 0, byZone };
}

/** Per-muscle volume load VL_m = sum(load x reps x w), w 1.0 target / 0.5 synergist. */
export function volumeLoad(
  sets: { load: number; reps: number; muscles: { muscle: string; w: number }[] }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sets) {
    for (const m of s.muscles) {
      out[m.muscle] = (out[m.muscle] ?? 0) + s.load * s.reps * m.w;
    }
  }
  return out;
}

/** Bodyweight load factors (assumptions, PLAN 6.3). */
export const BODYWEIGHT_FACTORS: Record<string, number> = {
  pullup: 1.0,
  "pull-up": 1.0,
  chinup: 1.0,
  dip: 1.0,
  pushup: 0.65,
  "push-up": 0.65,
};

export function bodyweightLoad(exerciseId: string, bodyweight: number, addedLoad: number): number {
  const f = BODYWEIGHT_FACTORS[exerciseId.toLowerCase()] ?? 1.0;
  return bodyweight * f + addedLoad;
}

export interface PrEntry {
  exerciseId: string;
  kind: "rep" | "load" | "e1rm";
  reps?: number;
  load: number;
  e1rm?: number;
  date: string;
}

/**
 * Progressive-overload PRs per exercise: rep PRs at a load, load PRs at a rep
 * count. Sets over 10 reps show rep PRs, never an e1RM (PLAN 6.3).
 */
export function updatePrs(
  existing: PrEntry[],
  exerciseId: string,
  load: number,
  reps: number,
  e1rm: number | null,
  date: string,
): PrEntry[] {
  const out = [...existing];
  const atLoad = out.filter((p) => p.exerciseId === exerciseId && p.kind === "rep" && p.load === load);
  const bestReps = atLoad.length ? Math.max(...atLoad.map((p) => p.reps ?? 0)) : 0;
  if (reps > bestReps) out.push({ exerciseId, kind: "rep", reps, load, date });
  const atReps = out.filter((p) => p.exerciseId === exerciseId && p.kind === "load" && p.reps === reps);
  const bestLoad = atReps.length ? Math.max(...atReps.map((p) => p.load)) : 0;
  if (load > bestLoad) out.push({ exerciseId, kind: "load", reps, load, date });
  if (e1rm !== null && reps <= 10) {
    const e1s = out.filter((p) => p.exerciseId === exerciseId && p.kind === "e1rm");
    const best = e1s.length ? Math.max(...e1s.map((p) => p.e1rm ?? 0)) : 0;
    if (e1rm > best) out.push({ exerciseId, kind: "e1rm", load, reps, e1rm, date });
  }
  return out;
}

export interface OneRmProgression {
  dailyBest: number | null;
  kalman: number | null;
  tested: number[];
  pctChangeVsReference: number | null;
}

/** 1RM progression per main lift (daily best, Kalman estimate, tested, % block). */
export function oneRmProgression(
  dailyBest: number | null,
  kalman: KalmanState | undefined,
  fitness: number,
  fatigue: number,
  tested: number[],
  referenceRm: number | null,
): OneRmProgression {
  const k = kalman ? kalmanPredict(kalman, fitness, fatigue) : null;
  const anchor = dailyBest ?? k;
  return {
    dailyBest,
    kalman: k,
    tested,
    pctChangeVsReference: anchor !== null && referenceRm ? (anchor - referenceRm) / referenceRm : null,
  };
}
