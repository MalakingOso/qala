// Public API (PLAN 6 intro): logSession / predictReadiness /
// recommendNextSession / calibrate. Pure functions over EngineState.

import {
  initialState,
  isLowerBodyLift,
  type Checkin,
  type EngineState,
  type LiftWorkout,
  type RunWorkout,
  type Workout,
} from "./state.ts";
import { TAU_DAMAGE, TAU_FITNESS_LIFT, TAU_FITNESS_RUN, TAU_SYSTEMIC, daysBetween, decayRecord, decayValue, muscleTau } from "./decay.ts";
import { bestObservation } from "./e1rm.ts";
import { initKalman, kalmanUpdate } from "./kalman.ts";
import { predictReadiness as readinessCore, type Readiness } from "./readiness.ts";
import { ReasonCode, doubleProgression, roundWeight, wholeBodyDeload } from "./volume.ts";
import {
  SRPE_PER_100_RTSS_PRIOR,
  checkPostRace,
  checkRunBeforeLift,
  checkRunFatigueHold,
  criticalSpeed,
  descentDamage,
  intensityFactor,
  meanGapFactor,
  rbeFactor,
  rtss,
  runSetEquivalents,
  runZone,
  srpeLoadRatio,
  vdotFromEffort,
  type RunZone,
} from "./running.ts";

export const ENVELOPE = { weightPctMin: -10, weightPctMax: 2.5, setsMin: -2, setsMax: 1 } as const;

export function clampWeightPct(pct: number): number {
  return Math.min(ENVELOPE.weightPctMax, Math.max(ENVELOPE.weightPctMin, pct));
}

export function clampSets(delta: number): number {
  return Math.min(ENVELOPE.setsMax, Math.max(ENVELOPE.setsMin, Math.round(delta)));
}

function setFactor(rpe?: number, targetRpe?: number): number {
  const r = rpe ?? targetRpe ?? 8;
  return Math.min(1.5, Math.max(0.5, 1 + 0.1 * (r - 8)));
}

function clone(s: EngineState): EngineState {
  return JSON.parse(JSON.stringify(s)) as EngineState;
}

function decayAll(s: EngineState, dt: number): void {
  if (!(dt > 0)) return;
  for (const k of Object.keys(s.fitness)) s.fitness[k] = decayValue(s.fitness[k], dt, TAU_FITNESS_LIFT);
  s.fatigueMuscle = decayRecord(s.fatigueMuscle, dt, muscleTau);
  s.runFatigueMuscle = decayRecord(s.runFatigueMuscle, dt, muscleTau);
  for (const k of Object.keys(s.fatigueDamage)) s.fatigueDamage[k] = decayValue(s.fatigueDamage[k], dt, TAU_DAMAGE);
  for (const k of Object.keys(s.runFatigueDamage)) s.runFatigueDamage[k] = decayValue(s.runFatigueDamage[k], dt, TAU_DAMAGE);
  s.fatigueSystemic = decayValue(s.fatigueSystemic, dt, TAU_SYSTEMIC);
  s.fitnessRun = decayValue(s.fitnessRun, dt, TAU_FITNESS_RUN);
}

function addTo(rec: Record<string, number>, key: string, v: number): void {
  rec[key] = (rec[key] ?? 0) + v;
}

function applyLift(s: EngineState, w: LiftWorkout): void {
  let quadSetEq = 0;
  let heavyLower = false;
  for (const e of w.entries) {
    const main = e.isMain ?? s.mainLifts.includes(e.exerciseId);
    let liftInput = 0;
    let volLoad = 0;
    for (const set of e.sets) {
      if (!set.completed || set.warmup) continue;
      const f = setFactor(set.rpe, set.targetRpe);
      for (const t of e.targets) {
        addTo(s.fatigueMuscle, t, f);
        liftInput += f;
      }
      for (const sy of e.synergists ?? []) addTo(s.fatigueMuscle, sy, 0.5 * f);
      volLoad += set.w * set.r;
      if (e.targets.some((t) => t.toLowerCase().includes("quad"))) quadSetEq += f;
      if (set.jointPain) s.jointPainLog.push({ date: w.date, exerciseId: e.exerciseId });
    }
    if (main) {
      const est = s.referenceRm[e.exerciseId]?.weight ?? 100;
      s.fitness[e.exerciseId] = (s.fitness[e.exerciseId] ?? 0) + volLoad / Math.max(1, est);
      const obs = bestObservation(e.sets);
      if (obs) {
        if (!s.kalman[e.exerciseId]) s.kalman[e.exerciseId] = initKalman(est, 0.5, 4);
        const k = s.kalman[e.exerciseId];
        const gw = e.targets.reduce((a, t) => a + (s.fatigueMuscle[t] ?? 0), 0) +
          (e.synergists ?? []).reduce((a, m) => a + 0.5 * (s.fatigueMuscle[m] ?? 0), 0);
        const noise = obs.tested ? 0.25 : 1; // tested 1RM: quarter noise
        const runBeforeLift = s.lastRun && (Date.parse(w.date) - Date.parse(s.lastRun.date)) / 3600000 < 8 &&
          s.lastRun.minutes >= 30 && isLowerBodyLift(e.exerciseId);
        s.kalman[e.exerciseId] = kalmanUpdate(k, s.fitness[e.exerciseId], gw + s.fatigueSystemic, obs.e1rm, runBeforeLift ? noise * 2 : noise);
        (s.e1rmObs[e.exerciseId] ??= []).push({ date: w.date, value: obs.e1rm });
      }
    }
    if (isLowerBodyLift(e.exerciseId) && volLoad > 0) heavyLower = true;
  }
  if (w.srpe !== undefined && w.minutes) s.fatigueSystemic += (w.srpe * w.minutes) / 100;
  s.liftSessions.push({ date: w.date, quadSetEq, heavyLower, srpe: w.srpe });
  if (w.checkin) {
    s.prsHistory.push({ date: w.date, value: w.checkin.prs });
    s.sorenessPrevPrev = s.sorenessPrev;
    s.sorenessPrev = { ...w.checkin.soreness };
    s.lastCheckin = { ...w.checkin, soreness: { ...w.checkin.soreness }, date: w.date };
  }
  if (w.srpe !== undefined && w.minutes) s.dailyLoad.push({ date: w.date, load: (w.srpe * w.minutes) / 100 });
}

function thresholdPace(s: EngineState, nowIso: string): number | null {
  return criticalSpeed(s.bestEfforts, nowIso);
}

function applyRun(s: EngineState, w: RunWorkout): void {
  const speed = w.movingSec > 0 ? w.distanceM / w.movingSec : 0;
  const gap = meanGapFactor(w.gradeProfile);
  const ngpSpeed = speed * gap;
  const cs = thresholdPace(s, w.date);
  const z: RunZone = cs ? runZone(ngpSpeed, cs) : 1.0;
  const threshold = cs ?? (speed > 0 ? speed : 1);
  const IF = intensityFactor(ngpSpeed, threshold);
  const hours = w.movingSec / 3600;
  const rTSS = rtss(hours, IF);
  // Systemic: same formula as lifting; fallback to fitted ratio / prior.
  let sysLoad: number;
  const minutes = w.minutes ?? w.movingSec / 60;
  if (w.srpe !== undefined) {
    sysLoad = (w.srpe * minutes) / 100;
    s.srpeRtssPairs.push({ srpeLoad: sysLoad, rTSS });
  } else {
    sysLoad = (rTSS / 100) * srpeLoadRatio(s.srpeRtssPairs);
  }
  s.fatigueSystemic += sysLoad;
  s.dailyLoad.push({ date: w.date, load: sysLoad });
  // Per-muscle set-equivalents; km after minute 120 go to D_m.
  const km = w.distanceM / 1000;
  const fracDamage = minutes > 120 ? Math.min(1, (minutes - 120) / minutes) : 0;
  const eq = runSetEquivalents(km, z);
  const gmPart = 1 - fracDamage;
  const parts: [string, number][] = [
    ["quads", eq.quads],
    ["calves", eq.calves],
    ["glutes", eq.glutes],
    ["hamstrings", eq.hamstrings],
  ];
  for (const [m, v] of parts) {
    addTo(s.fatigueMuscle, m, v * gmPart);
    addTo(s.fatigueDamage, m, v * fracDamage);
    addTo(s.runFatigueMuscle, m, v * gmPart);
    addTo(s.runFatigueDamage, m, v * fracDamage);
  }
  // Eccentric damage into D_m with RBE.
  const n = s.runs.filter((r) => Date.parse(w.date) - Date.parse(r.date) <= 42 * 86400000 && r.descentM >= 200).length;
  const dd = descentDamage(w.descentM ?? 0, rbeFactor(n));
  addTo(s.fatigueDamage, "quads", dd.quads);
  addTo(s.fatigueDamage, "calves", dd.calves);
  addTo(s.runFatigueDamage, "quads", dd.quads);
  addTo(s.runFatigueDamage, "calves", dd.calves);
  // Fitness + Kalman-VDOT observation (3.5-230 min, sRPE >= 8).
  s.fitnessRun += rTSS / 100;
  const mins = w.movingSec / 60;
  if (mins >= 3.5 && mins <= 230 && (w.srpe ?? 0) >= 8 && w.distanceM > 0) {
    const vdot = vdotFromEffort(w.distanceM, w.movingSec);
    s.kalmanRun = kalmanUpdate(s.kalmanRun, s.fitnessRun, s.fatigueSystemic, vdot, 1);
  }
  if (w.distanceM > 0) s.bestEfforts.push({ distanceM: w.distanceM, seconds: w.movingSec, date: w.date });
  s.runs.push({ date: w.date, distanceM: w.distanceM, movingSec: w.movingSec, descentM: w.descentM ?? 0, z });
  s.lastRun = { date: w.date, minutes: minutes, distanceM: w.distanceM, z };
}

export function logSession(state: EngineState, workout: Workout): EngineState {
  const s = clone(state);
  const dt = daysBetween(s.updated, workout.date);
  decayAll(s, Math.max(0, dt));
  if (workout.kind === "lift") applyLift(s, workout);
  else applyRun(s, workout);
  s.updated = workout.date;
  return s;
}

export function predictReadiness(
  state: EngineState,
  checkin: Checkin,
  sessionMuscles?: string[],
): Readiness {
  return readinessCore(state, checkin, sessionMuscles ?? Object.keys(checkin.soreness), state.updated);
}

export interface RecommendedLift {
  exerciseId: string;
  targetWeight: number;
  targetSets: number;
  targetReps: number;
  targetRpe: number;
  recWeightPct: number; // clamped to envelope
  recSets: number; // clamped to envelope
}

export interface Recommendation {
  action: "progression" | "maintenance" | "deload";
  lifts: RecommendedLift[];
  envelope: typeof ENVELOPE;
  reasons: ReasonCode[];
}

export interface PlannedExercise {
  exerciseId: string;
  targets: string[];
  lastWeight: number;
  sets: number;
  reps: number;
  targetRpe: number;
  lowerBody?: boolean;
  lastTwoHits?: [boolean, boolean]; // double-progression memory
}

export function recommendNextSession(
  state: EngineState,
  exercises: PlannedExercise[],
  targetDate: string,
): Recommendation {
  const reasons: ReasonCode[] = [];
  // Whole-body deload check: two main lifts below 4-week median twice.
  const recent: Record<string, number[]> = {};
  const medians: Record<string, number> = {};
  for (const [lift, obs] of Object.entries(state.e1rmObs)) {
    if (obs.length < 2) continue;
    recent[lift] = obs.slice(-2).map((o) => o.value);
    const cutoff = Date.parse(targetDate) - 28 * 86400000;
    const vals = obs.filter((o) => Date.parse(o.date) >= cutoff).map((o) => o.value).sort((a, b) => a - b);
    if (vals.length) medians[lift] = vals[Math.floor(vals.length / 2)];
  }
  const wb = wholeBodyDeload(recent, medians);
  let action: Recommendation["action"] = "maintenance";
  let setsFactor = 1;
  let loadFactor = 1;
  if (wb.deload) {
    action = "deload";
    setsFactor = wb.setsFactor;
    loadFactor = wb.loadFactor;
    reasons.push(ReasonCode.WHOLE_BODY_DELOAD);
  }
  // Cross-modal context from the last run.
  const lastRun = state.runs[state.runs.length - 1];
  const lastLift = state.liftSessions[state.liftSessions.length - 1];
  const lifts: RecommendedLift[] = exercises.map((e) => {
    const lb = e.lowerBody ?? isLowerBodyLift(e.exerciseId);
    let recWeightPct = 0;
    let recSets = 0;
    let targetReps = e.reps;
    if (lastRun && lb) {
      const gapH = (Date.parse(targetDate) - Date.parse(lastRun.date)) / 3600000;
      const hit = checkRunBeforeLift(
        { minutes: lastRun.movingSec / 60, endedAtIso: lastRun.date, distanceM: lastRun.distanceM, z: lastRun.z as RunZone },
        targetDate,
        [e.exerciseId],
      );
      void gapH;
      if (hit) {
        targetReps = Math.max(1, e.reps - 1); // expected reps -1 per set
        reasons.push(hit.code);
      }
      const post = checkPostRace(lastRun.distanceM, lastRun.z as RunZone);
      if (post && (Date.parse(targetDate) - Date.parse(lastRun.date)) / 3600000 < (post.code === ReasonCode.POST_RACE_5D ? 5 * 24 : 48)) {
        action = action === "deload" ? action : "maintenance";
        reasons.push(post.code);
      }
      const hold = checkRunFatigueHold(
        state.runFatigueMuscle["quads"] ?? 0,
        state.runFatigueMuscle["calves"] ?? 0,
      );
      if (hold && lb) {
        recWeightPct = Math.min(recWeightPct, 0); // no load increase
        reasons.push(hold.code);
      }
    }
    void lastLift;
    // Double progression memory -> weight nudge (clamped to envelope).
    if (e.lastTwoHits) {
      const dp = doubleProgression(e.lastWeight, lb, e.lastTwoHits);
      if (dp.increase) {
        recWeightPct = ((dp.nextWeight - e.lastWeight) / e.lastWeight) * 100;
        reasons.push(ReasonCode.DOUBLE_PROGRESSION);
      }
    }
    recWeightPct = clampWeightPct(recWeightPct);
    recSets = clampSets(recSets);
    return {
      exerciseId: e.exerciseId,
      targetWeight: roundWeight(e.lastWeight * loadFactor * (1 + recWeightPct / 100)),
      targetSets: Math.max(1, Math.round(e.sets * setsFactor) + recSets),
      targetReps,
      targetRpe: e.targetRpe,
      recWeightPct,
      recSets,
    };
  });
  if (action === "maintenance" && lifts.some((l) => l.recWeightPct > 0)) action = "progression";
  return { action, lifts, envelope: { ...ENVELOPE }, reasons: [...new Set(reasons)] };
}

export function calibrate(history: Workout[]): EngineState {
  const ordered = [...history].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  let s = initialState();
  for (const w of ordered) s = logSession(s, w);
  return s;
}

export { SRPE_PER_100_RTSS_PRIOR };
export type { Readiness };
