// Program text: deterministic LS++ output. Shape-checked by regex here; the
// real wasm parser, evaluator and dry run check the same text in
// apps/web/src/logic/nextBlock.test.ts.

import { emitProgram, generateBlock } from "./mod.ts";
import type { GeneratorInput } from "./mod.ts";
import { EXERCISE_CATALOG } from "./types.ts";
import { LSPP_EXERCISES, workoutOrder } from "./emit.ts";
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

const WEEK_RE = /^# Week \d+( - deload)?$/;
const DAY_RE = /^## Day \d+: .+$/;
// `Name / 4x8 180lb @7.5`, or `Name / 3x8-12 ?+` when there is no reference.
const EXERCISE_RE =
  /^[A-Za-z][^/]* \/ \d+x\d+(-\d+)? (\?\+|\d+(\.\d+)?lb @\d+(\.\d+)?)$/;
const KNOWN_NAMES = new Set(Object.values(LSPP_EXERCISES).map((e) => e.name));

function assertShape(text: string, label: string): void {
  assert(text.startsWith("/// "), `${label} opens with the /// header`);
  assert(text.includes("/// goal:"), `${label} carries a goal header`);
  const lines = text.split("\n");
  let exercises = 0;
  lines.forEach((line, i) => {
    if (line === "" || line.startsWith("///")) return;
    if (line.startsWith("## ")) {
      assert(DAY_RE.test(line), `${label} day header: ${line}`);
    } else if (line.startsWith("# ")) {
      assert(WEEK_RE.test(line), `${label} week header: ${line}`);
    } else if (line.startsWith("//")) {
      // A note belongs to the exercise right under it, with no blank line
      // between, or LS++ splits it into a second description.
      assert(lines[i + 1] !== "", `${label} note is followed by its line`);
    } else {
      exercises++;
      assert(EXERCISE_RE.test(line), `${label} exercise line: ${line}`);
      assert(!line.includes("progress:"), `${label} no progress clause`);
      const name = line.slice(0, line.indexOf(" / "));
      assert(KNOWN_NAMES.has(name), `${label} catalog name: ${name}`);
      assert(
        lines[i - 1].startsWith("// progress: "),
        `${label} progress note above: ${line}`,
      );
    }
  });
  assert(exercises > 0, `${label} has exercise lines`);
  assert(/^# Week 1$/m.test(text), `${label} has week headers`);
  assert(/^## Day 1: /m.test(text), `${label} has day headers`);
  assert(
    /^\/\/ progress: double progression, /m.test(text),
    `${label} uses double progression`,
  );
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

Deno.test("every generator exercise has an LS++ name", () => {
  for (const ex of EXERCISE_CATALOG) {
    assert(LSPP_EXERCISES[ex.id] !== undefined, `LS++ name for ${ex.id}`);
  }
});

Deno.test("each day lists main lifts first, then secondary, then isolation", () => {
  const rank = { main: 0, secondary: 1, isolation: 2 };
  for (const daysPerWeek of [3, 4, 5] as const) {
    const block = generateBlock({ ...BASE, goal: "strength", daysPerWeek });
    for (const week of block.weeks) {
      for (const day of week.days) {
        const ranks = workoutOrder(day.exercises).map((e) => rank[e.klass]);
        assert(
          ranks.every((r, i) => i === 0 || ranks[i - 1] <= r),
          `${day.label}: ${ranks.join(",")}`,
        );
      }
    }
  }
  // The text follows the same order: a lower day opens on its main lift, not
  // on Standing Calf Raise as the alphabetical order used to put it.
  const text = emitProgram(generateBlock(BASE), BASE);
  for (const day of text.split("## Day ").slice(1)) {
    const first = day.split("\n").find((l) => / \/ /.test(l));
    assert(
      first !== undefined && !first.startsWith("Standing Calf"),
      first ?? day,
    );
  }
});

Deno.test("emission is deterministic", () => {
  const a = emitProgram(generateBlock(BASE), BASE);
  const b = emitProgram(generateBlock(BASE), BASE);
  assert(a === b, "same input gives byte-identical text");
});

Deno.test("a line with no reference 1RM asks for the weight", () => {
  const text = emitProgram(generateBlock(BASE), BASE);
  assert(
    /^Lateral Raise \/ \d+x12-15 \?\+$/m.test(text),
    "no reference: ?+ and no RPE, so the evaluator infers no weight",
  );
  assert(!/%/.test(text.replace(/^\/\/.*$/gm, "")), "no bare percentages");
  assert(
    /^\/\/ progress: double progression, 12-15 reps at RPE \d+(\.5)? or below\./m
      .test(text),
    "its RPE is in the note",
  );
});

Deno.test("names the catalog lacks keep a note and the barbell suffix", () => {
  const input: GeneratorInput = { ...BASE, goal: "strength" };
  const text = emitProgram(generateBlock(input), input);
  assert(
    /^\/\/ Pause Squat\. .*\n\/\/ progress: .*\npause: Squat \/ /m.test(text),
    "Pause Squat is Squat under a label, with a note",
  );
  assert(
    /^Romanian Deadlift, Barbell \/ \d+x8-12 \d+lb @8$/m.test(text),
    "RDL carries its barbell weight",
  );
  assert(!/^Romanian Deadlift \//m.test(text), "never the dumbbell default");
});

Deno.test("strength programs progress by percentage with RPE autoregulation", () => {
  const input: GeneratorInput = { ...BASE, goal: "strength" };
  const text = emitProgram(generateBlock(input), input);
  assert(
    /^\/\/ progress: weekly percentage step from the block table, target RPE \d/m
      .test(text),
    "main lifts carry percent progression",
  );
  assert(
    /^\/\/ progress: .*Autoregulated \(Helms 2018\)/m.test(text),
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
    /^Squat \/ 4x5 210lb @7\.5$/m.test(text),
    "week 1 squat 4x5 @ 80% of 265, rounded to 210",
  );
  assert(
    /^Bench Press \/ 4x5 160lb @7\.5$/m.test(text),
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
  assert(/^# Week \d+ - deload$/m.test(text), "deload week is labelled");
});

Deno.test("meet prep ends on the meet date with dated taper sessions", () => {
  const input: GeneratorInput = {
    ...BASE,
    goal: "meetPrep",
    meetDate: "2026-10-10",
  };
  const text = emitProgram(generateBlock(input), input);
  assert(text.includes("/// meetDate: 2026-10-10"), "meet date in header");
  assert(
    /^## Day \d+: Meet day - 2026-10-10$/m.test(text),
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
