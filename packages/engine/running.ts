// Running in the engine (PLAN 6.4, RESEARCH-running.md). SI units in/out.
// All set-equivalent weights are derived assumptions (docs/engine.md).

/** Minetti 2002 energy-cost polynomial, i = grade fraction. */
export function minettiCost(grade: number): number {
  const i = grade;
  return (
    155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6
  );
}

export function minettiRatio(grade: number): number {
  return minettiCost(grade) / minettiCost(0);
}

/**
 * GAP factor: Minetti ratio uphill; downhill max(Minetti, 0.88), capped at
 * 1.0 beyond -18% (PLAN 6.4 / RESEARCH 3).
 */
export function gapFactor(grade: number): number {
  if (grade >= 0) return minettiRatio(grade);
  if (grade <= -0.18) return 1.0;
  return Math.max(minettiRatio(grade), 0.88);
}

/** Normalised graded pace from speed + mean grade. */
export function ngp(speedMps: number, grade: number): number {
  return speedMps * gapFactor(grade);
}

/** Mean GAP factor over a grade profile. */
export function meanGapFactor(profile: { grade: number; meters: number }[] | undefined): number {
  if (!profile || profile.length === 0) return 1;
  const total = profile.reduce((a, s) => a + s.meters, 0);
  if (total <= 0) return 1;
  return profile.reduce((a, s) => a + gapFactor(s.grade) * s.meters, 0) / total;
}

export function intensityFactor(ngpMps: number, thresholdPaceMps: number): number {
  return ngpMps / thresholdPaceMps;
}

/** rTSS = hours x IF^2 x 100. Exactly 100 for 1 h at threshold on flat. */
export function rtss(hours: number, IF: number): number {
  return hours * IF * IF * 100;
}

// Daniels & Gilbert VDOT (coefficients from calculator sites, [secondary]).
export function vdotFromEffort(distanceM: number, seconds: number): number {
  const tMin = seconds / 60;
  const v = distanceM / tMin; // m/min
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const frac = 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
  return vo2 / frac;
}

/** Riegel T2 = T1 x (D2/D1)^1.06, range 3.5-230 min (assumption, PLAN 6.4). */
export function riegel(seconds1: number, d1: number, d2: number): number {
  return seconds1 * Math.pow(d2 / d1, 1.06);
}

export interface Effort {
  distanceM: number;
  seconds: number;
}

/**
 * Critical speed: slope of the distance-time line through the best
 * grade-adjusted 400, 800 and 5000 m efforts in the last 90 d (Smyth 2020).
 * Least-squares slope; null when fewer than 3 qualifying efforts exist.
 */
export function criticalSpeed(efforts: (Effort & { date: string })[], nowIso: string): number | null {
  const cutoff = Date.parse(nowIso) - 90 * 86400000;
  const targets = [400, 800, 5000];
  const pts: { t: number; d: number }[] = [];
  for (const target of targets) {
    const cands = efforts.filter((e) => e.distanceM === target && Date.parse(e.date) >= cutoff);
    if (!cands.length) continue;
    const best = cands.reduce((a, b) => (a.seconds < b.seconds ? a : b));
    pts.push({ t: best.seconds, d: best.distanceM });
  }
  if (pts.length < 3) return null;
  const n = pts.length;
  const mt = pts.reduce((a, p) => a + p.t, 0) / n;
  const md = pts.reduce((a, p) => a + p.d, 0) / n;
  const num = pts.reduce((a, p) => a + (p.t - mt) * (p.d - md), 0);
  const den = pts.reduce((a, p) => a + (p.t - mt) * (p.t - mt), 0);
  if (den <= 0) return null;
  return num / den;
}

// ---- Set-equivalents (fatigue only; never counted toward MEV/MRV) ----

export type RunZone = 0.5 | 1.0 | 1.5;

/** z from grade-adjusted speed vs CS: <0.78 easy, 0.78-1.0 steady, >CS hard. */
export function runZone(ngpMps: number, csMps: number): RunZone {
  const r = ngpMps / csMps;
  if (r < 0.78) return 0.5;
  if (r <= 1.0) return 1.0;
  return 1.5;
}

export interface RunSetEq {
  quads: number;
  calves: number;
  glutes: number;
  hamstrings: number;
}

/** q = 0.18 x z per km; splits anchored on KE force loss (derived). */
export function runSetEquivalents(km: number, z: RunZone): RunSetEq {
  const q = 0.18 * z * km;
  return {
    quads: q,
    calves: 0.8 * q,
    glutes: 0.5 * q,
    hamstrings: (z === 1.5 ? 0.8 : 0.4) * q,
  };
}

/** Repeated bout factor: max(0.65, 1 - 0.035n), n = 200m+ descent runs/42d. */
export function rbeFactor(n: number): number {
  return Math.max(0.65, 1 - 0.035 * n);
}

/** Eccentric damage per 100 m descended on grades < -5%: quads 0.4, calves 0.25. */
export function descentDamage(descentM: number, rbe: number): { quads: number; calves: number } {
  const units = descentM / 100;
  return { quads: 0.4 * units * rbe, calves: 0.25 * units * rbe };
}

/** Prior 3.6 sRPE-load units per 100 rTSS (derived, unvalidated). */
export const SRPE_PER_100_RTSS_PRIOR = 3.6;

/** Per-user fitted ratio after 10 paired runs, else the prior. */
export function srpeLoadRatio(pairs: { srpeLoad: number; rTSS: number }[]): number {
  if (pairs.length >= 10) {
    const num = pairs.reduce((a, p) => a + p.srpeLoad, 0);
    const den = pairs.reduce((a, p) => a + p.rTSS, 0);
    if (den > 0) return (num / den) * 100;
  }
  return SRPE_PER_100_RTSS_PRIOR;
}

// ---- Cross-modal rules (PLAN 6.4 table; each emits a ReasonCode) ----

import { ReasonCode } from "./volume.ts";
import { isLowerBodyLift } from "./state.ts";

export interface CrossModalHit {
  code: ReasonCode;
  detail: string;
}

export interface RunContext {
  minutes: number;
  endedAtIso: string;
  distanceM: number;
  z: RunZone;
}

/** Row 1: run >= 30 min ended < 8 h before a lower-body session. */
export function checkRunBeforeLift(
  run: RunContext,
  sessionAtIso: string,
  exerciseIds: string[],
): CrossModalHit | null {
  if (run.minutes < 30) return null;
  const gapH = (Date.parse(sessionAtIso) - Date.parse(run.endedAtIso)) / 3600000;
  if (!(gapH >= 0 && gapH < 8)) return null;
  if (!exerciseIds.some(isLowerBodyLift)) return null;
  return { code: ReasonCode.RUN_BEFORE_LIFT, detail: `run ${run.minutes}min ${gapH.toFixed(1)}h before lift: -1 rep/set, noise x2` };
}

/** Row 2: >= 8 quad set-eq lifted in prior 24 h + planned hard/long run -> easy. */
export function checkLiftBeforeHardRun(quadSetEq24h: number, plannedZ: RunZone, plannedMin: number): CrossModalHit | null {
  if (quadSetEq24h < 8) return null;
  if (!(plannedZ === 1.5 || plannedMin > 90)) return null;
  return { code: ReasonCode.LIFT_BEFORE_HARD_RUN, detail: "planned hard run becomes easy" };
}

/** Row 3: run and lift same day -> lift first; warn gap < 6 h (< 24 h strength). */
export function checkSameDayOrder(
  liftAtIso: string,
  runAtIso: string,
  sameDay: boolean,
  strengthPriority: boolean,
): CrossModalHit | null {
  if (!sameDay) return null;
  const gapH = Math.abs(Date.parse(runAtIso) - Date.parse(liftAtIso)) / 3600000;
  const liftFirst = Date.parse(liftAtIso) <= Date.parse(runAtIso);
  const limit = strengthPriority ? 24 : 6;
  if (!liftFirst || gapH < limit) {
    return { code: ReasonCode.SAME_DAY_ORDER, detail: liftFirst ? `gap ${gapH.toFixed(1)}h < ${limit}h` : "run before lift: lift first" };
  }
  return null;
}

/** Row 4: running-derived quad/calf fatigue above one typical lifting session. */
export function checkRunFatigueHold(
  runQuadFatigue: number,
  runCalfFatigue: number,
  typicalSessionInput = 8,
): CrossModalHit | null {
  if (runQuadFatigue > typicalSessionInput || runCalfFatigue > typicalSessionInput) {
    return { code: ReasonCode.RUN_FATIGUE_HOLD, detail: "no load increase on lower-body lifts" };
  }
  return null;
}

/** Rows 5-6: post-race holds. */
export function checkPostRace(distanceM: number, z: RunZone): CrossModalHit | null {
  if (distanceM >= 42000) return { code: ReasonCode.POST_RACE_5D, detail: "no heavy lower body 5d, then 50% sets" };
  if (distanceM >= 21000 && z >= 1) return { code: ReasonCode.POST_RACE_48H, detail: "no heavy lower body 48h" };
  return null;
}

/** Row 7: heavy lower-body session in prior 24 h -> next hard run easy. */
export function checkHeavyLiftBeforeRun(heavyLower24h: boolean): CrossModalHit | null {
  if (!heavyLower24h) return null;
  return { code: ReasonCode.HEAVY_LIFT_BEFORE_RUN, detail: "next planned hard run suggested as easy" };
}

// ---- Running flags (rule-based, never diagnostic; NO ACWR anywhere) ----

/** Single run > 1.10x longest run of previous 30 d (HRR 1.64). */
export function checkRunSpike(distanceM: number, longest30dM: number): CrossModalHit | null {
  if (longest30dM > 0 && distanceM > 1.1 * longest30dM) {
    return { code: ReasonCode.RUN_SPIKE, detail: `run ${(distanceM / 1000).toFixed(1)}km > 1.10x longest-30d ${(longest30dM / 1000).toFixed(1)}km` };
  }
  return null;
}

/** Weekly distance up > 30% across two weeks (HR 1.59, CI crosses 1). */
export function checkMileageJump(last2wkM: number, prev2wkM: number): CrossModalHit | null {
  if (prev2wkM > 0 && (last2wkM - prev2wkM) / prev2wkM > 0.3) {
    return { code: ReasonCode.MILEAGE_JUMP, detail: "2-week distance up >30%" };
  }
  return null;
}

/**
 * Held-out check (Imbach 2025 logic): after 20 VDOT observations compare
 * F_run-only prediction against F_run with the fatigue term; keep the simpler
 * model if it predicts as well. Returns the model to use.
 */
export function heldOutRunModelChoice(vdotObs: number, errWithFatigue: number | null, errFitnessOnly: number | null): "fitness-only" | "with-fatigue" {
  if (vdotObs < 20 || errWithFatigue === null || errFitnessOnly === null) return "fitness-only";
  return errWithFatigue < errFitnessOnly ? "with-fatigue" : "fitness-only";
}
