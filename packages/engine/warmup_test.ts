// PLAN 6.7 tests: worked examples, extra step, run cover, cut order.
import {
  intensityOf,
  planRunWarmup,
  planWarmup,
  rampSets,
  tierFor,
} from "./warmup.ts";
import { assert, assertEqual } from "./testutil.ts";

function loads(
  steps: { load: number | "bar"; reps: number }[],
): (number | string)[] {
  return steps.map((s) => s.load);
}

Deno.test("strength squat 225x5 at 1RM 265 -> 100x6, 145x4, 190x2", () => {
  assert(intensityOf({ w: 225, reference: 265 }) > 0.84, "I tier edge");
  assert(tierFor(225 / 265, false) === "T2", "T2");
  const steps = rampSets({ w: 225, intensity: 225 / 265 });
  assertEqual(loads(steps), [100, 145, 190], "loads");
  assertEqual(steps.map((s) => s.reps), [6, 4, 2], "reps");
  assertEqual(steps.map((s) => s.restSec), [45, 60, 90], "rests");
});

Deno.test("bench 240 at 1RM 250 -> 95/130/170/195/220", () => {
  const steps = rampSets({ w: 240, intensity: 240 / 250 });
  assertEqual(loads(steps), [95, 130, 170, 195, 220], "bench ramp");
});

Deno.test("OHP 95x8 at e1RM 125 -> barx8, 60x4, 80x2", () => {
  const steps = rampSets({ w: 95, intensity: 95 / 125 });
  assertEqual(loads(steps), ["bar", 60, 80], "ohp ramp");
  assert(steps[0].reps === 8, "bar x 8");
});

Deno.test("soreness 4 inserts the extra step", () => {
  const steps = rampSets({ w: 225, intensity: 225 / 265, extraStep: true });
  assertEqual(loads(steps), [100, 125, 145, 190], "extra 125x5");
  assert(steps[1].reps === 5, "extra x5");
});

Deno.test("12 min easy run 10 min before lifting removes block 1", () => {
  const now = "2026-01-07T08:00:00Z";
  const plan = planWarmup({
    exercises: [{
      exerciseId: "squat",
      cls: "main",
      muscles: ["quads"],
      w: 225,
      reference: 265,
    }],
    approach: "strength",
    soreness: {},
    prs: 7,
    equipment: { cardio: ["bike"], recovery: ["foamRoller"] },
    recentRun: {
      endedAtIso: "2026-01-07T07:50:00Z",
      minutes: 12,
      distanceM: 2500,
      easy: true,
    },
    nowIso: now,
    topSetPctRef: 0.85,
  });
  const gen = plan.blocks.find((b) => b.kind === "general")!;
  assert(gen.skipped === true, "general skipped");
});

Deno.test("hard run does not cover general", () => {
  const plan = planWarmup({
    exercises: [{
      exerciseId: "squat",
      cls: "main",
      muscles: ["quads"],
      w: 225,
      reference: 265,
    }],
    approach: "strength",
    soreness: {},
    prs: 7,
    equipment: { cardio: ["bike"] },
    recentRun: {
      endedAtIso: "2026-01-07T07:50:00Z",
      minutes: 12,
      distanceM: 2500,
      easy: false,
    },
    nowIso: "2026-01-07T08:00:00Z",
    topSetPctRef: 0.85,
  });
  assert(
    plan.blocks.find((b) => b.kind === "general")!.skipped !== true,
    "general kept",
  );
});

Deno.test("cut order under T=5 min: tissue, mobility, general", () => {
  const plan = planWarmup({
    exercises: [{
      exerciseId: "squat",
      cls: "main",
      muscles: ["quads", "glutes"],
      w: 225,
      reference: 265,
    }],
    approach: "strength",
    soreness: { quads: 3 },
    prs: 7,
    equipment: { cardio: ["bike"], recovery: ["foamRoller"] },
    nowIso: "2026-01-07T08:00:00Z",
    timeBudgetMin: 5,
    topSetPctRef: 0.85,
  });
  const st = plan.blocks.find((b) => b.kind === "softTissue");
  assert(!st || st.skipped === true, "tissue cut first");
  const mob = plan.blocks.find((b) => b.kind === "mobility")!;
  assert(mob.items.length === 1, "mobility to 1 drill");
  const gen = plan.blocks.find((b) => b.kind === "general")!;
  assert(gen.minutes === 3, "general to 3 min");
  // Ramp sets never cut.
  assert(plan.ramps[0].steps.length === 3, "ramp kept");
});

Deno.test("research example: squat day with bike+roller, quads sore 3", () => {
  const plan = planWarmup({
    exercises: [{
      exerciseId: "squat",
      cls: "main",
      muscles: ["quads", "glutes"],
      w: 225,
      reference: 265,
    }],
    approach: "strength",
    soreness: { quads: 3 },
    prs: 6,
    equipment: { cardio: ["bike"], recovery: ["foamRoller"] },
    nowIso: "2026-01-07T08:00:00Z",
    timeBudgetMin: 15,
    topSetPctRef: 0.85,
  });
  const gen = plan.blocks.find((b) => b.kind === "general")!;
  assert(gen.minutes === 10, "10 min easy on heavy strength day");
  const st = plan.blocks.find((b) => b.kind === "softTissue")!;
  const quads = st.items.find((i) => i.muscle === "quads")!;
  assert(quads.seconds === 120, "sore muscle 120 s");
  assertEqual(loads(plan.ramps[0].steps), [100, 145, 190], "ramp");
});

Deno.test("run warmups: easy needs none; quality gets easy+drills+strides", () => {
  assertEqual(
    planRunWarmup("easy"),
    ["first 5 min slower than target"],
    "easy",
  );
  assert(planRunWarmup("intervals").length === 3, "quality 3 parts");
});
