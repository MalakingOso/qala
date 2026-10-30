import { assert, assertEquals } from "@std/assert";
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

Deno.test("names are tidied and ids never equal a built-in id", () => {
  assertEquals(cleanName("  Zercher   Hold "), "Zercher Hold");
  assertEquals(customId("Zercher Hold"), "qala-zercherhold");
  assertEquals(customId("Single-Leg Press"), "qala-singlelegpress");
});

Deno.test("a complete draft has no problems", () => {
  assertEquals(draftProblems(draft(), TAKEN), []);
});

Deno.test("a draft needs a usable name", () => {
  assertEquals(draftProblems(draft({ name: "  " }), TAKEN), [
    "Name the exercise.",
  ]);
  for (const name of ["Hold (Long)", "Squat, Barbell", "A/B", "3 Point Row"]) {
    const p = draftProblems(draft({ name }), TAKEN);
    assertEquals(p.length, 1, name);
    assert(p[0].startsWith("Start with a letter"), name);
  }
  assertEquals(draftProblems(draft({ name: "x".repeat(41) }), TAKEN), [
    "Keep the name to 40 characters.",
  ]);
  for (const name of ["Farmer's Hold", "Single-Leg Press", "Box Jump 24"]) {
    assertEquals(draftProblems(draft({ name }), TAKEN), [], name);
  }
});

Deno.test("a name already listed is refused, ignoring case and spacing", () => {
  assertEquals(draftProblems(draft({ name: "bench press" }), TAKEN), [
    "Bench Press is already in the list.",
  ]);
  assertEquals(draftProblems(draft({ name: "Bench-Press" }), TAKEN), [
    "Bench Press is already in the list.",
  ]);
});

Deno.test("a draft carries target and synergist tags, never the same muscle", () => {
  assertEquals(draftProblems(draft({ target: [], synergist: [] }), TAKEN), [
    "Tag at least one target muscle.",
    "Tag at least one synergist muscle.",
  ]);
  assertEquals(
    draftProblems(draft({ target: ["back"], synergist: ["back"] }), TAKEN),
    ["A muscle is either a target or a synergist, not both."],
  );
});

Deno.test("the overlay entry keeps Qala's tags; liftosaur gets its own names", () => {
  const c = toCustomExercise(
    draft({ name: " Zercher  Hold", equipment: "machine" }),
  );
  assertEquals(c, {
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
  assertEquals(toLiftoscript(c), {
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

Deno.test("merging adds customs by id and leaves the rest of the settings", () => {
  const base = { units: "lb", exercises: {} };
  assert(withCustomExercises(base, []) === base);
  const merged = withCustomExercises(base, [toCustomExercise(draft())]) as {
    units: string;
    exercises: Record<string, { name: string }>;
  };
  assertEquals(merged.units, "lb");
  assertEquals(Object.keys(merged.exercises), ["qala-zercherhold"]);
  assertEquals(merged.exercises["qala-zercherhold"].name, "Zercher Hold");
  assertEquals(base.exercises, {});
});

/* Against the real wasm (`deno task build:wasm` first): an unknown name stops
 * the dry run, and the same name resolves once the custom is merged in. */
const PROGRAM = `# Week 1
## Day 1: Lower A
Squat / 3x5 245lb / progress: lp(5lb)
Zercher Hold / 3x5 135lb
`;

Deno.test("the dry run resolves a custom exercise once it is merged in", async () => {
  const api = await loadLspp();
  const bridged = api.settingsFromCore(createBaselineDocument().settings);
  assert(bridged.ok);

  const plain = api.dryRun({ programText: PROGRAM, settings: bridged.value });
  assert(!plain.ok);
  assertEquals(plain.kind, "evaluation");
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
  assertEquals(day.errors, []);
  const hold = day.exercises.find((e) => e.name === "Zercher Hold");
  assertEquals(hold?.key, "qala-zercherhold_barbell");
  assertEquals(hold?.sets.map((s) => s.weight?.value), [135, 135, 135]);
});

Deno.test("the evaluator says which names are built in", async () => {
  const api = await loadLspp();
  assertEquals(isBuiltIn(api, "Hip Thrust"), true);
  assertEquals(isBuiltIn(api, "bench press"), true);
  assertEquals(isBuiltIn(api, "Zercher Hold"), false);
});
