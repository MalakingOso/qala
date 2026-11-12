import { test } from "bun:test";
import assert from "node:assert/strict";
import { defaultLbInventory } from "./plates.ts";
import {
  barbellStepDefault,
  isLoadable,
  roundToStep,
  roundWeight,
} from "./rounding.ts";

const BAR = 45;

test("barbellStep defaults to twice the smallest pair", () => {
  assert.deepStrictEqual(barbellStepDefault(defaultLbInventory().plates), 5);
  assert.deepStrictEqual(
    barbellStepDefault([
      { weight: 25, pairs: 1, color: "red" },
      { weight: 1, pairs: 2, color: "green" },
    ]),
    2,
  );
  assert.deepStrictEqual(barbellStepDefault([]), 5);
});

test("roundWeight snaps to the nearest loadable weight", () => {
  const plates = defaultLbInventory().plates;
  assert.deepStrictEqual(roundWeight(245, BAR, plates), 245);
  // Default inventory steps in 2.5s: 243 -> t=99/side, nearer above (100/side).
  assert.deepStrictEqual(roundWeight(243, BAR, plates), 245);
  // 242 -> t=98.5/side, nearer below (97.5/side = 45+35+10+5+2.5).
  assert.deepStrictEqual(roundWeight(242, BAR, plates), 240);
});

test("roundWeight never prescribes an unloadable weight", () => {
  const plates = defaultLbInventory().plates;
  for (let w = 45; w <= 315; w += 1.25) {
    const rounded = roundWeight(w, BAR, plates);
    assert(
      isLoadable(rounded, BAR, plates),
      `${w} rounded to unloadable ${rounded}`,
    );
  }
});

test("roundWeight is loadable with limited inventory too", () => {
  const plates = defaultLbInventory().plates.map((p) =>
    p.weight === 45 ? { ...p, pairs: 1 as const } : p
  );
  for (let w = 45; w <= 315; w += 2.5) {
    const rounded = roundWeight(w, BAR, plates);
    assert(
      isLoadable(rounded, BAR, plates),
      `${w} rounded to unloadable ${rounded}`,
    );
  }
});

test("roundToStep rounds halves up", () => {
  assert.deepStrictEqual(roundToStep(142.5, 5), 145);
  assert.deepStrictEqual(roundToStep(141, 5), 140);
});
