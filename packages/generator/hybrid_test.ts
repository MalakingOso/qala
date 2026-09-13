// Hybrid scheduler (PLAN.md 12, spacing rules from the 6.4 table): runs land
// on compatible days, and whatever cannot fit is reported as a traded rule
// with the priority that won.

import { generateBlock, generateRunPlan, scheduleHybrid } from "./mod.ts";
import type { DayPlan, GeneratorInput, RunPlanWeek, RunWorkout } from "./mod.ts";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

const LIFT_INPUT: GeneratorInput = {
  goal: "strength",
  daysPerWeek: 4,
  sessionMinutes: 90,
  experience: "intermediate",
  equipment: [],
  priorities: {},
  exclusions: [],
  blockWeeks: 5,
  referenceRm: { squat: 265, bench: 200, deadlift: 315, ohp: 125 },
};

function liftDays(): DayPlan[] {
  // Week 3 carries heavy (>= 85%) lower-body sessions.
  return generateBlock(LIFT_INPUT).weeks[2].days;
}

function runWeek(): RunPlanWeek {
  return generateRunPlan({
    goal: "base",
    runsPerWeek: 4,
    currentWeeklyKm: 20,
    longestRunKm: 8,
    weeks: 6,
    criticalSpeedMps: 4.0,
  }).weeks[0];
}

function mkDay(label: string, lowerBody: boolean, heavyLower: boolean): DayPlan {
  return { label, focus: lowerBody ? "lower" : "upper", lowerBody, heavyLower, exercises: [] };
}

function mkWorkout(type: "easy" | "tempo" | "long", hard: boolean): RunWorkout {
  return {
    type,
    steps: [{ kind: "work", seconds: 1800, paceZone: "easy" }],
    targetMin: 30,
    targetKm: 5,
    hard,
  };
}

Deno.test("every run is placed with a note, trades carry rule and winner", () => {
  const hybrid = scheduleHybrid({ liftDays: liftDays(), runWeek: runWeek(), priority: "lifting", approach: "strength" });
  assert(hybrid.placements.length === 4, "all four runs placed");
  for (const p of hybrid.placements) {
    assert(p.notes.length > 0, `placement on day ${p.dayOfWeek} says why`);
  }
  for (const t of hybrid.traded) {
    assert(t.rule.length > 0 && t.why.length > 0, "trade names its rule and reason");
    assert(t.winner === "lifting" || t.winner === "running", "trade names the winning priority");
  }
});

Deno.test("quality work prefers lower-body days with a 6 h gap", () => {
  const week: RunPlanWeek = {
    week: 1,
    downWeek: false,
    taperWeek: false,
    days: [{ dayOfWeek: 2, workout: mkWorkout("tempo", true) }],
  };
  const hybrid = scheduleHybrid({
    liftDays: [mkDay("Upper A", false, false), mkDay("Lower A", true, false)],
    runWeek: week,
    priority: "running",
    approach: "hypertrophy",
  });
  const placed = hybrid.placements[0];
  assert(placed.liftLabel === "Lower A", "tempo lands on the lower-body day");
  assert(placed.gapHours === 6, "run at least 6 h after lifting");
});

Deno.test("strength priority reports the 24 h separation trade", () => {
  const week: RunPlanWeek = {
    week: 1,
    downWeek: false,
    taperWeek: false,
    days: [{ dayOfWeek: 2, workout: mkWorkout("tempo", true) }],
  };
  const hybrid = scheduleHybrid({
    liftDays: [mkDay("Upper A", false, false), mkDay("Lower A", true, true)],
    runWeek: week,
    priority: "lifting",
    approach: "strength",
  });
  assert(
    hybrid.traded.some((t) => t.rule === "GAP_24H_WHEN_STRENGTH" && t.winner === "lifting"),
    "24 h rule traded with lifting winning",
  );
});

Deno.test("hard run after heavy lower body softens when lifting wins", () => {
  const week: RunPlanWeek = {
    week: 1,
    downWeek: false,
    taperWeek: false,
    days: [{ dayOfWeek: 3, workout: mkWorkout("tempo", true) }],
  };
  const days = [mkDay("Lower A", true, true), mkDay("Rest", false, false)];
  // Lift days map Mon..Sat in order; force the heavy day adjacent to the run.
  const hybrid = scheduleHybrid({
    liftDays: [mkDay("Mon", false, false), days[0], days[1]],
    runWeek: week,
    priority: "lifting",
    approach: "hypertrophy",
  });
  const placed = hybrid.placements.find((p) => p.dayOfWeek === 3)!;
  assert(placed.workout.hard === false, "hard run softened to easy after heavy lower body");
  assert(placed.workout.type === "easy", "softened run is typed easy");
});

Deno.test("hard run after heavy lower body stands when running wins", () => {
  const week: RunPlanWeek = {
    week: 1,
    downWeek: false,
    taperWeek: false,
    days: [{ dayOfWeek: 3, workout: mkWorkout("tempo", true) }],
  };
  const hybrid = scheduleHybrid({
    liftDays: [mkDay("Mon", false, false), mkDay("Lower A", true, true)],
    runWeek: week,
    priority: "running",
    approach: "hypertrophy",
  });
  const placed = hybrid.placements.find((p) => p.dayOfWeek === 3)!;
  assert(placed.workout.hard === true, "hard run kept with running priority");
  assert(
    hybrid.traded.some((t) => t.rule === "NO_HARD_RUN_24H_AFTER_HEAVY_LOWER" && t.winner === "running"),
    "trade reported with running winning",
  );
});

Deno.test("heavy lower body in marathon week is reported", () => {
  const hybrid = scheduleHybrid({
    liftDays: liftDays(),
    runWeek: runWeek(),
    priority: "running",
    approach: "hypertrophy",
    raceKmThisWeek: 42,
  });
  assert(
    hybrid.traded.some((t) => t.rule === "NO_HEAVY_LOWER_NEAR_LONG_RACE"),
    "marathon-week heavy lower body reported",
  );
  const calm = scheduleHybrid({
    liftDays: liftDays(),
    runWeek: runWeek(),
    priority: "running",
    approach: "hypertrophy",
  });
  assert(
    !calm.traded.some((t) => t.rule === "NO_HEAVY_LOWER_NEAR_LONG_RACE"),
    "no race means no race trade",
  );
});
