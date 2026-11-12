import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  cleanName,
  type CustomDraft,
  customId,
  draftProblems,
  isBuiltIn,
  toCustomExercise,
  toLiftoscript,
  withCustomExercises,
} from "./customExercises.ts";
import { createBaselineDocument } from "../../../../packages/core/migrations.ts";
import { loadLspp } from "../../../../server/lspp.ts";

const draft = (over: Partial<CustomDraft> = {}): CustomDraft => ({
  name: "Zercher Hold",
  equipment: "barbell",
  target: ["back"],
  synergist: ["glutes", "quads"],
  restClass: "secondary",
  ...over,
});

const TAKEN = ["Back Squat", "Bench Press"];

test("names are tidied and ids never equal a built-in id", () => {
  assert.deepStrictEqual(cleanName("  Zercher   Hold "), "Zercher Hold");
  assert.deepStrictEqual(customId("Zercher Hold"), "qala-zercherhold");
  assert.deepStrictEqual(customId("Single-Leg Press"), "qala-singlelegpress");
});

test("a complete draft has no problems", () => {
  assert.deepStrictEqual(draftProblems(draft(), TAKEN), []);
});

test("a draft needs a usable name", () => {
  assert.deepStrictEqual(draftProblems(draft({ name: "  " }), TAKEN), [
    "Name the exercise.",
  ]);
  for (const name of ["Hold (Long)", "Squat, Barbell", "A/B", "3 Point Row"]) {
    const p = draftProblems(draft({ name }), TAKEN);
    assert.deepStrictEqual(p.length, 1, name);
    assert(p[0].startsWith("Start with a letter"), name);
  }
  assert.deepStrictEqual(draftProblems(draft({ name: "x".repeat(41) }), TAKEN), [
    "Keep the name to 40 characters.",
  ]);
  for (const name of ["Farmer's Hold", "Single-Leg Press", "Box Jump 24"]) {
    assert.deepStrictEqual(draftProblems(draft({ name }), TAKEN), [], name);
  }
});

test("a name already listed is refused, ignoring case and spacing", () => {
  assert.deepStrictEqual(draftProblems(draft({ name: "bench press" }), TAKEN), [
    "Bench Press is already in the list.",
  ]);
  assert.deepStrictEqual(draftProblems(draft({ name: "Bench-Press" }), TAKEN), [
    "Bench Press is already in the list.",
  ]);
});

test("a draft carries target and synergist tags, never the same muscle", () => {
  assert.deepStrictEqual(draftProblems(draft({ target: [], synergist: [] }), TAKEN), [
    "Tag at least one target muscle.",
    "Tag at least one synergist muscle.",
  ]);
  assert.deepStrictEqual(
    draftProblems(draft({ target: ["back"], synergist: ["back"] }), TAKEN),
    ["A muscle is either a target or a synergist, not both."],
  );
});

test("the overlay entry keeps Qala's tags; liftosaur gets its own names", () => {
  const c = toCustomExercise(
    draft({ name: " Zercher  Hold", equipment: "machine" }),
  );
  assert.deepStrictEqual(c, {
    exercise: {
      id: "qala-zercherhold",
      name: "Zercher Hold",
      targetMuscles: ["back"],
      synergistMuscles: ["glutes", "quads"],
      bodyParts: ["back"],
      equipment: "machine",
    },
    restClass: "secondary",
  });
  assert.deepStrictEqual(toLiftoscript(c), {
    vtype: "custom_exercise",
    id: "qala-zercherhold",
    name: "Zercher Hold",
    isDeleted: false,
    meta: {
      bodyParts: ["Back"],
      targetMuscles: ["Latissimus Dorsi"],
      synergistMuscles: ["Gluteus Maximus", "Quadriceps"],
      sortedEquipment: ["leverageMachine"],
    },
    defaultEquipment: "leverageMachine",
  });
});

test("merging adds customs by id and leaves the rest of the settings", () => {
  const base = { units: "lb", exercises: {} };
  assert(withCustomExercises(base, []) === base);
  const merged = withCustomExercises(base, [toCustomExercise(draft())]) as {
    units: string;
    exercises: Record<string, { name: string }>;
  };
  assert.deepStrictEqual(merged.units, "lb");
  assert.deepStrictEqual(Object.keys(merged.exercises), ["qala-zercherhold"]);
  assert.deepStrictEqual(merged.exercises["qala-zercherhold"].name, "Zercher Hold");
  assert.deepStrictEqual(base.exercises, {});
});

/* Against the real wasm (`bun run build:wasm` first): an unknown name stops
 * the dry run, and the same name resolves once the custom is merged in. */
const PROGRAM = `# Week 1
## Day 1: Lower A
Squat / 3x5 245lb / progress: lp(5lb)
Zercher Hold / 3x5 135lb
`;

test("the dry run resolves a custom exercise once it is merged in", async () => {
  const api = await loadLspp();
  const bridged = api.settingsFromCore(createBaselineDocument().settings);
  assert(bridged.ok);

  const plain = api.dryRun({ programText: PROGRAM, settings: bridged.value });
  assert(!plain.ok);
  assert.deepStrictEqual(plain.kind, "evaluation");
  assert(
    plain.message.includes("Unknown exercise Zercher Hold"),
    plain.message,
  );

  const custom = [toCustomExercise(draft())];
  const run = api.dryRun({
    programText: PROGRAM,
    settings: withCustomExercises(bridged.value, custom),
  });
  assert(run.ok, run.ok ? "" : run.message);
  const [day] = run.value.sessions;
  assert.deepStrictEqual(day.errors, []);
  const hold = day.exercises.find((e) => e.name === "Zercher Hold");
  assert.deepStrictEqual(hold?.key, "qala-zercherhold_barbell");
  assert.deepStrictEqual(hold?.sets.map((s) => s.weight?.value), [135, 135, 135]);
});

test("the evaluator says which names are built in", async () => {
  const api = await loadLspp();
  assert.deepStrictEqual(isBuiltIn(api, "Hip Thrust"), true);
  assert.deepStrictEqual(isBuiltIn(api, "bench press"), true);
  assert.deepStrictEqual(isBuiltIn(api, "Zercher Hold"), false);
});
