// Golden-file oracle for the Rust port of packages/core plates and rounding
// (crates/qala-core, docs/rust-core.md R2).
//
//   deno task golden:plates     # same as: deno run -A scripts/golden_plates.ts
//
// Runs the real TS plate math and writes testdata/golden/plates/plates.json.
// Every case in packages/core/plates_test.ts and the deterministic cases in
// packages/core/rounding_test.ts appear here; the two loadability loops in
// rounding_test.ts are properties, not vectors, and the Rust test checks the
// same property directly. Output is deterministic: fixed case order, no
// randomness, no clock.

import {
  chooseNextPlates,
  defaultLbInventory,
  describeChange,
  planPlates,
  platesShorthand,
  type PlateEntry,
} from "../packages/core/plates.ts";
import { nearestLoadable } from "../packages/core/plates.ts";
import { barbellStepDefault, roundWeight } from "../packages/core/rounding.ts";

const OUT = new URL(
  "../testdata/golden/plates/plates.json",
  import.meta.url,
).pathname;

interface Case {
  name: string;
  input: Record<string, unknown>;
  expected: unknown;
}

const cases: Case[] = [];

function planCase(
  name: string,
  requestedTotal: number,
  barWeight: number,
  plates: PlateEntry[],
  collarWeight = 0,
) {
  const plan = planPlates(requestedTotal, barWeight, plates, collarWeight);
  cases.push({
    name: `plan_plates: ${name}`,
    input: {
      call: "plan_plates",
      requestedTotal,
      barWeight,
      collarWeight,
      plates,
    },
    expected: plan,
  });
  cases.push({
    name: `nearest_loadable: ${name}`,
    input: {
      call: "nearest_loadable",
      requestedTotal,
      barWeight,
      collarWeight,
      plates,
    },
    expected: nearestLoadable(plan),
  });
  cases.push({
    name: `round_weight: ${name}`,
    input: {
      call: "round_weight",
      targetWeight: requestedTotal,
      barWeight,
      collarWeight,
      plates,
    },
    expected: roundWeight(requestedTotal, barWeight, plates, collarWeight),
  });
}

const BAR = 45;
const full = defaultLbInventory().plates;

// plates_test.ts: "245 lb on a 45 lb bar gives 45+45+10 per side".
planCase("245 lb on a 45 lb bar", 245, BAR, full);
cases.push({
  name: "shorthand: 245 per side",
  input: { call: "shorthand", perSide: [45, 45, 10] },
  expected: platesShorthand([45, 45, 10]),
});
cases.push({
  name: "shorthand: bar only",
  input: { call: "shorthand", perSide: [] },
  expected: platesShorthand([]),
});

// plates_test.ts: "limited pairs: greedy-break case still solves exactly".
const limited: PlateEntry[] = [
  { weight: 45, pairs: 1, color: "blue" },
  { weight: 35, pairs: "enough", color: "yellow" },
  { weight: 25, pairs: "enough", color: "green" },
  { weight: 10, pairs: "enough", color: "white" },
  { weight: 5, pairs: "enough", color: "charcoal" },
  { weight: 2.5, pairs: "enough", color: "silver" },
  { weight: 1.25, pairs: "enough", color: "silver" },
];
planCase("one pair of 45s, 245 lb", 245, BAR, limited);

// plates_test.ts: "unreachable target returns nearest below and above".
planCase("unreachable 200 lb, 45s only", 200, BAR, [
  { weight: 45, pairs: "enough", color: "blue" },
]);

// plates_test.ts: "unreachable below the bar returns bar-only above".
planCase("30 lb below the bar", 30, BAR, full);

// rounding_test.ts: "roundWeight snaps to the nearest loadable weight".
planCase("243 lb snaps up", 243, BAR, full);
planCase("242 lb snaps down", 242, BAR, full);

// Collars move every total; no TS test covers them, so pin one case here.
planCase("245 lb with 2.5 lb collars", 245, BAR, full, 2.5);

// plates_test.ts: "warm-up ramp keep-inner sequence from PLAN 6.8".
{
  let current: number[] = [];
  for (const total of [100, 125, 145, 185, 215, 245]) {
    const choice = chooseNextPlates(current, total, BAR, full);
    if (!choice) throw new Error(`oracle gave no choice for ${total}`);
    cases.push({
      name: `choose_next: ramp to ${total}`,
      input: {
        call: "choose_next",
        currentPerSide: current,
        nextTotal: total,
        barWeight: BAR,
        collarWeight: 0,
        plates: full,
      },
      expected: {
        perSide: choice.load.perSide,
        total: choice.load.total,
        instruction: choice.instruction,
        keptInner: choice.keptInner,
        platesMoved: choice.platesMoved,
      },
    });
    current = choice.load.perSide;
  }
}

// plates_test.ts: "between-set instructions read like PLAN 6.8 examples".
for (const [cur, next] of [
  [[45, 5], [45, 25]],
  [[25, 2.5], [35, 5]],
  [[45], [45, 25]],
  [[45, 45, 10], [45, 45, 10]],
] as const) {
  cases.push({
    name: `describe_change: ${cur} to ${next}`,
    input: {
      call: "describe_change",
      currentPerSide: [...cur],
      nextPerSide: [...next],
    },
    expected: describeChange([...cur], [...next]),
  });
}

// plates_test.ts: "chooser keeps inner plates when alternatives tie".
{
  const choice = chooseNextPlates([45, 25], 215, BAR, full);
  if (!choice) throw new Error("oracle gave no choice for 215");
  cases.push({
    name: "choose_next: 185 to 215 keeps the 45",
    input: {
      call: "choose_next",
      currentPerSide: [45, 25],
      nextTotal: 215,
      barWeight: BAR,
      collarWeight: 0,
      plates: full,
    },
    expected: {
      perSide: choice.load.perSide,
      total: choice.load.total,
      instruction: choice.instruction,
      keptInner: choice.keptInner,
      platesMoved: choice.platesMoved,
    },
  });
}

// rounding_test.ts: "barbellStep defaults to twice the smallest pair".
for (const [name, plates, fallback] of [
  ["default inventory", full, undefined],
  ["25s and 1s", [
    { weight: 25, pairs: 1, color: "red" },
    { weight: 1, pairs: 2, color: "green" },
  ], undefined],
  ["empty inventory", [], undefined],
] as const) {
  cases.push({
    name: `barbell_step: ${name}`,
    input: { call: "barbell_step", plates, fallback: fallback ?? null },
    expected: barbellStepDefault(plates as PlateEntry[]),
  });
}

const doc = { fn: "plates", version: 1, oracle: "ts", cases };
await Deno.writeTextFile(OUT, JSON.stringify(doc, null, 1) + "\n");
console.log(`wrote ${cases.length} cases to ${OUT}`);
