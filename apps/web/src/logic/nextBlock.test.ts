import { test } from "bun:test";
import assert from "node:assert/strict";
import { sampleBlock, sampleLifts } from "../store/sample.ts";
import {
  generateNextBlock,
  NEXT_BLOCK_PLAN,
  nextBlockInput,
} from "./nextBlock.ts";
import {
  emitProgram,
  generateBlock,
  type GeneratorInput,
  LSPP_EXERCISES,
  lsppExercise,
} from "../../../../packages/generator/mod.ts";
import { createBaselineDocument } from "../../../../packages/core/migrations.ts";
import type { Lspp } from "../../../../packages/lspp/mod.ts";
import { loadLspp } from "../../../../server/lspp.ts";

test("the input comes from the block and the lift estimates", () => {
  const input = nextBlockInput({ of: 6 }, [
    { id: "squat", kalman: 282.6 },
    { id: "press", kalman: 154 },
  ]);
  assert.deepStrictEqual(input.blockWeeks, 6);
  assert.deepStrictEqual(input.referenceRm, { squat: 283, ohp: 154 });
  assert.deepStrictEqual(input.goal, "strength");
  assert.deepStrictEqual(input.daysPerWeek, 4);
  assert.deepStrictEqual(input.equipment, [], "empty is a full gym to the generator");
});

test("the fixed plan agrees with the block the page shows", () => {
  assert(
    sampleBlock.profile.startsWith(`${NEXT_BLOCK_PLAN.daysPerWeek}-day`),
    `profile "${sampleBlock.profile}"`,
  );
  assert(/strength/i.test(sampleBlock.name), `name "${sampleBlock.name}"`);
  const input = nextBlockInput(sampleBlock, sampleLifts);
  assert.deepStrictEqual(Object.keys(input.referenceRm).sort(), [
    "bench",
    "deadlift",
    "ohp",
    "squat",
  ]);
  assert.deepStrictEqual(input.referenceRm["ohp"], 154, "Press's Kalman e1RM");
});

test("the sample block generates program text, the same every time", () => {
  const input = nextBlockInput(sampleBlock, sampleLifts);
  const a = generateNextBlock(input);
  const b = generateNextBlock(input);
  assert(a.ok && b.ok);
  assert.deepStrictEqual(a.text, b.text);
  assert.deepStrictEqual(a.name, "Strength block (DUP)");
  assert(a.text.startsWith("/// Strength block (DUP)\n"), a.text.slice(0, 40));
  assert(a.text.includes("referenceRm: bench=243"), "bench reference");
});

test("an input the generator refuses comes back as a sentence", () => {
  const input = nextBlockInput({ of: 9 }, sampleLifts);
  const out = generateNextBlock(input);
  assert(!out.ok);
  assert.deepStrictEqual(
    out.message,
    "The generator stopped: blockWeeks must be 2-7 (docs/PLAN.md 12 block length)",
  );
});

/* Against the real wasm (`bun run build:wasm` first): the checks the
 * editor runs on the buffer (diagnose and lint), Format, and the dry run with
 * the baseline settings, as the Dry run card calls it. */

function baseline(api: Lspp): unknown {
  const settings = api.settingsFromCore(createBaselineDocument().settings);
  assert(settings.ok, settings.ok ? "" : settings.message);
  return settings.value;
}

/** The editor's checks: no syntax errors, no lint warnings, nothing the
 * evaluator refuses. */
function assertClean(api: Lspp, text: string, label: string): void {
  const errors = api.diagnose(text);
  assert(errors.ok, label);
  assert.deepStrictEqual(errors.value, [], `${label}: syntax errors`);
  const warnings = api.lint(text);
  assert(warnings.ok, label);
  assert.deepStrictEqual(warnings.value, [], `${label}: lint warnings`);
  const evaluated = api.evaluateText({
    programText: text,
    name: label,
    settings: baseline(api),
  });
  assert(evaluated.ok, label);
  assert.deepStrictEqual(
    evaluated.value.errors.map((e) => e.error.message),
    [],
    `${label}: evaluation errors`,
  );
}

test("the sample block's draft opens in the editor with no errors", async () => {
  const api = await loadLspp();
  const out = generateNextBlock(nextBlockInput(sampleBlock, sampleLifts));
  assert(out.ok);
  assertClean(api, out.text, "sample block");
  const formatted = api.format(out.text);
  assert(formatted.ok && formatted.value.ok);
  assert.deepStrictEqual(formatted.value.changed, false, "already in Format's form");
});

test("the sample block's dry run keeps every stated weight", async () => {
  const api = await loadLspp();
  const input = nextBlockInput(sampleBlock, sampleLifts);
  const block = generateBlock(input);
  const run = api.dryRun({
    programText: emitProgram(block, input),
    name: sampleBlock.name,
    settings: baseline(api),
  });
  assert(run.ok, run.ok ? "" : run.message);
  const sessions = run.value.sessions;
  assert.deepStrictEqual(sessions.length, 6 * 4, "six weeks of four days");
  for (const s of sessions) assert.deepStrictEqual(s.errors, [], s.name);

  let stated = 0;
  block.weeks.forEach((week, w) =>
    week.days.forEach((day, d) => {
      const session = sessions.find((s) =>
        s.week === w + 1 && s.dayInWeek === d + 1
      );
      assert(session, `week ${w + 1} day ${d + 1}`);
      for (const ex of day.exercises) {
        const name = lsppExercise(ex.exerciseId).name;
        const got: (typeof sessions)[number]["exercises"][number] | undefined =
          session.exercises.find((e) => e.name === name);
        assert(got, `${name} in week ${w + 1} day ${d + 1}`);
        assert.deepStrictEqual(got.sets.length, ex.sets, name);
        for (const set of got.sets) {
          if (ex.load === undefined) {
            assert(set.blank, `${name} asks for its weight`);
            assert.deepStrictEqual(set.weight, null, name);
          } else {
            stated++;
            assert.deepStrictEqual(set.weight, { value: ex.load, unit: "lb" }, name);
            assert.deepStrictEqual(set.rpe, ex.rpe, name);
          }
        }
      }
    })
  );
  assert(stated > 0, "some sets carry a weight");
  assert(run.value.blankSets > 0, "the accessories wait for a weight");

  // The case that went wrong: bare Romanian Deadlift is a dumbbell lift and
  // dry-ran the barbell weight as 40 lb.
  const lowerA = sessions[1];
  const rdl = lowerA.exercises.find((e) =>
    e.name === "Romanian Deadlift, Barbell"
  );
  assert.deepStrictEqual(rdl?.key, "romaniandeadlift_barbell");
  assert.deepStrictEqual(rdl?.sets[0].weight, { value: 125, unit: "lb" });
  const pause = lowerA.exercises.find((e) => e.name === "pause: Squat");
  assert.deepStrictEqual(pause?.sets[0].weight, { value: 170, unit: "lb" });
});

test("every goal and split generates text the editor accepts", async () => {
  const api = await loadLspp();
  for (
    const goal of [
      "hypertrophy",
      "strength",
      "meetPrep",
      "athleticMaintenance",
    ] as const
  ) {
    for (const daysPerWeek of [2, 3, 4, 5, 6]) {
      const input: GeneratorInput = {
        goal,
        daysPerWeek,
        sessionMinutes: 90,
        experience: "intermediate",
        equipment: [],
        priorities: {},
        exclusions: [],
        blockWeeks: 5,
        referenceRm: { squat: 265, bench: 200, deadlift: 315, ohp: 125 },
        meetDate: goal === "meetPrep" ? "2026-10-10" : undefined,
      };
      assertClean(
        api,
        emitProgram(generateBlock(input), input),
        `${goal} ${daysPerWeek}d`,
      );
    }
  }
});

/** The lifts the generator writes a weight for: the main lifts and their
 * variations, all barbell work. */
const WEIGHTED = [
  "squat",
  "bench",
  "deadlift",
  "ohp",
  "pauseSquat",
  "closeGripBench",
  "rdl",
];

test("every LS++ name is in the catalog, barbell where it has a weight", async () => {
  const api = await loadLspp();
  const settings = baseline(api);
  for (const [id, { name }] of Object.entries(LSPP_EXERCISES)) {
    const run = api.dryRun({
      programText: `# Week 1\n## Day 1: Check\n${name} / 1x5 185lb\n`,
      settings,
    });
    assert(run.ok, `${id}: ${run.ok ? "" : run.message}`);
    const [ex] = run.value.sessions[0].exercises;
    if (WEIGHTED.includes(id)) {
      assert(ex.key.endsWith("_barbell"), `${id} is ${ex.key}`);
      assert.deepStrictEqual(ex.sets[0].weight, { value: 185, unit: "lb" }, id);
    }
  }
});
