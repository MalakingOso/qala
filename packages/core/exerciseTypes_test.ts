import { assert, assertEquals } from "@std/assert";
import {
  bodyweightFactor,
  intensityZone,
  isValidCustomExercise,
  MUSCLE_GROUPS,
  muscleLandmarks,
  RP_LANDMARKS,
  SYNERGIST_SET_WEIGHT,
  VOLUME_BAND,
} from "./exerciseTypes.ts";

Deno.test("RP landmarks match the PLAN 6.3 table", () => {
  assertEquals(MUSCLE_GROUPS.length, 9);
  assertEquals(RP_LANDMARKS.chest, {
    mv: [2, 4],
    mev: [4, 6],
    mav: [6, 16],
    mrv: [16, 24],
  });
  assertEquals(RP_LANDMARKS.back.mev, [12, 14]);
  assertEquals(RP_LANDMARKS.hamstrings.mrv, [8, 14]);
  assertEquals(SYNERGIST_SET_WEIGHT, 0.5);
  assertEquals(VOLUME_BAND.grow, [10, 20]);
  // Muscles without a row use chest's numbers.
  assertEquals(muscleLandmarks("neck"), RP_LANDMARKS.chest);
  assertEquals(muscleLandmarks("quads"), RP_LANDMARKS.quads);
});

Deno.test("custom exercises must carry muscle tags", () => {
  assert(isValidCustomExercise({
    id: "x1",
    name: "Zercher",
    targetMuscles: ["quads"],
    synergistMuscles: ["glutes"],
    bodyParts: ["legs"],
    equipment: "barbell",
  }));
  assert(
    !isValidCustomExercise({
      id: "x2",
      name: "Untagged",
      targetMuscles: [],
      synergistMuscles: [],
      bodyParts: ["legs"],
      equipment: "barbell",
    }),
  );
});

Deno.test("metrics helpers: bodyweight factors and intensity zones", () => {
  assertEquals(bodyweightFactor("pullup"), 1.0);
  assertEquals(bodyweightFactor("push-up"), 0.65);
  assertEquals(bodyweightFactor("squat"), undefined);
  assertEquals(intensityZone(0.92), "90+");
  assertEquals(intensityZone(0.87), "85-89.9");
  assertEquals(intensityZone(0.5), "<70");
});
