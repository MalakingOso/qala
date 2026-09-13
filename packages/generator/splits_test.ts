// Split choice and main-lift frequency (PLAN.md 12).

import {
  advancedFrequencyAlternatives,
  availableExercises,
  checkFrequency,
  chooseSplit,
  frequencyBand,
  mainLiftFrequency,
  slotsForDay,
} from "./splits.ts";
import { EXERCISE_CATALOG } from "./types.ts";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

Deno.test("split by days: 2-3 full body, 4 upper/lower, 5-6 ppl", () => {
  assert(chooseSplit(2).name === "fullBody", "2d is full body");
  assert(chooseSplit(3).name === "fullBody", "3d is full body");
  assert(chooseSplit(4).name === "upperLower", "4d is upper/lower");
  assert(chooseSplit(5).name === "ppl", "5d is ppl");
  assert(chooseSplit(6).name === "ppl", "6d is ppl");
  assert(chooseSplit(4).days.length === 4, "4d has four days");
  assert(chooseSplit(6).days.length === 6, "6d has six days");
});

Deno.test("main-lift frequency meets the beginner band on every split", () => {
  const band = frequencyBand("beginner");
  assert(band.lo === 2 && band.hi === 3, "beginner band is 2-3x");
  for (const days of [2, 3, 4, 5, 6]) {
    const freq = mainLiftFrequency(chooseSplit(days));
    for (const lift of ["squat", "bench", "deadlift", "ohp"]) {
      assert(
        freq[lift] >= band.lo && freq[lift] <= band.hi,
        `${days}d ${lift} ${freq[lift]}x inside 2-3x`,
      );
    }
    assert(
      checkFrequency(chooseSplit(days), "beginner").length === 0,
      `${days}d clean for beginners`,
    );
  }
});

Deno.test("main-lift frequency meets the intermediate band on every split", () => {
  const band = frequencyBand("intermediate");
  assert(band.lo === 2 && band.hi === 4, "intermediate band is 2-4x");
  for (const days of [2, 3, 4, 5, 6]) {
    assert(
      checkFrequency(chooseSplit(days), "intermediate").length === 0,
      `${days}d clean`,
    );
  }
});

Deno.test("advanced alternatives: high 3-5x lower volume, low 1-2x higher volume", () => {
  const alts = advancedFrequencyAlternatives();
  const high = alts.find((a) => a.scheme === "high")!;
  const low = alts.find((a) => a.scheme === "low")!;
  assert(high.frequency.includes("3-5x"), "high alternative is 3-5x");
  assert(
    high.perSessionVolume.includes("lower"),
    "high alternative lowers per-session volume",
  );
  assert(low.frequency.includes("1-2x"), "low alternative is 1-2x");
  assert(
    low.perSessionVolume.includes("higher"),
    "low alternative raises per-session volume",
  );
  assert(frequencyBand("advanced", "high").lo === 3, "high band lo 3");
  assert(frequencyBand("advanced", "low").hi === 2, "low band hi 2");
  assert(
    frequencyBand("advanced", "default").hi === 4,
    "advanced default matches intermediate",
  );
});

Deno.test("checkFrequency names the offending lift", () => {
  const problems = checkFrequency(chooseSplit(4), "beginner");
  assert(problems.length === 0, "4d upper/lower is fine for beginners");
  const thin = {
    name: "fullBody" as const,
    label: "thin",
    days: [{
      label: "Only",
      focus: "full body",
      lowerBody: true,
      movementSlots: ["squat"],
      muscleSlots: [] as string[],
    }],
  };
  const bad = checkFrequency(thin, "beginner");
  assert(bad.length > 0, "single-lift day is flagged");
  assert(bad.some((p) => p.includes("bench")), "missing bench is named");
});

Deno.test("slots honour equipment and exclusions", () => {
  const noBarbell = availableExercises([
    "dumbbell",
    "bench",
    "cable",
    "machine",
    "pullupBar",
  ], []);
  assert(
    !noBarbell.some((e) => e.equipment.includes("barbell")),
    "no barbell lifts without a bar",
  );
  assert(noBarbell.some((e) => e.id === "pullup"), "pull-up still available");
  const noCurl = availableExercises([], ["curl"]);
  assert(!noCurl.some((e) => e.id === "curl"), "excluded lifts are skipped");
  assert(
    availableExercises([], []).length === EXERCISE_CATALOG.length,
    "empty equipment means full gym",
  );
  const day = chooseSplit(4).days[0];
  const slots = slotsForDay(day, "strength", noBarbell);
  assert(
    slots.every((s) => noBarbell.some((e) => e.id === s.exerciseId)),
    "slots use available lifts only",
  );
});
