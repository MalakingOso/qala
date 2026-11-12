import { test } from "bun:test";
import assert from "node:assert/strict";
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

test("RP landmarks match the PLAN 6.3 table", () => {
  assert.deepStrictEqual(MUSCLE_GROUPS.length, 9);
  assert.deepStrictEqual(RP_LANDMARKS.chest, {
    mv: [2, 4],
    mev: [4, 6],
    mav: [6, 16],
    mrv: [16, 24],
  });
  assert.deepStrictEqual(RP_LANDMARKS.back.mev, [12, 14]);
  assert.deepStrictEqual(RP_LANDMARKS.hamstrings.mrv, [8, 14]);
  assert.deepStrictEqual(SYNERGIST_SET_WEIGHT, 0.5);
  assert.deepStrictEqual(VOLUME_BAND.grow, [10, 20]);
  // Muscles without a row use chest's numbers.
  assert.deepStrictEqual(muscleLandmarks("neck"), RP_LANDMARKS.chest);
  assert.deepStrictEqual(muscleLandmarks("quads"), RP_LANDMARKS.quads);
});

test("custom exercises must carry muscle tags", () => {
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

test("metrics helpers: bodyweight factors and intensity zones", () => {
  assert.deepStrictEqual(bodyweightFactor("pullup"), 1.0);
  assert.deepStrictEqual(bodyweightFactor("push-up"), 0.65);
  assert.deepStrictEqual(bodyweightFactor("squat"), undefined);
  assert.deepStrictEqual(intensityZone(0.92), "90+");
  assert.deepStrictEqual(intensityZone(0.87), "85-89.9");
  assert.deepStrictEqual(intensityZone(0.5), "<70");
});
