import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  chooseNextPlates,
  defaultLbInventory,
  describeChange,
  planPlates,
  platesShorthand,
} from "./plates.ts";
import type { PlateEntry } from "./plates.ts";

const BAR = 45;

function fullInventory(): PlateEntry[] {
  return defaultLbInventory().plates;
}

test("245 lb on a 45 lb bar gives 45+45+10 per side", () => {
  const plan = planPlates(245, BAR, fullInventory());
  assert(plan.exact !== null, "expected exact load");
  assert.deepStrictEqual(plan.exact.perSide, [45, 45, 10]);
  assert.deepStrictEqual(plan.exact.total, 245);
  assert.deepStrictEqual(platesShorthand(plan.exact.perSide), "per side 45 · 45 · 10");
});

test("limited pairs: greedy-break case still solves exactly", () => {
  // Only one pair of 45s: greedy (45,45,...) fails, knapsack must find 45+35+10+10.
  const plates: PlateEntry[] = [
    { weight: 45, pairs: 1, color: "blue" },
    { weight: 35, pairs: "enough", color: "yellow" },
    { weight: 25, pairs: "enough", color: "green" },
    { weight: 10, pairs: "enough", color: "white" },
    { weight: 5, pairs: "enough", color: "charcoal" },
    { weight: 2.5, pairs: "enough", color: "silver" },
    { weight: 1.25, pairs: "enough", color: "silver" },
  ];
  const plan = planPlates(245, BAR, plates);
  assert(plan.exact !== null, "expected exact load despite limited 45s");
  assert.deepStrictEqual(plan.exact.perSide, [45, 35, 10, 10]);
  assert.deepStrictEqual(plan.exact.total, 245);
});

test("unreachable target returns nearest below and above", () => {
  const plates: PlateEntry[] = [{ weight: 45, pairs: "enough", color: "blue" }];
  // t = (200-45)/2 = 77.5: below 45/side (total 135), above 90/side (total 225).
  const plan = planPlates(200, BAR, plates);
  assert.deepStrictEqual(plan.exact, null);
  assert(plan.below !== null && plan.above !== null);
  assert.deepStrictEqual(plan.below.total, 135);
  assert.deepStrictEqual(plan.below.perSide, [45]);
  assert.deepStrictEqual(plan.above.total, 225);
  assert.deepStrictEqual(plan.above.perSide, [45, 45]);
});

test("unreachable below the bar returns bar-only above", () => {
  const plan = planPlates(30, BAR, fullInventory());
  assert.deepStrictEqual(plan.exact, null);
  assert.deepStrictEqual(plan.below, null);
  assert(plan.above !== null);
  assert.deepStrictEqual(plan.above.perSide, []);
  assert.deepStrictEqual(plan.above.total, BAR);
});

test("warm-up ramp keep-inner sequence from PLAN 6.8", () => {
  const plates = fullInventory();
  const expected: Array<[number, number[]]> = [
    [100, [25, 2.5]],
    [125, [35, 5]],
    [145, [45, 5]],
    [185, [45, 25]],
    [215, [45, 35, 5]],
    [245, [45, 45, 10]],
  ];
  let current: number[] = [];
  for (const [total, want] of expected) {
    const choice = chooseNextPlates(current, total, BAR, plates);
    assert(choice !== null, `no choice for ${total}`);
    assert.deepStrictEqual(choice.load.perSide, want, `per-side for ${total}`);
    assert.deepStrictEqual(choice.load.total, total);
    current = choice.load.perSide;
  }
});

test("between-set instructions read like PLAN 6.8 examples", () => {
  assert.deepStrictEqual(
    describeChange([45, 5], [45, 25]),
    "take off 5, add 25 each side",
  );
  assert.deepStrictEqual(
    describeChange([25, 2.5], [35, 5]),
    "take off 25 + 2.5, add 35 + 5 each side",
  );
  assert.deepStrictEqual(describeChange([45], [45, 25]), "add 25 each side");
  assert.deepStrictEqual(describeChange([45, 45, 10], [45, 45, 10]), "no change");
});

test("chooser keeps inner plates when alternatives tie", () => {
  // 185 -> 215: [45,25] -> [45,35,5] keeps the inner 45.
  const choice = chooseNextPlates([45, 25], 215, BAR, fullInventory());
  assert(choice !== null);
  assert.deepStrictEqual(choice.load.perSide, [45, 35, 5]);
  assert.deepStrictEqual(choice.keptInner, 1);
  assert.deepStrictEqual(choice.instruction, "take off 25, add 35 + 5 each side");
});
