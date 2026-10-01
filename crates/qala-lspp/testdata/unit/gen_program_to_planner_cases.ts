// deno-lint-ignore-file no-explicit-any
// Generates expected values for the ProgramToPlanner port by running the TS oracle.
// Run from the repo root:
//   deno run -A --config packages/liftoscript/deno.json \
//     crates/qala-lspp/testdata/unit/gen_program_to_planner_cases.ts
// Writes cases_program_to_planner.json next to this file.
//
// Every built-in program is evaluated with forceEvaluateText (lb settings, and kg for ten of
// them) and then printed back with convertToPlanner() and PlannerProgram_generateFullText.
// The evaluated programs of the 60 lb cases already live in
// testdata/golden/liftoscript/builtins/<name>.json (scrubbed ids), so those cases only name that
// file. The kg cases and the hand-written edge cases embed their evaluated program.
import {
  forceEvaluateText,
  PlannerProgram_generateFullText,
  ProgramToPlanner,
} from "../../../../packages/liftoscript/mod.ts";
import {
  builtinProgramNames,
  loadBuiltinProgram,
} from "../../../../packages/liftoscript/tests/helpers.ts";
import { canon, liftSettings, reseed } from "../../../../scripts/golden_liftoscript_lib.ts";

const dir = new URL(".", import.meta.url).pathname;
const repo = new URL("../../../../", import.meta.url).pathname;

const lb = liftSettings("lb");
const kg = liftSettings("kg");
const custom: any = JSON.parse(JSON.stringify(lb));
custom.exercises = {
  myPress: {
    vtype: "custom_exercise",
    id: "myPress",
    name: "My Press",
    isDeleted: false,
    meta: { bodyParts: ["Shoulders"], targetMuscles: [], synergistMuscles: [], sortedEquipment: ["barbell"] },
    defaultEquipment: "barbell",
    types: ["upper", "push"],
  },
};
const settingsById: Record<string, any> = { lb, kg, custom };

function plain(v: any): any {
  return JSON.parse(
    JSON.stringify(canon(v), (_k, x) => (x === undefined ? null : x)),
  );
}

function errOut(e: any): any {
  return {
    $throws: e?.constructor?.name ?? "Error",
    message: e?.message ?? String(e),
  };
}

function run(program: any, settings: any): any {
  reseed();
  try {
    const planner = new ProgramToPlanner(program, settings).convertToPlanner();
    const text = PlannerProgram_generateFullText(planner.weeks);
    return { planner: plain(planner), text };
  } catch (e) {
    return { error: errOut(e) };
  }
}

const cases: any[] = [];

// ---- built-ins

const names = builtinProgramNames();
let withErrors = 0;
for (const file of names) {
  const name = file.replace(/\.md$/, "");
  const text = loadBuiltinProgram(file);
  reseed();
  const program = forceEvaluateText(text, file, lb);
  if (program.errors.length > 0) withErrors += 1;
  cases.push({
    name: `builtin_lb_${name}`,
    settings: "lb",
    golden: `builtins/${name}.json`,
    ...run(program, lb),
  });
}
console.log(`builtins: ${names.length}, with evaluation errors: ${withErrors}`);

const KG_PROGRAMS = [
  "gzclp",
  "ss1",
  "arnold-split",
  "gzcl-uhf-9-weeks",
  "sheiko-29-32",
  "texasmethod",
  "madcow",
  "basicBeginner",
  "smolov-jr",
  "ss3",
];
for (const name of KG_PROGRAMS) {
  const file = `${name}.md`;
  if (!names.includes(file)) {
    console.log(`skip kg ${name}`);
    continue;
  }
  reseed();
  const program = forceEvaluateText(loadBuiltinProgram(file), file, kg);
  cases.push({
    name: `builtin_kg_${name}`,
    settings: "kg",
    program: plain(program),
    ...run(program, kg),
  });
}

// ---- hand-written programs

const day = (body: string, n = 1) => `## Day ${n}\n${body}\n`;
const week = (n: number, ...days: string[]) => `# Week ${n}\n${days.join("\n")}`;

const EDGE: Record<string, { text: string; settings?: string }> = {
  plain_sets: {
    text: week(1, day("Squat / 3x5 100lb / 90s\nBench Press / 3x8-10 @8 60kg\nDeadlift / 1x5, 1x3 120lb, 1x1 140lb")),
  },
  globals_all: {
    text: week(1, day("Squat / 3x5, 2x3 / 100lb+ / @8+ / 120s\nBench Press / 5x5 / ?+ / 90s")),
  },
  percent_weights: {
    text: week(1, day("Squat / 3x5 80% / 3x3 85% @9\nBench Press / 3x5 / 70%")),
  },
  amrap_quickadd_label: {
    text: week(1, day("Squat / 3x5, 1x5+ (AMRAP) 100lb\nBench Press / 2+x5 80lb / 60s")),
  },
  per_set_rpe_timers: {
    text: week(1, day("Squat / 1x5 @7 60s, 1x5 @8+ 90s, 1x5 @9 120s\nBench Press / 3x5 30s|60s, 2x5 45s+|90s")),
  },
  global_set_timer: {
    text: week(1, day("Squat / 3x5 100lb / 30s|120s\nBench Press / 3x5 100lb / 30s+|90s")),
  },
  warmups: {
    text: week(1, day("Squat / 3x5 200lb / warmup: 1x5 45lb, 1x3 95lb, 1x1 135lb\nBench Press / 3x5 100lb / warmup: 2x5 50%, 1x3 70%\nDeadlift / 1x5 300lb / warmup: none")),
  },
  warmups_repeat_weeks: {
    text: week(1, day("Squat / 3x5 200lb / warmup: 1x5 45lb, 1x3 95lb")) + "\n" + week(2, day("Squat / 3x5 205lb")),
  },
  superset: {
    text: week(1, day("Bench Press / 3x8 100lb / superset: A\nBent Over Row / 3x8 90lb / superset: A\nSquat / 3x5 200lb")),
  },
  used_none_template_reuse: {
    text: week(1, day("tmpl / used: none / 3x5 100lb / 90s\nSquat / ...tmpl\nBench Press / ...tmpl / 80lb")),
  },
  reuse_override_sets: {
    text: week(1, day("tmpl / used: none / 3x5 100lb / 90s\nSquat / ...tmpl / 5x3 120lb\nBench Press / ...tmpl / 4x8\nDeadlift / ...tmpl / @8 60s")),
  },
  reuse_override_globals: {
    text: week(1, day("tmpl / used: none / 3x5 100lb @7 / 90s\nSquat / ...tmpl / 110lb+\nBench Press / ...tmpl / @9+\nDeadlift / ...tmpl / 45s|120s\nOverhead Press / ...tmpl / 60s")),
  },
  reuse_week_day: {
    text: week(1, day("Squat / 3x5 100lb")) + "\n" + week(2, day("Squat / ...Squat[1:1] / 105lb")),
  },
  progress_lp: {
    text: week(1, day("Squat / 3x5 100lb / progress: lp(5lb)\nBench Press / 3x5 100lb / progress: lp(5lb, 3, 0, 10lb, 2, 0)\nDeadlift / 1x5 200lb / progress: lp(10lb, 2, 0)")),
  },
  progress_dp_sum: {
    text: week(1, day("Squat / 3x8 100lb / progress: dp(5lb, 8, 12)\nBench Press / 3x5 100lb / progress: sum(15, 5lb)\nDeadlift / 1x5 200lb / progress: dp(5%, 5, 8)")),
  },
  progress_none: {
    text: week(1, day("Squat / 3x5 100lb / progress: none\nBench Press / 3x5 100lb")),
  },
  progress_custom_state: {
    text: week(1, day(`Squat / 3x5 100lb / progress: custom(increase: 5lb, stage+: 1, rate: 2.5) {~
  if (completedReps >= reps) {
    weights += state.increase
    state.stage = 1
  }
~}\nBench Press / 3x5 100lb`)),
  },
  progress_custom_reuse: {
    text: week(1, day("Squat / ...tmpl / progress: custom(increase: 10lb) { ...tmpl }\nBench Press / ...tmpl\nDeadlift / ...tmpl / 4x4 150lb"),
      day(`tmpl / used: none / 3x5 100lb / progress: custom(increase: 5lb) {~
  if (completedReps >= reps) { weights += state.increase }
~}`, 2)),
  },
  update_custom: {
    text: week(1, day(`Squat / 3x5 100lb / update: custom() {~
  if (setIndex == 1) { weights = weights + 5lb }
~}\nBench Press / 3x5 100lb`)),
  },
  multiweek_repeat: {
    text: week(1, day("Squat[1-3] / 3x5 100lb / progress: lp(5lb)\nBench Press / 3x5 80lb")) + "\n" +
      week(2, day("Bench Press / 3x5 85lb")) + "\n" + week(3, day("Bench Press / 3x5 90lb")),
  },
  multiweek_differing: {
    text: week(1, day("Squat / 5x5 100lb\nBench Press / 5x5 80lb")) + "\n" +
      week(2, day("Squat / 5x5 105lb\nBench Press / 5x5 82.5lb")) + "\n" +
      week(3, day("Squat / 5x5 110lb\nBench Press / 5x5 85lb")),
  },
  multiweek_range_backwards: {
    text: week(1, day("Bench Press / 3x5 80lb")) + "\n" + week(2, day("Bench Press / 3x5 80lb")) + "\n" +
      week(3, day("Squat[1-3] / 3x5 100lb / progress: lp(5lb)\nBench Press / 3x5 85lb")),
  },
  multiple_days_weeks_named: {
    text: `# Week 1\n## Heavy\nSquat / 3x5 100lb\n## Light\nBench Press / 3x5 80lb\n# Week 2\n## Heavy\nSquat / 3x5 105lb\n## Light\nBench Press / 3x5 82.5lb`,
  },
  descriptions: {
    text: week(1, day("// Warm up first\n// then go heavy\nSquat / 3x5 100lb\n\n// Pressing\nBench Press / 3x5 80lb")),
  },
  descriptions_variations: {
    text: week(1, day("// first note\n\n// ! second note\nSquat / 3x5 100lb\nBench Press / 3x5 80lb")),
  },
  descriptions_reused: {
    text: week(1, day("// ...t1\nt1: Squat / ...t1\n\n// ...t2\nt2: Bench Press / ...t2 / 90lb"),
      day("// shared note one\n// second line\nt1 / used: none / 3x5 100lb\n\n// other note\nt2 / used: none / 3x8 80lb", 2)),
  },
  comments: {
    text: week(1, day("// Squat day\nSquat / 3x5 100lb\n\n// just a comment\n\nBench Press / 3x5 80lb")),
  },
  tags: {
    text: week(1, day("Squat / 3x5 100lb / id: tags(1, 2)\nBench Press / 3x5 80lb / id: tags(3)")),
  },
  tags_multiweek: {
    text: week(1, day("Squat / 3x5 100lb / id: tags(1)")) + "\n" + week(2, day("Squat / 3x5 105lb / id: tags(1)")),
  },
  exercise_variations: {
    text: week(1, day("Squat | Front Squat / 3x5 100lb\nBench Press | ! Incline Bench Press / 3x5 80lb")),
  },
  set_variations: {
    text: week(1, day("Squat / 3x5 100lb / ! 3x3 120lb / 5x1 140lb")),
  },
  labels: {
    text: week(1, day("t1: Squat / 3x5 100lb\nt2: Squat / 3x8 80lb")),
  },
  order_suffix: {
    text: week(1, day("Squat[1] / 3x5 100lb\nBench Press / 3x3 120lb")),
  },
  equipment_names: {
    text: week(1, day("Bench Press, Dumbbell / 3x10 30lb\nSquat, Barbell / 3x5 100lb\nBicep Curl, Cable / 3x12 40lb")),
  },
  kg_units: {
    text: week(1, day("Squat / 3x5 100kg / 90s\nBench Press / 3x5 60kg @8")),
    settings: "kg",
  },
  custom_exercise: {
    text: week(1, day("My Press / 3x5 50lb / 90s")),
    settings: "custom",
  },
  unknown_exercise: {
    text: week(1, day("Mystery Move / 3x5 50lb")),
  },
  decimal_weights: {
    text: week(1, day("Squat / 3x5 102.5lb @8.5 / 97s\nBench Press / 3x5 62.25lb")),
  },
  zero_and_bodyweight: {
    text: week(1, day("Pull Up / 3x8 0lb\nPush Up / 3x20")),
  },
  syntax_error_program: {
    text: week(1, day("Squat / 3x5 100lb / progress: bogus(1)")),
  },
  reuse_error_program: {
    text: week(1, day("Squat / ...nothing / 3x5")),
  },
};

for (const [name, spec] of Object.entries(EDGE)) {
  const settingsId = spec.settings ?? "lb";
  const settings = settingsById[settingsId];
  reseed();
  let program: any;
  try {
    program = forceEvaluateText(spec.text, `${name}.md`, settings);
  } catch (e) {
    console.log(`edge ${name}: forceEvaluateText threw ${(e as any)?.message}`);
    continue;
  }
  const out = run(program, settings);
  const status = out.error
    ? `throws (${program.errors.length} eval errors)`
    : `ok (${out.text.length} chars)`;
  console.log(`edge ${name}: ${status}`);
  cases.push({
    name: `edge_${name}`,
    settings: settingsId,
    programText: spec.text,
    program: plain(program),
    ...out,
  });
}

const fixtures = { settings: plain(settingsById) };
Deno.writeTextFileSync(
  dir + "cases_program_to_planner.json",
  JSON.stringify({ version: 1, fixtures, cases }) + "\n",
);
console.log(`wrote ${cases.length} cases`);
