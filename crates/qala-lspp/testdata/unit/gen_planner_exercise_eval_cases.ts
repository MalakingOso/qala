// deno-lint-ignore-file no-explicit-any
// Generates expected values for the PlannerExerciseEvaluator / plannerStateVars /
// programExercise ports by running the TS oracle. Run from the repo root:
//   deno run -A --config packages/liftoscript/deno.json \
//     crates/qala-lspp/testdata/unit/gen_planner_exercise_eval_cases.ts
// Writes cases_planner_exercise_eval.json next to this file.
//
// The evaluator calls are recorded by patching the prototype while the 60 built-in
// programs run through forceEvaluateText, so each (script, mode, dayData, settings)
// the real stack uses becomes a case. The text of every planner_calls input and a
// list of hand-written scripts (features and errors) are replayed through the
// evaluator directly.
import {
  forceEvaluateText,
  PlannerExerciseEvaluator,
  plannerExerciseParser,
  PlannerProgram_evaluateText,
} from "../../../../packages/liftoscript/mod.ts";
import {
  builtinProgramNames,
  loadBuiltinProgram,
} from "../../../../packages/liftoscript/tests/helpers.ts";
import { canon, liftSettings, reseed } from "../../../../scripts/golden_liftoscript_lib.ts";
import { PlannerStateVars_fromArgs } from "../../../../packages/liftoscript/src/pages/planner/models/plannerStateVars.ts";
import { PlannerKey_fromFullName } from "../../../../packages/liftoscript/src/pages/planner/plannerKey.tsx";
import { PlannerProgramExercise_buildProgress } from "../../../../packages/liftoscript/src/pages/planner/models/plannerProgramExercise.ts";
import * as PE from "../../../../packages/liftoscript/src/models/programExercise.ts";

const dir = new URL(".", import.meta.url).pathname;
const repo = new URL("../../../../", import.meta.url).pathname;

// ---- fixtures

const lb = liftSettings("lb");
const kg = liftSettings("kg");
const custom = JSON.parse(JSON.stringify(lb));
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
  gone: {
    vtype: "custom_exercise",
    id: "gone",
    name: "Gone Row",
    isDeleted: true,
    meta: { bodyParts: [], targetMuscles: [], synergistMuscles: [] },
  },
};
const settingsById: Record<string, any> = { lb, kg, custom };

// ---- normalisation

function norm(v: any): any {
  if (v instanceof Set) return [...v].map(norm);
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object" && !(v instanceof Error)) {
    const out: any = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "liftoscriptNode") continue;
      out[k] = norm(x);
    }
    return out;
  }
  return v;
}

function scrubIds(result: any): void {
  if (!result.success) return;
  for (const w of result.data) {
    for (const d of w.days) for (const e of d.exercises) e.id = "<uid>";
  }
}

function errOut(e: any): any {
  return {
    $throws: e?.constructor?.name ?? "Error",
    message: e?.message ?? String(e),
    ...(e && "line" in e ? { line: e.line, offset: e.offset, from: e.from, to: e.to, details: e.details } : {}),
  };
}

function plain(v: any): any {
  return JSON.parse(JSON.stringify(canon(norm(v)), (_k, x) => (x === undefined ? null : x)));
}

// ---- recording

type Case = Record<string, any>;
const cases: Case[] = [];
const seen = new Set<string>();
let recording = true;

function settingsIdOf(s: any): string {
  const json = JSON.stringify(s);
  for (const [id, v] of Object.entries(settingsById)) if (v === s || JSON.stringify(v) === json) return id;
  const id = "s" + Object.keys(settingsById).length;
  settingsById[id] = JSON.parse(json);
  return id;
}

const proto: any = PlannerExerciseEvaluator.prototype;
const origEvaluate = proto.evaluate;
proto.evaluate = function (this: any, node: any) {
  const result = origEvaluate.call(this, node);
  if (recording) {
    const c: Case = {
      method: "evaluate",
      script: this.script,
      mode: this.mode,
      dayData: this.initialDayData ?? null,
      settings: settingsIdOf(this.settings),
    };
    const key = JSON.stringify([c.script, c.mode, c.dayData, c.settings]);
    if (!seen.has(key)) {
      seen.add(key);
      c.output = serializeResult(result);
      cases.push(c);
    }
  }
  return result;
};
// evaluate() overwrites this.dayData as it walks Week/Day lines, so the constructor's
// value is captured on the first parse()/evaluateProgram() call.
const origRun = proto.evaluateProgram;
proto.evaluateProgram = function (this: any, ...args: any[]) {
  if (this.initialDayData === undefined) this.initialDayData = { ...this.dayData };
  return origRun.apply(this, args);
};
// evaluate() calls parse() first, which runs before evaluateProgram, so capture there too.
const origParse = proto.parse;
proto.parse = function (this: any, ...args: any[]) {
  if (this.initialDayData === undefined) this.initialDayData = { ...this.dayData };
  return origParse.apply(this, args);
};

function serializeResult(r: any): any {
  if (r.success) {
    const copy = plain({ success: true, data: r.data });
    scrubIds(copy);
    return copy;
  }
  const e = r.error;
  return {
    success: false,
    error: plain({ message: e.message, line: e.line, offset: e.offset, from: e.from, to: e.to, details: e.details }),
  };
}

function direct(script: string, mode: string, settingsId: string, dayData?: any): void {
  const key = JSON.stringify([script, mode, dayData ?? null, settingsId, "direct"]);
  if (seen.has(key)) return;
  seen.add(key);
  const settings = settingsById[settingsId];
  reseed();
  const ev: any = new PlannerExerciseEvaluator(script, settings, mode as any, dayData);
  const tree = plannerExerciseParser.parse(script);
  let output: any;
  try {
    output = serializeResult(ev.evaluate(tree.topNode));
  } catch (e) {
    // a TypeError out of the TS (for example a day-less week in onset mode); Rust must not panic
    output = errOut(e);
  }
  cases.push({
    method: "evaluate",
    script,
    mode,
    dayData: dayData ?? null,
    settings: settingsId,
    output,
  });
}

// ---- 1. built-in programs through the real stack

const names = builtinProgramNames();
const dayTexts: string[] = [];
for (const file of names) {
  const text = loadBuiltinProgram(file);
  reseed();
  forceEvaluateText(text, file, lb);
  for (const w of PlannerProgram_evaluateText(text)) for (const d of w.days) dayTexts.push(d.exerciseText);
}
for (const file of ["gzclp", "ss1", "arnold-split", "gzcl-uhf-9-weeks", "sheiko-29-32"]) {
  reseed();
  forceEvaluateText(loadBuiltinProgram(file + ".md"), file + ".md", kg);
}
recording = false;

// ---- 2. planner_calls inputs, per-day and full

const callsDir = repo + "testdata/golden/liftoscript/lezer_trees/planner_calls/";
const callInputs = new Set<string>();
for (const e of Deno.readDirSync(callsDir)) {
  for (const c of JSON.parse(Deno.readTextFileSync(callsDir + e.name))) callInputs.add(c.input);
}
for (const input of [...callInputs].sort()) {
  direct(input, "perday", "lb");
  if (/^#/m.test(input)) direct(input, "full", "lb");
}

// ---- 3. hand-written scripts

const hand: string[] = [
  "Squat / 3x5 100lb",
  "Squat / 3x5 100lb / warmup: 1x5 50%, 3x3 100lb, 5 60kg",
  "Squat / 3x5 / warmup: none",
  "Squat / warmup: 0% / 3x5",
  "Squat / 3x5 100lb / used: none",
  "Squat / 3x5 / used: none / progress: lp(5lb)",
  "Squat / 3x5 / superset: Bench Press",
  "Squat / 3x5 / id: tags(1, 2, 3) / id: tags(7)",
  "Squat / 3x5 60s / 3x8 90s 80%",
  "Squat / 3x5 60s+|30s",
  "Squat / 3x5 60s|?",
  "Squat / 3x5 @8 / 3x5 @8+ / 3x5 @9.5",
  "Squat / 3x5-8 / 3+x5 / 5x5+ / 1x3-5+",
  "Squat / 3x5 (heavy)",
  "Squat / 3x5 (waytoolong1)",
  "Squat / 3x5 (two words)",
  "Squat / 3x5 ?+",
  "Squat / 3x5 100lb+ / 3x5 50%+",
  "Squat / 3x5 -5%",
  "Squat / 3x5 +5kg",
  "Squat / 100lb / 60s / @8 / auto / 3x5",
  "Squat / 3x5 / ...Bench Press",
  "Squat / ...Bench Press[2]",
  "Squat / ...Bench Press[2:3]",
  "Squat / ...Bench Press[_:3]",
  "Squat / ...t1 / progress: lp(5lb, 2, 1, 10lb, 2, 0)",
  "Squat / 3x5 / progress: lp(5lb)",
  "Squat / 3x5 / progress: lp(5lb, 2)",
  "Squat / 3x5 / progress: lp(5%, 2, 1, 10%)",
  "Squat / 3x5 / progress: lp(5lb, 2, 1, 10lb, 2, 0, 1)",
  "Squat / 3x5 / progress: lp(5)",
  "Squat / 3x5 / progress: lp(5lb, x)",
  "Squat / 3x5 / progress: lp(5lb, 2, x)",
  "Squat / 3x5 / progress: lp(5lb, 2, 1, 5)",
  "Squat / 3x5 / progress: lp(5lb, 2, 1, 5lb, y)",
  "Squat / 3x5 / progress: lp(5lb, 2, 1, 5lb, 1, z)",
  "Squat / 3x5 / progress: dp(5lb, 8, 12)",
  "Squat / 3x5 / progress: dp(5lb, 8)",
  "Squat / 3x5 / progress: dp(5, 8, 12)",
  "Squat / 3x5 / progress: dp(5lb, a, 12)",
  "Squat / 3x5 / progress: dp(5lb, 8, b)",
  "Squat / 3x5 / progress: sum(30, 5lb)",
  "Squat / 3x5 / progress: sum(30, 5lb, 7)",
  "Squat / 3x5 / progress: sum(x, 5lb)",
  "Squat / 3x5 / progress: sum(30)",
  "Squat / 3x5 / progress: sum(30, 5)",
  "Squat / 3x5 / progress: none",
  "Squat / 3x5 / progress: nope(1)",
  "Squat / 3x5 / progress: custom(increase: 5lb, n+: 3, p: 10%) {~ state.increase += 1 ~}",
  "Squat / 3x5 / progress: custom(increase: 5lb) { ...t1 }",
  "Squat / 3x5 / progress: custom(increase: 5lb)",
  "Squat / 3x5 / progress: custom() {~ weights += 5lb ~}",
  "Squat / 3x5 / progress: custom(bad) {~ weights += 5lb ~}",
  "Squat / 3x5 / progress: custom(bad:) {~ weights += 5lb ~}",
  "Squat / 3x5 / progress: custom(a: lb) {~ weights += 5lb ~}",
  "Squat / 3x5 / progress: custom(increase: 5lb) {~ foo(1) ~}",
  "Squat / 3x5 / progress: custom(increase: 5lb) {~ weights = state.nope ~}",
  "Squat / 3x5 / progress: custom() {~\n  if (completedReps >= reps) {\n    weights += 5lb\n  }\n  state.x = bad(\n~}",
  "Squat / 3x5 / update: custom() {~ state.n = 1 ~}",
  "Squat / 3x5 / update: custom() { ...t1 }",
  "Squat / 3x5 / update: custom(a: 1) {~ state.n = 1 ~}",
  "Squat / 3x5 / update: custom()",
  "Squat / 3x5 / update: nope() {~ ~}",
  "Squat / 3x5 / update:",
  "Squat / 3x5 / progress:",
  "Squat / 3x5 / id:",
  "Squat / 3x5 / id: nope(1)",
  "Squat / 3x5 / id: tags()",
  "Squat / 3x5 / id: tags(a, 2)",
  "Squat / 3x5 / unknownprop: 1",
  "Squat[3] / 3x5",
  "Squat[1-3] / 3x5",
  "Squat[2, 1-3, 5-6] / 3x5",
  "Squat[1-3,5] / 3x5",
  "Squat[3, 4] / 3x5",
  "!Squat | Bench Press / 3x5",
  "Squat | !Bench Press / 3x5",
  "t1: Squat | Bench Press / 3x5",
  "t1: Squat, Barbell / 3x5",
  "Squat, Dumbbell / 3x5",
  "Unknown Exercise / 3x5",
  "Bench Press / 3x5",
  "My Press / 3x5",
  "My Press, Dumbbell / 3x5",
  "Gone Row / 3x5",
  "a: b: Squat / 3x5",
  "Squat / 3x5, 3x8 / 1x3",
  "Squat / !3x5, 3x8 / 1x3",
  "Squat / 3x5 / 3x8",
  "// desc one\n// second\nSquat / 3x5",
  "// desc a\n\n// desc b\nSquat / 3x5",
  "// !current\n\n// other\nSquat / 3x5",
  "//   indented\n//     more\nSquat / 3x5",
  "/// triple\n// d\nSquat / 3x5",
  "// d1\nSquat / 3x5\n\n// d2\nBench Press / 3x5",
  "Squat / 3x5\n\nBench Press / 3x5 / used: none\nDeadlift / 1x5",
  "Squat / 3x5 /",
  "Squat",
  "Squat / ",
  "",
  "\n\n",
  "# Week 1",
  "## Day 1",
  "# Week 1\n## Day 1\nSquat / 3x5\n## Day 2\nBench Press / 3x5\n# Week 2\n## Day 1\nSquat / 3x5 / used: none",
  "## Day 1\nSquat / 3x5",
  "# Week 1\nSquat / 3x5",
  "# Week 1\n## Day 1\n// c\n// d\nSquat / 3x5\n# Week 2 ####\n## Day 2",
  "Squat / 3x5 100lb 5lb",
  "Squat / 3 x 5",
  "Squat / @@",
  "Squat / 3x5 {",
  "Squat / 3x5 // trailing",
  "Squat / 🙂 label (ééééééé)",
  "Squat / 3x5 (ééééééééé)",
  "Squät / 3x5 / progress: custom() {~ state.é = 1 ~}",
];
for (const s of hand) {
  for (const mode of ["perday", "full", "onset"]) direct(s, mode, "lb");
  direct(s, "perday", "custom");
  direct(s, "perday", "kg", { day: 3, week: 2, dayInWeek: 2 });
}

// ---- 4. other methods on the day texts

const methodCases: Case[] = [];
function method(name: string, fn: () => any, extra: Case): void {
  const c: Case = { method: name, ...extra };
  try {
    const out = fn();
    c.output = plain(out);
  } catch (e) {
    c.output = errOut(e);
  }
  methodCases.push(c);
}

const sampleTexts = [...new Set(dayTexts)].filter((_, i) => i % 7 === 0).slice(0, 40).concat(hand.slice(0, 40));
for (const t of sampleTexts) {
  const tree = plannerExerciseParser.parse(t);
  const ev = (s: any) => new PlannerExerciseEvaluator(t, s, "perday");
  method("topLineMap", () => ev(lb).topLineMap(tree.topNode), { script: t, settings: "lb" });
  method("hasWeightInUnit", () => ev(lb).hasWeightInUnit(tree.topNode, "kg"), { script: t, settings: "lb", unit: "kg" });
  method("hasWeightInUnit", () => ev(lb).hasWeightInUnit(tree.topNode, "lb"), { script: t, settings: "lb", unit: "lb" });
  method("switchWeightsToUnit", () => ev(kg).switchWeightsToUnit(tree.topNode, kg), { script: t, settings: "kg" });
  method("switchWeightsToUnit", () => ev(lb).switchWeightsToUnit(tree.topNode, lb), { script: t, settings: "lb" });
  method("changeExerciseName", () => ev(lb).changeExerciseName(tree.topNode, "Squat", "Front Squat"), {
    script: t, settings: "lb", from: "Squat", to: "Front Squat",
  });
}
method("applyChangesToScript", () => PlannerExerciseEvaluator.applyChangesToScript("hello world", [[0, 5, "bye"], [6, 11, "all"]]), {
  script: "hello world", ranges: [[0, 5, "bye"], [6, 11, "all"]],
});
for (const [i, t] of hand.entries()) {
  if (i % 9 === 0) {
    method("changeWeightsToCompletedWeights", () => PlannerExerciseEvaluator.changeWeightsToCompletedWeights(t), { script: t });
  }
}

// ---- 5. fnArgsToStateVars / buildProgress

const argLists: string[][] = [
  [], ["increase: 5lb"], ["a: 1", "b+: 2.345", "c: 10%", "d: 5kg"], ["bad"], ["x:"], [":1"], ["a:b:c"], ["k+: 1lb", "k: 2"],
  ["a+b+: 1"], ["a: 1.005"], ["a: abc"], ["a: lb"], ["a: -5lb"], ["a: +5lb"], ["a: 5 lb"], ["a: 5%"], ["a: -12.5%"], ["5"],
  ["a: 1e3"], ["a:  7  "], ["1: 2", "b: 3"], ["a: 1", "a: 2"],
];
const stateCases: Case[] = [];
for (const args of argLists) {
  const c: Case = { args };
  const errors: string[][] = [];
  try {
    const r = PlannerStateVars_fromArgs(args, (m, v) => {
      errors.push([m, v]);
      throw new Error("stop");
    });
    c.collectingThrows = false;
    c.output = plain(r);
  } catch (_e) {
    c.collectingThrows = true;
    c.firstError = errors[0];
  }
  const all: string[][] = [];
  try {
    const r = PlannerStateVars_fromArgs(args, (m, v) => {
      all.push([m, v]);
    });
    c.collected = plain(r);
  } catch (e) {
    c.collectedThrows = String(e);
  }
  c.allErrors = all;
  stateCases.push(c);
}

const progressCases: Case[] = [];
for (const type of ["none", "lp", "dp", "sum", "custom"]) {
  for (const args of [[], ["5lb"], ["5lb", "2", "1", "10lb", "2", "0"], ["5%", "3"], ["30", "5lb"], ["5lb", "8", "12"], ["x"], ["a: 1", "b+: 2"], ["", "", ""], ["5lb", "", "4"], ["5", "7"]]) {
    for (const opts of [{}, { script: "state.a = 1", reuseFullname: "t1" }, { reuseFullname: "" }]) {
      const r = PlannerProgramExercise_buildProgress(type as any, args, opts);
      progressCases.push({ type, args, opts, output: plain(r) });
    }
  }
}

// ---- 6. extractNameParts / PlannerKey_fromFullName

const nameStrings = [
  "Squat", "t1: Squat", "Squat, Barbell", "t1: Squat, Dumbbell", "Bench Press", "Unknown", "a: b: c", "  spaced : Squat  ",
  "Squat | Bench Press", "!Squat | ! Bench Press", "x: Squat | y: Bench Press", "My Press", "My Press, Dumbbell", "Gone Row",
  "", ":", "Squat,", "Squat, Nothing", "bench press, barbell", "Squat|", "|Squat",
];
const nameCases: Case[] = [];
for (const s of nameStrings) {
  for (const sid of ["lb", "custom"]) {
    const exercises = settingsById[sid].exercises;
    nameCases.push({
      str: s,
      settings: sid,
      parts: plain(PlannerExerciseEvaluator.extractNameParts(s, exercises)),
      key: PlannerKey_fromFullName(s, exercises),
    });
  }
}

// ---- 7. ProgramExercise_applyVariables on an evaluated builtin

const applyCases: Case[] = [];
let applyProgram: any = null;
{
  const text = loadBuiltinProgram("gzclp.md");
  reseed();
  const base = forceEvaluateText(text, "gzclp.md", lb);
  const target = base.weeks[0].days[1].exercises.find((e: any) => e.exerciseType != null)!;
  const key = target.key;
  const updateLists: any[][] = [
    [{ type: "numberOfSets", value: { target: ["*", "*", "*", "*"], value: 7, op: "=" } }],
    [{ type: "numberOfSets", value: { target: [1, 2, 1, "*"], value: 2, op: "-=" } }],
    [{ type: "numberOfSets", value: { target: ["*", "*", "*", "*"], value: 0, op: "=" } }],
    [{ type: "numberOfSets", value: { target: ["*", "*", "*", "*"], value: -2, op: "=" } }],
    [{ type: "reps", value: { target: ["*", "*", "*", "*"], value: 4, op: "+=" } }],
    [{ type: "reps", value: { target: [1, 2, 1, 2], value: 9, op: "=" } }],
    [{ type: "minReps", value: { target: ["*", "*", 1, "*"], value: 3, op: "=" } }],
    [{ type: "weights", value: { target: ["*", "*", "*", "*"], value: { value: 100, unit: "lb" }, op: "=" } }],
    [{ type: "weights", value: { target: ["*", "*", "*", "*"], value: { value: 50, unit: "%" }, op: "=" } }],
    [{ type: "weights", value: { target: ["*", "*", "*", "*"], value: { value: 5, unit: "lb" }, op: "+=" } }],
    [{ type: "weights", value: { target: ["*", "*", "*", "*"], value: { value: 10, unit: "%" }, op: "*=" } }],
    [{ type: "weights", value: { target: ["*", "*", "*", "*"], value: 1.1, op: "*=" } }],
    [{ type: "RPE", value: { target: ["*", "*", "*", "*"], value: 8, op: "=" } }],
    [{ type: "RPE", value: { target: ["*", "*", "*", "*"], value: 0.5, op: "+=" } }],
    [{ type: "timers", value: { target: ["*", "*", "*", "*"], value: 90, op: "=" } }],
    [{ type: "setTime", value: { target: ["*", "*", "*", "*"], value: 30, op: "=" } }],
    [{ type: "amraps", value: { target: ["*", "*", "*", "*"], value: 1, op: "=" } }],
    [{ type: "amraps", value: { target: ["*", "*", "*", "*"], value: 0, op: "=" } }],
    [{ type: "logrpes", value: { target: ["*", "*", "*", "*"], value: 1, op: "=" } }],
    [{ type: "askweights", value: { target: ["*", "*", "*", "*"], value: 1, op: "=" } }],
    [{ type: "askweights", value: { target: ["*", "*", "*", "*"], value: 1, op: "+=" } }],
    [{ type: "setVariationIndex", value: { target: ["*", "*", "*", "*"], value: 2, op: "=" } }],
    [{ type: "setVariationIndex", value: { target: ["*", "*", "*", "*"], value: 1, op: "+=" } }],
    [{ type: "setVariationIndex", value: { target: ["*", "*", "*", "*"], value: 5, op: "=" } }],
    [{ type: "setVariationIndex", value: { target: ["*", "*", "*", "*"], value: 0, op: "=" } }],
    [{ type: "setVariationIndex", value: { target: ["*", "*", "*", "*"], value: 1, op: "-=" } }],
    [{ type: "descriptionIndex", value: { target: ["*", "*", "*", "*"], value: 2, op: "=" } }],
    [{ type: "descriptionIndex", value: { target: ["*", "*", "*", "*"], value: 1, op: "+=" } }],
    [{ type: "descriptionIndex", value: { target: ["*", "*", "*", "*"], value: 9, op: "=" } }],
    [{ type: "exerciseVariationIndex", value: { target: ["*", "*", "*", "*"], value: 2, op: "=" } }],
    [
      { type: "numberOfSets", value: { target: ["*", "*", "*", "*"], value: 3, op: "=" } },
      { type: "weights", value: { target: ["*", "*", "*", 1], value: { value: 20, unit: "lb" }, op: "+=" } },
      { type: "setVariationIndex", value: { target: [1, 2, "*", "*"], value: 1, op: "+=" } },
    ],
  ];
  for (const updates of updateLists) {
    const program = JSON.parse(JSON.stringify(canon(norm(base))));
    // ids are random; scrub them so Rust and TS agree
    for (const w of program.weeks) for (const d of w.days) for (const e of d.exercises) e.id = "<uid>";
    if (applyProgram == null) applyProgram = JSON.parse(JSON.stringify(program));
    const live = JSON.parse(JSON.stringify(program));
    let out: any;
    try {
      PE.ProgramExercise_applyVariables(key, live, updates, lb);
      const touched: any[] = [];
      for (const w of live.weeks) for (const d of w.days) for (const e of d.exercises) if (e.key === key) touched.push(e);
      out = { exercises: touched };
    } catch (e) {
      out = errOut(e);
    }
    applyCases.push({ key, updates, output: plain(out) });
  }
}

// ---- 8. small pure helpers of programExercise.ts

const pureCases: Case[] = [];
{
  const text = loadBuiltinProgram("gzclp.md");
  reseed();
  const base = forceEvaluateText(text, "gzclp.md", lb);
  const exercises: any[] = [];
  for (const w of base.weeks) for (const d of w.days) for (const e of d.exercises) exercises.push(e);
  const seenKeys = new Set<string>();
  for (const e of exercises) {
    const k = e.key + "|" + JSON.stringify(e.setVariations).length;
    if (seenKeys.has(k)) continue;
    seenKeys.add(k);
    const clean = (x: any) => { const c = JSON.parse(JSON.stringify(canon(norm(x)))); c.id = "<uid>"; return c; };
    const ex = clean(e);
    const entry: Case = { exercise: ex, key: e.key };
    for (const [name, fn] of Object.entries({
      hasUserPromptedVars: () => PE.ProgramExercise_hasUserPromptedVars(e),
      getQuickAddSets: () => PE.ProgramExercise_getQuickAddSets(e),
      getEnableRpe: () => PE.ProgramExercise_getEnableRpe(e),
      approxTimeMs: () => PE.ProgramExercise_approxTimeMs(e, lb),
      doesUse1RM: () => PE.ProgramExercise_doesUse1RM(e),
      doesUseRPE: () => PE.ProgramExercise_doesUseRPE(e),
      isUsingRm1: () => PE.ProgramExercise_isUsingVariable(e, "rm1"),
      isUsingState: () => PE.ProgramExercise_isUsingVariable(e, "state"),
    })) {
      try {
        entry[name] = plain((fn as any)());
      } catch (err) {
        entry[name] = errOut(err);
      }
    }
    pureCases.push(entry);
  }
  const sets: any[] = [
    { reps: 5, threshold: { value: 0, unit: "lb" }, value: 0.5 },
    { reps: 5, threshold: { value: 0, unit: "lb" }, value: 0.5 },
    { reps: 3, threshold: { value: 100, unit: "kg" }, value: { value: 60, unit: "kg" } },
    { reps: 5, threshold: { value: 0, unit: "lb" }, value: 0.5 },
  ];
  pureCases.push({ groupWarmupsSets: { input: sets, output: plain(PE.ProgramExercise_groupWarmupsSets(sets)) } });
  pureCases.push({ groupWarmupsSets: { input: [], output: plain(PE.ProgramExercise_groupWarmupsSets([])) } });
  const keys = [...new Set(exercises.map((e) => e.key))];
  for (const k of keys.slice(0, 6)) {
    pureCases.push({ weightChanges: { key: k, output: plain(PE.ProgramExercise_weightChanges(base, k)) } });
  }
}

const out = {
  version: 1,
  settings: settingsById,
  evaluate: cases,
  methods: methodCases,
  stateVars: stateCases,
  buildProgress: progressCases,
  names: nameCases,
  applyProgram,
  applyVariables: applyCases,
  pure: pureCases,
};
Deno.writeTextFileSync(dir + "cases_planner_exercise_eval.json", JSON.stringify(out) + "\n");
console.log("evaluate", cases.length, "methods", methodCases.length, "state", stateCases.length, "progress", progressCases.length, "names", nameCases.length, "apply", applyCases.length, "pure", pureCases.length);
