import { assert, assertEquals } from "@std/assert";
import { defaultLbInventory } from "./plates.ts";
import {
  barbellStepDefault,
  isLoadable,
  roundToStep,
  roundWeight,
} from "./rounding.ts";

const BAR = 45;

Deno.test("barbellStep defaults to twice the smallest pair", () => {
  assertEquals(barbellStepDefault(defaultLbInventory().plates), 5);
  assertEquals(
    barbellStepDefault([
      { weight: 25, pairs: 1, color: "red" },
      { weight: 1, pairs: 2, color: "green" },
    ]),
    2,
  );
  assertEquals(barbellStepDefault([]), 5);
});

Deno.test("roundWeight snaps to the nearest loadable weight", () => {
  const plates = defaultLbInventory().plates;
  assertEquals(roundWeight(245, BAR, plates), 245);
  // Default inventory steps in 2.5s: 243 -> t=99/side, nearer above (100/side).
  assertEquals(roundWeight(243, BAR, plates), 245);
  // 242 -> t=98.5/side, nearer below (97.5/side = 45+35+10+5+2.5).
  assertEquals(roundWeight(242, BAR, plates), 240);
});

Deno.test("roundWeight never prescribes an unloadable weight", () => {
  const plates = defaultLbInventory().plates;
  for (let w = 45; w <= 315; w += 1.25) {
    const rounded = roundWeight(w, BAR, plates);
    assert(
      isLoadable(rounded, BAR, plates),
      `${w} rounded to unloadable ${rounded}`,
    );
  }
});

Deno.test("roundWeight is loadable with limited inventory too", () => {
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

Deno.test("roundToStep rounds halves up", () => {
  assertEquals(roundToStep(142.5, 5), 145);
  assertEquals(roundToStep(141, 5), 140);
});
