// Block orchestrator: turns a GeneratorInput into a planned BlockDef.
// Re-exported with every other module through this file (package entry).

import type {
  Approach,
  BlockDef,
  BlockWeek,
  CatalogExercise,
  DayPlan,
  DupScheme,
  Experience,
  GeneratorInput,
  GoalKind,
  MuscleGroup,
  Periodization,
  PlannedExercise,
  Priority,
  SlotKind,
} from "./types.ts";
import { catalogById, VOLUME_CAPPED_BY_MRV } from "./types.ts";
import {
  availableExercises,
  chooseSplit,
  slotsForDay,
  type DayTemplate,
} from "./splits.ts";
import {
  countWeekSets,
  estimateSessionMinutes,
  fitToTimeBudget,
  strengthFracTarget,
  weeklyFracTarget,
} from "./volume.ts";
import {
  ALT_DUP_DAYS,
  altDupWeek,
  DUP_TABLE,
  HYPERTROPHY_TABLE,
  LINEAR_TABLE,
  LINEAR_WEEK5_OPENER_PCT,
  linearDeadlift,
  pctForRepsRir,
  rpeForRir,
  TAPER,
  taperSchedule,
  weightForPct,
} from "./templates.ts";

export * from "./types.ts";
export * from "./splits.ts";
export * from "./volume.ts";
export * from "./templates.ts";
export * from "./emit.ts";
export * from "./runplans.ts";
export * from "./hybrid.ts";

const MAIN_LIFT_IDS = new Set(["squat", "bench", "deadlift", "ohp"]);

// Variation reference fallback as a fraction of the parent lift's reference
// (assumption; the user can override per exercise once tested).
const VARIATION_FACTOR: Record<string, number> = {
  pauseSquat: 0.85,
  closeGripBench: 0.9,
  rdl: 0.55,
};

function refFor(exerciseId: string, refs: Record<string, number>): number | undefined {
  if (refs[exerciseId] !== undefined) return refs[exerciseId];
  const ex = catalogById(exerciseId);
  if (ex.variationsOf && refs[ex.variationsOf] !== undefined) {
    return refs[ex.variationsOf] * (VARIATION_FACTOR[exerciseId] ?? 0.85);
  }
  return undefined;
}

export function approachFor(goal: GoalKind): Approach {
  if (goal === "strength" || goal === "meetPrep") return "strength";
  if (goal === "athleticMaintenance") return "maintenance";
  return "hypertrophy";
}

// RESEARCH B1: novices linear (Moesgaard untrained ES 0.06); trained strength
// DUP in HPS order (trained ES 0.61, Zourdos order effect); meet prep blocks
// ending in the taper; hypertrophy defaults to the linear RIR ramp (model
// does not matter for growth, ES 0.05).
export function periodizationFor(
  goal: GoalKind,
  experience: Experience,
  override?: Periodization,
): Periodization {
  if (override) return override;
  if (goal === "meetPrep") return "block";
  if (goal === "hypertrophy" || goal === "athleticMaintenance") return "linear";
  return experience === "beginner" ? "linear" : "dup";
}

function priorityOf(
  input: GeneratorInput,
  muscle: MuscleGroup,
): Priority {
  return input.priorities[muscle] ?? "grow";
}

interface SlotAssignment {
  exerciseId: string;
  slot: SlotKind;
}

function dupRole(exposureIdx: number, exposures: number): "hypertrophy" | "power" | "strength" {
  if (exposures === 1) return "strength";
  if (exposures === 2) return exposureIdx === 0 ? "hypertrophy" : "strength";
  return (["hypertrophy", "power", "strength"] as const)[exposureIdx % 3];
}

function scaleOHP(sets: number): number {
  return Math.max(2, Math.round(sets * (2 / 3))); // B3: OHP follows bench at ~2/3 sets
}

function buildMainLift(
  exerciseId: string,
  weekIdx: number,
  exposureIdx: number,
  exposures: number,
  input: GeneratorInput,
  periodization: Periodization,
  dupScheme: DupScheme,
): PlannedExercise {
  const ex = catalogById(exerciseId);
  const ref = refFor(exerciseId, input.referenceRm);
  const week = weekIdx + 1;
  const slot: SlotKind = "strength";
  const finish = (
    sets: number,
    reps: number,
    pct: number,
    rpe: number,
    progression: PlannedExercise["progression"],
  ): PlannedExercise => {
    const scaled = exerciseId === "ohp" ? scaleOHP(sets) : sets;
    return {
      exerciseId,
      name: ex.name,
      sets: scaled,
      repsLow: reps,
      repsHigh: reps,
      loadPct: pct,
      load: ref === undefined ? undefined : weightForPct(ref, pct),
      rpe,
      slot,
      klass: "main",
      mainLift: true,
      lowerBody: ex.lowerBody ?? false,
      muscles: ex.muscles,
      progression,
    };
  };
  if (periodization === "dup" || (periodization === "block" && input.goal !== "meetPrep")) {
    if (dupScheme === "5-3-1") {
      const days = altDupWeek(Math.min(week, 4));
      const d = days[exposureIdx % days.length];
      return finish(d.sets, d.reps, d.pct, d.reps === 1 ? 7 : 8, "percent");
    }
    const row = DUP_TABLE[Math.min(weekIdx, DUP_TABLE.length - 1)];
    const role = dupRole(exposureIdx, exposures);
    const d = row[role];
    const rpe = role === "power" ? 6.5 : role === "hypertrophy" ? 7.5 : 8.5;
    return finish(d.sets, d.reps, d.pct, rpe, role === "strength" ? "rpeAuto" : "percent");
  }
  // Linear (also used inside meet-prep accumulation via block weeks below).
  if (exerciseId === "deadlift") {
    const d = linearDeadlift(week);
    return finish(d.sets, d.reps, d.pct, week >= 5 ? 8.5 : 8, "percent");
  }
  const row = LINEAR_TABLE[Math.min(weekIdx, LINEAR_TABLE.length - 1)];
  void LINEAR_WEEK5_OPENER_PCT;
  return finish(row.sets, row.reps, row.pct, week >= 5 ? 8.5 : week >= 2 ? 8 : 7.5, "percent");
}

function buildAccessory(
  exerciseId: string,
  slot: SlotKind,
  weekIdx: number,
  approach: Approach,
  input: GeneratorInput,
): PlannedExercise {
  const ex = catalogById(exerciseId);
  const ref = refFor(exerciseId, input.referenceRm);
  if (approach === "strength") {
    // B3.1: 2-3 accessories at 3x8-12 @ RPE 8, maintenance volume.
    const pct = Math.round(pctForRepsRir(10, 2) * 10) / 10;
    return {
      exerciseId,
      name: ex.name,
      sets: ex.muscles.target.includes("back") ? 4 : 3,
      repsLow: 8,
      repsHigh: 12,
      loadPct: pct,
      load: ref === undefined ? undefined : weightForPct(ref, pct),
      rpe: 8,
      slot,
      klass: ex.klass,
      mainLift: false,
      lowerBody: ex.lowerBody ?? false,
      muscles: ex.muscles,
      progression: "double",
    };
  }
  if (approach === "maintenance") {
    return {
      exerciseId,
      name: ex.name,
      sets: ex.compound ? 3 : 2,
      repsLow: 6,
      repsHigh: 10,
      loadPct: Math.round(pctForRepsRir(8, 2) * 10) / 10,
      load: undefined,
      rpe: 7.5,
      slot,
      klass: ex.klass,
      mainLift: false,
      lowerBody: ex.lowerBody ?? false,
      muscles: ex.muscles,
      progression: "double",
    };
  }
  // Hypertrophy: RIR ramp from the template; compounds 8-12, isolation 12-15.
  const row = HYPERTROPHY_TABLE[Math.min(weekIdx, HYPERTROPHY_TABLE.length - 1)];
  const compound = ex.compound;
  const rir = compound
    ? (row.rirCompound[0] + row.rirCompound[1]) / 2
    : (row.rirIsolation[0] + row.rirIsolation[1]) / 2;
  const repsMid = compound ? 10 : 13;
  const pct = Math.round(pctForRepsRir(repsMid, rir) * 10) / 10;
  return {
    exerciseId,
    name: ex.name,
    sets: 3,
    repsLow: compound ? 8 : 12,
    repsHigh: compound ? 12 : 15,
    loadPct: pct,
    load: ref === undefined ? undefined : weightForPct(ref, pct),
    rpe: rpeForRir(Math.round(rir)),
    slot,
    klass: ex.klass,
    mainLift: false,
    lowerBody: ex.lowerBody ?? false,
    muscles: ex.muscles,
    progression: "double",
  };
}

// Add accessory sets until each prioritised muscle reaches its weekly
// fractional target (within the RP direct cap), or trim past the cap.
function fitAccessoryVolume(
  days: DayPlan[],
  input: GeneratorInput,
  weekIdx: number,
  reasonCodes: Set<string>,
): void {
  const approach = approachFor(input.goal);
  const kind = approach === "strength" ? "strength" : "hypertrophy";
  const refs = input.referenceRm;
  const muscles = new Set<MuscleGroup>();
  for (const day of days) {
    for (const ex of day.exercises) {
      for (const m of ex.muscles.target) muscles.add(m);
    }
  }
  for (const muscle of [...muscles].sort()) {
    const counts = countWeekSets(days, refs).get(muscle) ?? { direct: 0, frac: 0 };
    const indirectCredit = Math.max(0, counts.frac - counts.direct);
    const priority = priorityOf(input, muscle);
    const t = kind === "strength"
      ? strengthFracTarget(muscle, priority, indirectCredit)
      : weeklyFracTarget(muscle, priority, weekIdx, indirectCredit, "hypertrophy");
    if (t.capped && t.reason) reasonCodes.add(t.reason);
    const targeting = (reverse: boolean) => {
      const list: PlannedExercise[] = [];
      const ordered = reverse ? [...days].reverse() : days;
      for (const day of ordered) {
        const exs = reverse ? [...day.exercises].reverse() : day.exercises;
        for (const ex of exs) {
          if (!ex.mainLift && ex.muscles.target.includes(muscle)) list.push(ex);
        }
      }
      return list;
    };
    if (priority !== "maintain") {
      let guard = 40;
      while (guard-- > 0) {
        const c = countWeekSets(days, refs).get(muscle) ?? { direct: 0, frac: 0 };
        if (c.frac >= t.fracTarget - 0.01 || c.direct >= t.directMax) break;
        const cand = targeting(false)
          .filter((e) => e.sets < 5)
          .sort((a, b) => a.sets - b.sets)[0];
        if (!cand) break;
        cand.sets += 1;
      }
    }
    let guard = 40;
    while (guard-- > 0) {
      const c = countWeekSets(days, refs).get(muscle) ?? { direct: 0, frac: 0 };
      const overDirect = c.direct > t.directMax;
      const overFrac = priority !== "maintain" && c.frac > 20;
      if (!overDirect && !overFrac) break;
      const cand = targeting(true).find((e) => e.sets > 2);
      if (!cand) break;
      cand.sets -= 1;
    }
    guard = 40;
    while (guard-- > 0) {
      const c = countWeekSets(days, refs).get(muscle) ?? { direct: 0, frac: 0 };
      if (c.direct === 0 || c.direct >= t.directMin) break;
      // Spread the floor across exposures: boost the lowest-set exercise
      // first so one lift does not collect the whole minimum.
      const cand = targeting(false)
        .filter((e) => e.sets < 6)
        .sort((a, b) => a.sets - b.sets)[0];
      if (!cand) break;
      cand.sets += 1;
    }
  }
}

function applyDeload(days: DayPlan[], refs: Record<string, number>): void {
  for (const day of days) {
    for (const ex of day.exercises) {
      ex.sets = Math.max(1, Math.round(ex.sets * 0.5));
      ex.rpe = 6;
      ex.loadPct = Math.round(ex.loadPct * 0.9 * 10) / 10;
      const ref = refFor(ex.exerciseId, refs);
      ex.load = ref === undefined ? undefined : weightForPct(ref, ex.loadPct);
    }
  }
}

// Main-lift slots on hypertrophy/maintenance goals are programmed as
// compounds in the goal rep range (owner 8-15 band) with double progression,
// not with strength percentages. klass stays main so rest times still apply.
function buildMainAsCompound(
  exerciseId: string,
  weekIdx: number,
  approach: Approach,
  input: GeneratorInput,
): PlannedExercise {
  const ex = catalogById(exerciseId);
  const ref = refFor(exerciseId, input.referenceRm);
  const compound = approach === "hypertrophy";
  const row = HYPERTROPHY_TABLE[Math.min(weekIdx, HYPERTROPHY_TABLE.length - 1)];
  const rir = compound
    ? (row.rirCompound[0] + row.rirCompound[1]) / 2
    : 2;
  const repsMid = compound ? 10 : 8;
  const pct = Math.round(pctForRepsRir(repsMid, rir) * 10) / 10;
  return {
    exerciseId,
    name: ex.name,
    sets: 4,
    repsLow: compound ? 8 : 6,
    repsHigh: compound ? 12 : 10,
    loadPct: pct,
    load: ref === undefined ? undefined : weightForPct(ref, pct),
    rpe: rpeForRir(Math.round(rir)),
    slot: "strength",
    klass: "main",
    mainLift: true,
    lowerBody: ex.lowerBody ?? false,
    muscles: ex.muscles,
    progression: "double",
  };
}

function exposuresByLift(
  templates: DayTemplate[],
  available: CatalogExercise[],
  goal: GoalKind,
): Map<string, string[]> {
  // lift id -> ordered day labels where it (or first exposure slot) appears.
  const map = new Map<string, string[]>();
  for (const t of templates) {
    for (const s of slotsForDay(t, goal, available)) {
      if (MAIN_LIFT_IDS.has(s.exerciseId)) {
        if (!map.has(s.exerciseId)) map.set(s.exerciseId, []);
        map.get(s.exerciseId)!.push(t.label);
      }
    }
  }
  return map;
}

function buildTrainingWeek(
  weekIdx: number,
  input: GeneratorInput,
  periodization: Periodization,
  reasonCodes: Set<string>,
): DayPlan[] {
  const approach = approachFor(input.goal);
  const split = chooseSplit(input.daysPerWeek, input.experience);
  const available = availableExercises(input.equipment, input.exclusions);
  const exposures = exposuresByLift(split.days, available, input.goal);
  const seen = new Map<string, number>();
  const dupScheme: DupScheme = input.dupScheme ?? "hps";
  void ALT_DUP_DAYS;

  // Accessories already placed this week; later days prefer unused variants
  // (row then pull-up across the upper days, leg press then lunge, ...).
  const usedAccessories = new Set<string>();
  const days: DayPlan[] = split.days.map((t) => {
    const slots: SlotAssignment[] = slotsForDay(t, input.goal, available, usedAccessories);
    const exercises: PlannedExercise[] = [];
    for (const s of slots) {
      if (!MAIN_LIFT_IDS.has(s.exerciseId)) usedAccessories.add(s.exerciseId);
      if (MAIN_LIFT_IDS.has(s.exerciseId)) {
        if (approach === "strength") {
          const total = exposures.get(s.exerciseId)?.length ?? 1;
          const idx = seen.get(s.exerciseId) ?? 0;
          seen.set(s.exerciseId, idx + 1);
          exercises.push(
            buildMainLift(s.exerciseId, weekIdx, idx, total, input, periodization, dupScheme),
          );
        } else {
          exercises.push(buildMainAsCompound(s.exerciseId, weekIdx, approach, input));
        }
      } else {
        exercises.push(buildAccessory(s.exerciseId, s.slot, weekIdx, approach, input));
      }
    }
    const lowerBody = t.lowerBody;
    const heavyLower = lowerBody &&
      exercises.some((e) => e.mainLift && e.loadPct >= 85);
    return { label: t.label, focus: t.focus, lowerBody, heavyLower, exercises };
  });

  if (approach !== "maintenance") {
    fitAccessoryVolume(days, input, weekIdx, reasonCodes);
  }
  // Fit every day to the time budget (PLAN.md 12: scaled by priority, fitted
  // to the time budget). The time fit only trims accessories, main lifts are
  // never cut. Afterwards floors are re-checked: a floor broken by trimming
  // is restored while the day stays within 10% of the budget.
  for (let i = 0; i < days.length; i++) {
    const fitted = fitToTimeBudget(days[i], approach, input.referenceRm, input.sessionMinutes);
    days[i] = fitted.day;
  }
  reenforceFloors(days, input);
  return days;
}

// Restore RP MEV-lo floors that time trimming broke, one set at a time,
// stopping before the day would pass 10% over budget.
function reenforceFloors(days: DayPlan[], input: GeneratorInput): void {
  const approach = approachFor(input.goal);
  const refs = input.referenceRm;
  for (let round = 0; round < 20; round++) {
    let fixed = true;
    const counts = countWeekSets(days, refs);
    for (const [muscle, c] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
      const t = approach === "strength"
        ? strengthFracTarget(muscle, priorityOf(input, muscle), 0)
        : weeklyFracTarget(muscle, priorityOf(input, muscle), 0, 0, "hypertrophy");
      if (c.direct === 0 || c.direct >= t.directMin) continue;
      const cands: PlannedExercise[] = [];
      for (const day of days) {
        for (const ex of day.exercises) {
          if (!ex.mainLift && ex.muscles.target.includes(muscle) && ex.sets < 6) cands.push(ex);
        }
      }
      cands.sort((a, b) => a.sets - b.sets);
      const cand = cands[0];
      if (!cand) continue;
      cand.sets += 1;
      const day = days.find((d) => d.exercises.includes(cand))!;
      if (estimateSessionMinutes(day, approach, refs) > input.sessionMinutes * 1.1) {
        cand.sets -= 1;
        continue;
      }
      fixed = false;
    }
    if (fixed) return;
  }
}

function buildTaperWeek(meetDate: string, input: GeneratorInput): DayPlan[] {
  const sessions = taperSchedule(meetDate);
  const kindOrder = { lastHeavy: 0, lastSession: 1 };
  const ordered = [...sessions].sort((a, b) =>
    a.dateISO.localeCompare(b.dateISO) || kindOrder[a.kind] - kindOrder[b.kind]
  );
  const liftExercise: Record<string, string> = {
    squat: "squat",
    bench: "bench",
    deadlift: "deadlift",
  };
  const days: DayPlan[] = ordered.map((s) => {
    const ref = refFor(liftExercise[s.lift], input.referenceRm);
    let sets = 2;
    let reps = 1;
    let pct = TAPER[s.lift].openerPct[0];
    if (s.kind === "lastSession") {
      const scheme = TAPER[s.lift].finalScheme; // e.g. "3x2"
      const m = scheme.match(/(\d+)x(\d+)/)!;
      sets = Number(m[1]);
      reps = Number(m[2]);
      pct = (TAPER[s.lift].finalPct[0] + TAPER[s.lift].finalPct[1]) / 2;
    }
    const ex = catalogById(liftExercise[s.lift]);
    const planned: PlannedExercise = {
      exerciseId: ex.id,
      name: ex.name,
      sets,
      repsLow: reps,
      repsHigh: reps,
      loadPct: pct,
      load: ref === undefined ? undefined : weightForPct(ref, pct),
      rpe: s.kind === "lastHeavy" ? 8 : 7,
      slot: "strength",
      klass: "main",
      mainLift: true,
      lowerBody: s.lift !== "bench",
      muscles: ex.muscles,
      progression: "percent",
    };
    return {
      label: `${s.lift} ${s.kind === "lastHeavy" ? "opener" : "final"} - ${s.dateISO} (${s.daysOut}d out)`,
      focus: "taper",
      lowerBody: s.lift !== "bench",
      heavyLower: s.kind === "lastHeavy" && s.lift !== "bench",
      exercises: [planned],
    };
  });
  days.push({
    label: `Meet day - ${meetDate}`,
    focus: "meet",
    lowerBody: true,
    heavyLower: true,
    exercises: ["squat", "bench", "deadlift"].map((id) => {
      const ex = catalogById(id);
      const ref = refFor(id, input.referenceRm);
      return {
        exerciseId: id,
        name: ex.name,
        sets: 3,
        repsLow: 1,
        repsHigh: 1,
        loadPct: 100,
        load: ref,
        rpe: 9.5,
        slot: "strength" as SlotKind,
        klass: "main" as const,
        mainLift: true,
        lowerBody: id !== "bench",
        muscles: ex.muscles,
        progression: "percent" as const,
      };
    }),
  });
  return days;
}

export function generateBlock(input: GeneratorInput): BlockDef {
  if (input.daysPerWeek < 2 || input.daysPerWeek > 6) {
    throw new Error("daysPerWeek must be 2-6 (PLAN.md 12 splits)");
  }
  if (input.blockWeeks < 2 || input.blockWeeks > 7) {
    throw new Error("blockWeeks must be 2-7 (PLAN.md 12 block length)");
  }
  if (input.goal === "meetPrep" && !input.meetDate) {
    throw new Error("meetPrep requires meetDate");
  }
  const approach = approachFor(input.goal);
  const periodization = periodizationFor(input.goal, input.experience, input.periodization);
  const reasonCodes = new Set<string>();
  const weeks: BlockWeek[] = [];
  const trainingWeeks = input.goal === "meetPrep" ? input.blockWeeks - 1 : input.blockWeeks;
  for (let w = 0; w < trainingWeeks; w++) {
    const deload = input.goal !== "meetPrep" && w === input.blockWeeks - 1;
    const days = buildTrainingWeek(w, input, periodization, reasonCodes);
    if (deload) applyDeload(days, input.referenceRm);
    weeks.push({ week: w + 1, deload, days });
  }
  if (input.goal === "meetPrep") {
    weeks.push({
      week: input.blockWeeks,
      deload: false,
      days: buildTaperWeek(input.meetDate!, input),
    });
  }
  const names: Record<GeneratorInput["goal"], string> = {
    hypertrophy: "Hypertrophy block",
    strength: periodization === "dup" ? "Strength block (DUP)" : "Strength block (linear)",
    meetPrep: "Meet prep (taper to date)",
    athleticMaintenance: "In-season maintenance",
  };
  void VOLUME_CAPPED_BY_MRV;
  return {
    name: names[input.goal],
    goal: input.goal,
    approach,
    periodization,
    blockWeeks: input.blockWeeks,
    weeks,
    reasonCodes: [...reasonCodes].sort(),
  };
}
