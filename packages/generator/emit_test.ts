// Program text: deterministic liftoscript-shaped output with progress:
// scripts and double progression. Shape-checked by regex; a full parser check
// against packages/liftoscript becomes possible once that package lands.

import { emitProgram, generateBlock } from "./mod.ts";
import type { GeneratorInput } from "./mod.ts";
import { taperSchedule } from "./templates.ts";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

const BASE: GeneratorInput = {
  goal: "hypertrophy",
  daysPerWeek: 4,
  sessionMinutes: 90,
  experience: "intermediate",
  equipment: [],
  priorities: {},
  exclusions: [],
  blockWeeks: 5,
  referenceRm: { squat: 265, bench: 200, deadlift: 315, ohp: 125 },
};

const DAY_RE = /^### Day \d+ - .+$/m;
const EXERCISE_RE =
  /^.+ \/ \d+x\d+(-\d+)? @ \d+(\.\d+)?(lb|%) \/ RPE \d+(\.\d+)? \/ progress: \S+.*$/m;

function assertShape(text: string, label: string): void {
  assert(text.includes("# goal:"), `${label} carries a goal header`);
  assert(/^## Week \d+/m.test(text), `${label} has week headers`);
  assert(DAY_RE.test(text), `${label} has day headers`);
  const lines = text.split("\n").filter((l) => l.includes(" / "));
  assert(lines.length > 0, `${label} has exercise lines`);
  for (const line of lines) {
    assert(EXERCISE_RE.test(line), `${label} exercise line parses: ${line}`);
  }
  assert(/progress: double\(/m.test(text), `${label} uses double progression`);
}

Deno.test("every goal and split emits well-shaped program text", () => {
  for (
    const goal of [
      "hypertrophy",
      "strength",
      "meetPrep",
      "athleticMaintenance",
    ] as const
  ) {
    for (const days of [2, 3, 4, 5, 6]) {
      const input: GeneratorInput = {
        ...BASE,
        goal,
        daysPerWeek: days,
        meetDate: goal === "meetPrep" ? "2026-10-10" : undefined,
      };
      const text = emitProgram(generateBlock(input), input);
      assertShape(text, `${goal} ${days}d`);
    }
  }
});

Deno.test("emission is deterministic", () => {
  const a = emitProgram(generateBlock(BASE), BASE);
  const b = emitProgram(generateBlock(BASE), BASE);
  assert(a === b, "same input gives byte-identical text");
});

Deno.test("strength programs progress by percentage with RPE autoregulation", () => {
  const input: GeneratorInput = { ...BASE, goal: "strength" };
  const text = emitProgram(generateBlock(input), input);
  assert(
    /progress: percent\(/m.test(text),
    "main lifts carry percent progression",
  );
  assert(
    /helms2pct/.test(text),
    "strength-day top sets autoregulate (Helms 2018)",
  );
});

Deno.test("linear output matches the table after plate rounding", () => {
  const input: GeneratorInput = {
    ...BASE,
    goal: "strength",
    experience: "beginner",
    daysPerWeek: 3,
  };
  const block = generateBlock(input);
  assert(
    block.periodization === "linear",
    "beginners get linear periodization",
  );
  const text = emitProgram(block, input);
  assert(
    /Squat \/ 4x5 @ 210lb/.test(text),
    "week 1 squat 4x5 @ 80% of 265, rounded to 210",
  );
  assert(
    /Bench Press \/ 4x5 @ 160lb/.test(text),
    "week 1 bench 4x5 @ 80% of 200",
  );
});

Deno.test("deload week halves sets at RPE 6", () => {
  const block = generateBlock(BASE);
  const hard = block.weeks[0];
  const deload = block.weeks[block.weeks.length - 1];
  assert(deload.deload, "last week is flagged deload");
  const hardBench = hard.days[0].exercises.find((e) =>
    e.exerciseId === "bench"
  )!;
  const deloadBench = deload.days[0].exercises.find((e) =>
    e.exerciseId === "bench"
  )!;
  assert(
    deloadBench.sets === Math.max(1, Math.round(hardBench.sets * 0.5)),
    "deload sets x0.5",
  );
  assert(
    deload.days.every((d) => d.exercises.every((e) => e.rpe === 6)),
    "deload RPE 6 everywhere",
  );
  const text = emitProgram(block, BASE);
  assert(/^## Week \d+ - deload$/m.test(text), "deload week is labelled");
});

Deno.test("meet prep ends on the meet date with dated taper sessions", () => {
  const input: GeneratorInput = {
    ...BASE,
    goal: "meetPrep",
    meetDate: "2026-10-10",
  };
  const text = emitProgram(generateBlock(input), input);
  assert(text.includes("# meetDate: 2026-10-10"), "meet date in header");
  assert(
    text.includes("Meet day - 2026-10-10"),
    "program ends on the meet date",
  );
  for (const s of taperSchedule("2026-10-10")) {
    assert(
      text.includes(s.dateISO),
      `taper date ${s.dateISO} (${s.lift} ${s.kind}) emitted`,
    );
  }
  assert(
    /deadlift opener - 2026-10-01/.test(text),
    "deadlift opener dated 9 d out",
  );
});
