// GZCLP 3-day progression simulation (PLAN section 5).
//
// Simulates the documented GZCLP rules: T1/T2 add 5lb (upper) or 10lb
// (lower) when all sets finish, T1 moves 5x3 -> 6x2 -> 10x1 on a miss, T3
// adds 5lb only when the last-set AMRAP reaches 25+ reps.

import { assert, assertEquals } from "@std/assert";
import type { IHistoryEntry, ISettings } from "../src/types.ts";
import type { IEvaluatedProgram } from "../src/models/program.ts";
import type { IPlannerProgramExerciseWithType } from "../src/pages/planner/models/types.ts";
import {
  createEngineBindings,
  Exercise_toKey,
  forceEvaluateText,
  Program_nextHistoryEntry,
  ProgramSet_getEvaluatedWeight,
  qalaSettingsToLiftoscript,
  runAllFinishDayScripts,
  runFinishDayScript,
  Stats_getEmpty,
  Weight_build,
  Weight_is,
} from "../mod.ts";
import { loadBuiltinProgram } from "./helpers.ts";

function settingsWithRm1(): ISettings {
  const settings = qalaSettingsToLiftoscript(
    { units: { weight: "lb", distance: "mi" } } as never,
  );
  // Assign 1RMs by exercise id, keyed exactly the way Exercise_onerm looks
  // them up (Exercise_toKey of the evaluated exercise type).
  const rm1ById: Record<string, number> = {
    squat: 200,
    benchPress: 150,
    deadlift: 250,
    overheadPress: 110,
  };
  const probe = forceEvaluateText(
    loadBuiltinProgram("gzclp.md"),
    "GZCLP",
    settings,
  );
  for (const week of probe.weeks) {
    for (const day of week.days) {
      for (const e of day.exercises) {
        if (e.exerciseType != null && rm1ById[e.exerciseType.id] != null) {
          settings.exerciseData[Exercise_toKey(e.exerciseType)] = {
            rm1: Weight_build(rm1ById[e.exerciseType.id], "lb"),
          };
        }
      }
    }
  }
  return settings;
}

function evaluateGzclp(settings: ISettings): IEvaluatedProgram {
  const prog = forceEvaluateText(
    loadBuiltinProgram("gzclp.md"),
    "GZCLP",
    settings,
  );
  assertEquals(
    prog.errors.map((e) => String(e.error)),
    [],
    "GZCLP evaluates without errors",
  );
  return prog;
}

function usedExercises(
  prog: IEvaluatedProgram,
  day: number,
): IPlannerProgramExerciseWithType[] {
  const programDay = prog.weeks[0].days[day - 1];
  return programDay.exercises.filter((e) =>
    !e.notused && e.exerciseType != null
  ) as IPlannerProgramExerciseWithType[];
}

/**
 * Working weight of an evaluated set, resolved exactly like the app resolves
 * it (percentage of the exercise 1RM, rounded to the gym's plates).
 */
function setWeight(
  prog: IEvaluatedProgram,
  day: number,
  keyPrefix: string,
  settings: ISettings,
): number[] {
  const exercise = usedExercises(prog, day).find((e) =>
    e.key.startsWith(keyPrefix)
  );
  assert(exercise, `day ${day} has exercise ${keyPrefix}`);
  const index = exercise.evaluatedSetVariations.findIndex((v) => v.isCurrent);
  const variation = exercise.evaluatedSetVariations[index === -1 ? 0 : index];
  return variation.sets.map((s) => {
    const w = ProgramSet_getEvaluatedWeight(s, exercise.exerciseType, settings);
    assert(
      w && Weight_is(w),
      `set resolves to a weight, got ${JSON.stringify(s.weight)}`,
    );
    return w.value;
  });
}

function currentReps(
  prog: IEvaluatedProgram,
  day: number,
  keyPrefix: string,
): number[] {
  const exercise = usedExercises(prog, day).find((e) =>
    e.key.startsWith(keyPrefix)
  );
  assert(exercise, `day ${day} has exercise ${keyPrefix}`);
  const index = exercise.evaluatedSetVariations.findIndex((v) => v.isCurrent);
  return exercise.evaluatedSetVariations[index === -1 ? 0 : index].sets.map((
    s,
  ) => s.maxrep ?? NaN);
}

/** Complete every set of an exercise at its prescribed targets. */
function completeAllSets(
  prog: IEvaluatedProgram,
  day: number,
  exercise: IPlannerProgramExerciseWithType,
  settings: ISettings,
  opts?: { lastSetReps?: number; missLastBy?: number },
): IHistoryEntry {
  const dayData = prog.weeks[0].days[day - 1].dayData;
  const entry = Program_nextHistoryEntry(
    prog,
    dayData,
    0,
    exercise,
    Stats_getEmpty(),
    settings,
  );
  entry.sets.forEach((set, i) => {
    const targetReps = set.reps ?? 0;
    const last = i === entry.sets.length - 1;
    let completedReps = targetReps;
    if (last && opts?.lastSetReps != null) {
      completedReps = opts.lastSetReps;
    } else if (last && opts?.missLastBy != null) {
      completedReps = Math.max(0, targetReps - opts.missLastBy);
    }
    const weight = set.weight ?? Weight_build(0, "lb");
    set.completedReps = completedReps;
    set.completedWeight = Weight_is(weight) ? weight : Weight_build(0, "lb");
    set.isCompleted = true;
  });
  return entry;
}

Deno.test("gzclp: program structure matches the documented 4-day rotation", () => {
  const settings = settingsWithRm1();
  const prog = evaluateGzclp(settings);
  assertEquals(prog.weeks.length, 1);
  assertEquals(prog.weeks[0].days.length, 4);
  const day1 = usedExercises(prog, 1).map((e) =>
    Exercise_toKey(e.exerciseType)
  );
  assertEquals(day1, [
    "squat_barbell",
    "benchPress_barbell",
    "latPulldown_cable",
  ]);
  const day2 = usedExercises(prog, 2).map((e) =>
    Exercise_toKey(e.exerciseType)
  );
  assertEquals(day2, [
    "overheadPress_barbell",
    "deadlift_barbell",
    "bentOverRow_barbell",
  ]);
  // T1 starts at 75% of the 1RM: squat 200 -> 150 across 5 sets of 3.
  assertEquals(setWeight(prog, 1, "t1", settings), [150, 150, 150, 150, 150]);
  assertEquals(currentReps(prog, 1, "t1"), [3, 3, 3, 3, 3]);
  // T2 starts at 62%: bench 150 -> 3x10.
  assertEquals(currentReps(prog, 1, "t2"), [10, 10, 10]);
  // T3 is 2x15 plus an AMRAP.
  const t3 = usedExercises(prog, 1).find((e) => e.key.startsWith("t3"))!;
  const t3sets = t3.evaluatedSetVariations[0].sets;
  assertEquals(t3sets.length, 3);
  assertEquals(t3sets.map((s) => s.maxrep), [15, 15, 15]);
  assertEquals(t3sets[2].isAmrap, true);
});

Deno.test("gzclp day 1: successful T1/T2 add weight, quiet T3 holds", () => {
  const settings = settingsWithRm1();
  const prog = evaluateGzclp(settings);
  const before = {
    squat: setWeight(prog, 1, "t1", settings),
    bench: setWeight(prog, 1, "t2", settings),
    lat: setWeight(prog, 1, "t3", settings),
  };
  const entries = usedExercises(prog, 1).map((e) =>
    completeAllSets(prog, 1, e, settings)
  );
  const result = runAllFinishDayScripts(
    prog,
    1,
    entries,
    settings,
    Stats_getEmpty(),
  );
  assertEquals(result.errors, []);
  assertEquals(result.nextDay, 2);
  const after = {
    squat: setWeight(result.evaluatedProgram, 1, "t1", settings),
    bench: setWeight(result.evaluatedProgram, 1, "t2", settings),
    lat: setWeight(result.evaluatedProgram, 1, "t3", settings),
  };
  // Lower-body T1 adds 10lb, upper-body T2 adds 5lb (documented GZCLP rules).
  assertEquals(after.squat, before.squat.map((w) => w + 10));
  assertEquals(after.bench, before.bench.map((w) => w + 5));
  // T3 last set hit 15 (< 25), so no change.
  assertEquals(after.lat, before.lat);
  // T1 stays on stage 1 (5 sets of 3) after a success.
  assertEquals(currentReps(result.evaluatedProgram, 1, "t1"), [3, 3, 3, 3, 3]);
});

Deno.test("gzclp days 2-3: documented upper/lower increases", () => {
  const settings = settingsWithRm1();
  // Day 2: OHP T1 (+5, upper) and Deadlift T2 (+10, lower).
  {
    const prog = evaluateGzclp(settings);
    const beforeOhp = setWeight(prog, 2, "t1", settings);
    const beforeDeadlift = setWeight(prog, 2, "t2", settings);
    const entries = usedExercises(prog, 2).map((e) =>
      completeAllSets(prog, 2, e, settings)
    );
    const result = runAllFinishDayScripts(
      prog,
      2,
      entries,
      settings,
      Stats_getEmpty(),
    );
    assertEquals(result.errors, []);
    assertEquals(
      setWeight(result.evaluatedProgram, 2, "t1", settings),
      beforeOhp.map((w) => w + 5),
    );
    assertEquals(
      setWeight(result.evaluatedProgram, 2, "t2", settings),
      beforeDeadlift.map((w) => w + 10),
    );
  }
  // Day 3: Bench T1 (+5) and Squat T2 (+10).
  {
    const prog = evaluateGzclp(settings);
    const beforeBench = setWeight(prog, 3, "t1", settings);
    const beforeSquat = setWeight(prog, 3, "t2", settings);
    const entries = usedExercises(prog, 3).map((e) =>
      completeAllSets(prog, 3, e, settings)
    );
    const result = runAllFinishDayScripts(
      prog,
      3,
      entries,
      settings,
      Stats_getEmpty(),
    );
    assertEquals(result.errors, []);
    assertEquals(
      setWeight(result.evaluatedProgram, 3, "t1", settings),
      beforeBench.map((w) => w + 5),
    );
    assertEquals(
      setWeight(result.evaluatedProgram, 3, "t2", settings),
      beforeSquat.map((w) => w + 10),
    );
  }
});

Deno.test("gzclp: missed T1 reps move to stage 2 without adding weight", () => {
  const settings = settingsWithRm1();
  const prog = evaluateGzclp(settings);
  const before = setWeight(prog, 1, "t1", settings);
  const entries = usedExercises(prog, 1).map((e) => {
    if (e.key.startsWith("t1")) {
      return completeAllSets(prog, 1, e, settings, { missLastBy: 2 });
    }
    return completeAllSets(prog, 1, e, settings);
  });
  const result = runAllFinishDayScripts(
    prog,
    1,
    entries,
    settings,
    Stats_getEmpty(),
  );
  assertEquals(result.errors, []);
  // Stage 2 is 6 sets of 2 at the same weight.
  assertEquals(currentReps(result.evaluatedProgram, 1, "t1"), [
    2,
    2,
    2,
    2,
    2,
    2,
  ]);
  assertEquals(
    setWeight(result.evaluatedProgram, 1, "t1", settings),
    before.map(() => before[0]).concat([before[0]]),
  );
});

Deno.test("gzclp: T3 AMRAP of 25+ adds 5lb", () => {
  const settings = settingsWithRm1();
  const prog = evaluateGzclp(settings);
  const before = setWeight(prog, 1, "t3", settings);
  const entries = usedExercises(prog, 1).map((e) => {
    if (e.key.startsWith("t3")) {
      return completeAllSets(prog, 1, e, settings, { lastSetReps: 27 });
    }
    return completeAllSets(prog, 1, e, settings);
  });
  const result = runAllFinishDayScripts(
    prog,
    1,
    entries,
    settings,
    Stats_getEmpty(),
  );
  assertEquals(result.errors, []);
  assertEquals(
    setWeight(result.evaluatedProgram, 1, "t3", settings),
    before.map((w) => w + 5),
  );
});

Deno.test("engine bindings: defaults, clamping, and finish-day merge", () => {
  const neutral = createEngineBindings();
  assertEquals(neutral, {
    readiness: 1,
    prs: 0,
    soreness: 1,
    fatigueLocal: 0,
    deload: 0,
    recWeightPct: 0,
    recSets: 0,
  });
  const clamped = createEngineBindings({
    readiness: 2,
    prs: -3,
    soreness: 9,
    fatigueLocal: -1,
    deload: 7,
    recWeightPct: -50,
    recSets: 5,
  });
  assertEquals(clamped, {
    readiness: 1,
    prs: 0,
    soreness: 4,
    fatigueLocal: 0,
    deload: 2,
    recWeightPct: -10,
    recSets: 1,
  });
  // Finish-day scripts see the engine bindings and still progress.
  const settings = settingsWithRm1();
  const prog = evaluateGzclp(settings);
  const squat = usedExercises(prog, 1).find((e) => e.key.startsWith("t1"))!;
  const dayData = prog.weeks[0].days[0].dayData;
  const entry = completeAllSets(prog, 1, squat, settings);
  const result = runFinishDayScript(
    squat,
    prog,
    dayData,
    entry,
    settings,
    Stats_getEmpty(),
    {
      engine: {
        readiness: 0.5,
        prs: 6,
        soreness: 2,
        fatigueLocal: 0.3,
        deload: 0,
        recWeightPct: -2,
        recSets: 0,
      },
    },
  );
  assert(
    result.success,
    `finish script succeeds: ${result.success ? "" : result.error}`,
  );
  if (result.success) {
    assertEquals(result.data.bindings.readiness, 0.5);
    assertEquals(result.data.bindings.prs, 6);
    assertEquals(result.data.bindings.soreness, 2);
  }
});
