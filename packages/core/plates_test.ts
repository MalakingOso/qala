import { assert, assertEquals } from "@std/assert";
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

Deno.test("245 lb on a 45 lb bar gives 45+45+10 per side", () => {
  const plan = planPlates(245, BAR, fullInventory());
  assert(plan.exact !== null, "expected exact load");
  assertEquals(plan.exact.perSide, [45, 45, 10]);
  assertEquals(plan.exact.total, 245);
  assertEquals(platesShorthand(plan.exact.perSide), "per side 45 · 45 · 10");
});

Deno.test("limited pairs: greedy-break case still solves exactly", () => {
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
  assertEquals(plan.exact.perSide, [45, 35, 10, 10]);
  assertEquals(plan.exact.total, 245);
});

Deno.test("unreachable target returns nearest below and above", () => {
  const plates: PlateEntry[] = [{ weight: 45, pairs: "enough", color: "blue" }];
  // t = (200-45)/2 = 77.5: below 45/side (total 135), above 90/side (total 225).
  const plan = planPlates(200, BAR, plates);
  assertEquals(plan.exact, null);
  assert(plan.below !== null && plan.above !== null);
  assertEquals(plan.below.total, 135);
  assertEquals(plan.below.perSide, [45]);
  assertEquals(plan.above.total, 225);
  assertEquals(plan.above.perSide, [45, 45]);
});

Deno.test("unreachable below the bar returns bar-only above", () => {
  const plan = planPlates(30, BAR, fullInventory());
  assertEquals(plan.exact, null);
  assertEquals(plan.below, null);
  assert(plan.above !== null);
  assertEquals(plan.above.perSide, []);
  assertEquals(plan.above.total, BAR);
});

Deno.test("warm-up ramp keep-inner sequence from PLAN 6.8", () => {
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
    assertEquals(choice.load.perSide, want, `per-side for ${total}`);
    assertEquals(choice.load.total, total);
    current = choice.load.perSide;
  }
});

Deno.test("between-set instructions read like PLAN 6.8 examples", () => {
  assertEquals(
    describeChange([45, 5], [45, 25]),
    "take off 5, add 25 each side",
  );
  assertEquals(
    describeChange([25, 2.5], [35, 5]),
    "take off 25 + 2.5, add 35 + 5 each side",
  );
  assertEquals(describeChange([45], [45, 25]), "add 25 each side");
  assertEquals(describeChange([45, 45, 10], [45, 45, 10]), "no change");
});

Deno.test("chooser keeps inner plates when alternatives tie", () => {
  // 185 -> 215: [45,25] -> [45,35,5] keeps the inner 45.
  const choice = chooseNextPlates([45, 25], 215, BAR, fullInventory());
  assert(choice !== null);
  assertEquals(choice.load.perSide, [45, 35, 5]);
  assertEquals(choice.keptInner, 1);
  assertEquals(choice.instruction, "take off 25, add 35 + 5 each side");
});
