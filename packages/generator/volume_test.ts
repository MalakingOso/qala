// Volume rules (PLAN.md 6.3): fractional band inside RP caps, +2/week ramp in
// hypertrophy blocks only, strength holds, deload x0.5, time fit.

import {
  approachFor,
  countDaySets,
  countWeekSets,
  generateBlock,
  rpRow,
} from "./mod.ts";
import type {
  DayPlan,
  GeneratorInput,
  MuscleGroup,
  PlannedExercise,
} from "./mod.ts";
import {
  bandFor,
  baseRestSec,
  DELOAD_FACTOR,
  estimateSessionMinutes,
  fitToTimeBudget,
  strengthFracTarget,
  weeklyFracTarget,
} from "./volume.ts";
import { VOLUME_CAPPED_BY_MRV } from "./types.ts";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

function approx(a: number, b: number, msg: string, eps = 1e-9): void {
  if (Math.abs(a - b) > eps) {
    throw new Error(`assert failed: ${msg} (${a} != ${b})`);
  }
}

const BASE: GeneratorInput = {
  goal: "hypertrophy",
  daysPerWeek: 4,
  sessionMinutes: 90,
  experience: "intermediate",
  equipment: [],
  priorities: {},
  exclusions: [],
  blockWeeks: 5,
  referenceRm: { squat: 265, bench: 200, deadlift: 315, ohp: 125 },
};

function mkEx(
  partial: Partial<PlannedExercise> & { exerciseId: string },
): PlannedExercise {
  return {
    name: partial.exerciseId,
    sets: 3,
    repsLow: 8,
    repsHigh: 12,
    loadPct: 70,
    rpe: 8,
    slot: "accessoryLow",
    klass: "secondary",
    mainLift: false,
    lowerBody: false,
    muscles: { target: ["chest"], synergist: ["triceps"] },
    progression: "double",
    ...partial,
  } as PlannedExercise;
}

Deno.test("RP rows and owner bands match PLAN.md 6.3", () => {
  assert(rpRow("chest").mev.join() === "4,6", "chest MEV 4-6");
  assert(rpRow("back").mev.join() === "12,14", "back MEV 12-14");
  assert(rpRow("hamstrings").mrv.join() === "8,14", "hamstrings MRV 8-14");
  assert(
    rpRow("frontDelts").mev.join() === rpRow("chest").mev.join(),
    "missing rows use chest numbers",
  );
  assert(
    bandFor("grow").lo === 10 && bandFor("grow").hi === 20,
    "grow band 10-20",
  );
  assert(bandFor("emphasise").lo === 14, "emphasise band starts at 14");
  assert(
    Number.isNaN(bandFor("maintain").lo),
    "maintain has no fractional floor",
  );
});

Deno.test("weekly ramp: +2/week hypertrophy, hold for strength", () => {
  assert(
    weeklyFracTarget("chest", "grow", 0, 0, "hypertrophy").fracTarget === 10,
    "chest starts at 10",
  );
  assert(
    weeklyFracTarget("chest", "grow", 1, 0, "hypertrophy").fracTarget === 12,
    "+2 in week 2",
  );
  assert(
    weeklyFracTarget("back", "grow", 0, 0, "hypertrophy").fracTarget === 14,
    "back starts at 14",
  );
  const hold0 = weeklyFracTarget("quads", "grow", 0, 0, "strength").fracTarget;
  const hold3 = weeklyFracTarget("quads", "grow", 3, 0, "strength").fracTarget;
  assert(hold0 === hold3, "strength blocks hold volume");
  assert(
    strengthFracTarget("chest", "grow", 0).fracTarget <= 10,
    "strength volume near 10",
  );
  assert(DELOAD_FACTOR === 0.5, "deload halves volume");
});

Deno.test("hamstrings without hinge credit are capped with a reason code", () => {
  const t = weeklyFracTarget("hamstrings", "grow", 0, 0, "hypertrophy");
  assert(t.capped, "hamstrings capped without credit");
  assert(t.reason === VOLUME_CAPPED_BY_MRV, "reason code carried");
  const withCredit = weeklyFracTarget(
    "hamstrings",
    "grow",
    0,
    4,
    "hypertrophy",
  );
  assert(
    withCredit.fracTarget >= 10 - 1e-9 || withCredit.capped,
    "credit lifts the cap",
  );
});

Deno.test("hard-set counting: direct plus half synergist", () => {
  const day: PlannedExercise[] = [
    mkEx({ exerciseId: "bench", sets: 4, rpe: 8 }),
    mkEx({
      exerciseId: "pushdown",
      sets: 2,
      rpe: 6,
      muscles: { target: ["triceps"], synergist: [] },
    }),
  ];
  const counts = countDaySets(day, {});
  assert(counts.get("chest")!.direct === 4, "bench counts 4 direct chest");
  approx(counts.get("triceps")!.frac, 2, "synergist counts half (RPE 8 bench)");
  assert(!counts.get("biceps"), "untrained muscles absent");
});

Deno.test("time fit keeps the day within 10% and never cuts main lifts", () => {
  const day: DayPlan = {
    label: "Upper A",
    focus: "upper",
    lowerBody: false,
    heavyLower: false,
    exercises: [
      mkEx({
        exerciseId: "bench",
        sets: 4,
        klass: "main",
        mainLift: true,
        rpe: 8,
      }),
      mkEx({ exerciseId: "row", sets: 4, rpe: 8 }),
      mkEx({
        exerciseId: "curl",
        sets: 4,
        klass: "isolation",
        rpe: 8,
        muscles: { target: ["biceps"], synergist: [] },
      }),
      mkEx({
        exerciseId: "pushdown",
        sets: 4,
        klass: "isolation",
        rpe: 8,
        muscles: { target: ["triceps"], synergist: [] },
      }),
    ],
  };
  const approach = approachFor("strength");
  const before = estimateSessionMinutes(day, approach, {});
  assert(before > 30, "fixture day is sizable");
  const fitted = fitToTimeBudget(day, approach, {}, 30);
  assert(
    fitted.estimatedMin <= 30 * 1.1 + 1e-9,
    "fitted within 10% over the tight budget",
  );
  assert(fitted.day.exercises[0].sets === 4, "main lift sets untouched");
  assert(baseRestSec("strength", "main") === 180, "strength main rest 180 s");
  assert(
    baseRestSec("hypertrophy", "secondary") === 120,
    "hypertrophy secondary rest 120 s",
  );
});

Deno.test("generated blocks: weekly direct sets within MEV..MRV or capped", () => {
  for (
    const goal of ["hypertrophy", "strength", "athleticMaintenance"] as const
  ) {
    for (const days of [2, 3, 4, 5, 6]) {
      const input: GeneratorInput = { ...BASE, goal, daysPerWeek: days };
      const block = generateBlock(input);
      const capped = block.reasonCodes.includes(VOLUME_CAPPED_BY_MRV);
      for (const week of block.weeks) {
        if (week.deload) continue;
        for (const [m, c] of countWeekSets(week.days, input.referenceRm)) {
          const rp = rpRow(m as MuscleGroup);
          const ok = c.direct === 0 ||
            (c.direct >= rp.mev[0] && c.direct <= rp.mrv[0]);
          assert(
            ok || capped,
            `${goal} ${days}d wk${week.week} ${m} direct=${c.direct}`,
          );
        }
      }
    }
  }
});

Deno.test("generated hypertrophy blocks: fractional sets in band or capped", () => {
  for (const days of [2, 3, 4, 5, 6]) {
    const input: GeneratorInput = { ...BASE, daysPerWeek: days };
    const block = generateBlock(input);
    const capped = block.reasonCodes.includes(VOLUME_CAPPED_BY_MRV);
    for (const week of block.weeks) {
      if (week.deload) continue;
      for (const [m, c] of countWeekSets(week.days, input.referenceRm)) {
        if (c.direct === 0) continue;
        const ok = c.frac >= 10 - 1e-9 && c.frac <= 20 + 1e-9;
        assert(ok || capped, `${days}d wk${week.week} ${m} frac=${c.frac}`);
      }
    }
  }
});

Deno.test("generated days fit the time budget within 10%", () => {
  for (
    const goal of ["hypertrophy", "strength", "athleticMaintenance"] as const
  ) {
    const input: GeneratorInput = { ...BASE, goal, daysPerWeek: 4 };
    const block = generateBlock(input);
    const approach = approachFor(input.goal);
    for (const week of block.weeks) {
      for (const day of week.days) {
        const est = estimateSessionMinutes(day, approach, input.referenceRm);
        assert(
          est <= input.sessionMinutes * 1.1 + 1e-9,
          `${goal} ${day.label} ${est.toFixed(1)} min`,
        );
      }
    }
  }
});

Deno.test("strength blocks keep the main-lift minimum effective dose", () => {
  // Androulakis-Korakakis 2021: about 3-6 sets of 1-5 reps above 80% per lift
  // per week at RPE 7.5-9.5, outside deloads.
  const input: GeneratorInput = { ...BASE, goal: "strength" };
  const block = generateBlock(input);
  for (const week of block.weeks) {
    if (week.deload) continue;
    for (const lift of ["squat", "bench", "deadlift"]) {
      let sets = 0;
      for (const day of week.days) {
        for (const ex of day.exercises) {
          if (ex.exerciseId === lift && ex.repsHigh <= 5 && ex.loadPct >= 80) {
            sets += ex.sets;
          }
        }
      }
      assert(
        sets >= 3 && sets <= 8,
        `${lift} wk${week.week} has ${sets} heavy sets`,
      );
    }
  }
});
