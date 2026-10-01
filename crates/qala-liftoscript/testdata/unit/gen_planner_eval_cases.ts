// deno-lint-ignore-file no-explicit-any
// Generates expected values for the plannerEvaluator / plannerProgram ports by running the
// TS oracle. Run from the repo root:
//   deno run -A --config packages/liftoscript/deno.json \
//     crates/qala-liftoscript/testdata/unit/gen_planner_eval_cases.ts
// Writes cases_planner_eval.json next to this file.
//
// The built-in programs' PlannerEvaluator_forceEvaluate output is already in
// testdata/golden/liftoscript/builtins*/ (the `evaluated` case), so the Rust tests replay those
// directly. This file records what the goldens do not cover: hand-written programs that hit the
// reuse / conflict / repeat error paths, evaluateFull, topLineItems / groupedTopLines, compact and
// generateFullText.
import {
  PlannerEvaluator_evaluateFull,
  PlannerEvaluator_forceEvaluate,
  PlannerProgram_evaluateText,
  PlannerProgram_generateFullText,
  PlannerProgram_isValid,
} from "../../../../packages/liftoscript/mod.ts";
import {
  builtinProgramNames,
  loadBuiltinProgram,
} from "../../../../packages/liftoscript/tests/helpers.ts";
import { canon, liftSettings, reseed } from "../../../../scripts/golden_liftoscript_lib.ts";
import {
  PlannerProgram_compact,
  PlannerProgram_groupedTopLines,
  PlannerProgram_topLineItems,
} from "../../../../packages/liftoscript/src/pages/planner/models/plannerProgram.ts";
import { PlannerEvaluator_changeExerciseName } from "../../../../packages/liftoscript/src/pages/planner/plannerEvaluator.ts";

const dir = new URL(".", import.meta.url).pathname;

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
};
const settingsById: Record<string, any> = { lb, kg, custom };

function plain(v: any): any {
  return JSON.parse(JSON.stringify(canon(v), (_k, x) => (x === undefined ? null : x)));
}

function scrubIds(v: any): any {
  if (Array.isArray(v)) return v.map(scrubIds);
  if (v && typeof v === "object") {
    const out: any = {};
    const isExercise = "fullName" in v && "id" in v && "key" in v;
    for (const [k, x] of Object.entries(v)) out[k] = isExercise && k === "id" ? "<uid>" : scrubIds(x);
    return out;
  }
  return v;
}

function errOut(e: any): any {
  return {
    message: e?.message ?? String(e),
    ...(e && "line" in e ? { line: e.line, offset: e.offset, from: e.from, to: e.to, details: e.details } : {}),
  };
}

function norm(v: any): any {
  if (v instanceof Set) return [...v];
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") {
    const out: any = {};
    for (const [k, x] of Object.entries(v)) out[k] = norm(x);
    return out;
  }
  return v;
}

function either(r: any): any {
  if (r.success) return { success: true, data: scrubIds(plain(norm(r.data))) };
  return { success: false, error: plain(errOut(r.error)) };
}

function run(fn: () => any): any {
  try {
    return { ok: scrubIds(plain(norm(fn()))) };
  } catch (e) {
    return { throws: String((e as any)?.constructor?.name ?? "Error"), message: String((e as any)?.message ?? e) };
  }
}

// ---- programs

const H = (...days: string[]) => days.join("\n");
const programs: Record<string, string> = {
  repeat_basic: H(
    "# Week 1",
    "## Day 1",
    "Squat[1-3] / 3x5 100lb / progress: lp(5lb)",
    "Bench Press / 3x5",
    "## Day 2",
    "Deadlift / 1x5",
    "# Week 2",
    "## Day 1",
    "Bench Press / 3x8",
    "## Day 2",
    "Deadlift / 1x3",
    "# Week 3",
    "## Day 1",
    "## Day 2",
  ),
  repeat_order: H(
    "# Week 1",
    "## Day 1",
    "// d1",
    "Squat[2] / 3x5",
    "Bench Press[3] / 3x5",
    "# Week 2",
    "## Day 1",
    "Overhead Press / 3x5",
    "# Week 3",
    "## Day 1",
    "Deadlift / 1x5",
  ),
  repeat_sparse: H(
    "# Week 1",
    "## Day 1",
    "Squat[1-4] / 3x5 / progress: lp(5lb)",
    "# Week 2",
    "## Day 1",
    "Squat / 3x8 / progress: lp(5lb)",
    "# Week 3",
    "## Day 1",
    "Bench Press / 3x5",
    "# Week 4",
    "## Day 1",
  ),
  repeat_template: H(
    "# Week 1",
    "## Day 1",
    "tmpl[1-3] / used: none / 3x5 / progress: lp(5lb)",
    "Squat / ...tmpl",
    "# Week 2",
    "## Day 1",
    "# Week 3",
    "## Day 1",
  ),
  repeat_reuse_across_weeks: H(
    "# Week 1",
    "## Day 1",
    "t1 / used: none / 3x5 / progress: custom(n: 1) {~ weights += 5lb ~}",
    "Squat[1-3] / ...t1",
    "# Week 2",
    "## Day 1",
    "# Week 3",
    "## Day 1",
    "Squat / 3x8",
  ),
  reuse_sets: H(
    "# Week 1",
    "## Day 1",
    "t1 / used: none / 3x5 100lb / progress: lp(5lb)",
    "Squat / ...t1",
    "Bench Press / ...t1 / 2x8",
    "## Day 2",
    "Deadlift / ...t1[1:1]",
    "Overhead Press / ...t1 / warmup: 1x5 50%",
  ),
  reuse_sets_update: H(
    "# Week 1",
    "## Day 1",
    "t1 / used: none / 3x5 100lb / progress: custom(n: 0) {~ weights += 5lb ~} / update: custom() {~ state.n = 1 ~}",
    "Squat / ...t1",
    "Bench Press / ...t1 / 2x8",
  ),
  reuse_week_day: H(
    "# Week 1",
    "## Day 1",
    "Squat / 3x5",
    "## Day 2",
    "Squat / 5x5",
    "# Week 2",
    "## Day 1",
    "Bench Press / ...Squat[1:2]",
    "Deadlift / ...Squat[1:1] / @8",
    "Overhead Press / ...Squat[1]",
  ),
  reuse_week_default: H(
    "# Week 1",
    "## Day 1",
    "Squat / 3x5",
    "Bench Press / ...Squat",
    "# Week 2",
    "## Day 1",
    "Squat / 3x8",
    "Deadlift / ...Squat",
  ),
  reuse_missing: H("# Week 1", "## Day 1", "Squat / ...nope", "Bench Press / 3x5"),
  reuse_missing_week: H("# Week 1", "## Day 1", "Squat / 3x5", "# Week 2", "## Day 1", "Bench Press / ...Squat[3:1]"),
  reuse_ambiguous: H(
    "# Week 1",
    "## Day 1",
    "Squat / 3x5",
    "## Day 2",
    "Squat / 3x8",
    "## Day 3",
    "Bench Press / ...Squat",
  ),
  reuse_self: H("# Week 1", "## Day 1", "Squat / ...Squat"),
  reuse_self_other_week: H("# Week 1", "## Day 1", "Squat / 3x5", "# Week 2", "## Day 1", "Squat / ...Squat[1]"),
  reuse_chained: H(
    "# Week 1",
    "## Day 1",
    "a: Squat / ...b: Bench Press",
    "b: Bench Press / ...c: Deadlift",
    "c: Deadlift / 3x5",
  ),
  reuse_multi_variation: H(
    "# Week 1",
    "## Day 1",
    "t1: Squat | Bench Press / 3x5",
    "Deadlift / ...t1: Squat | Bench Press",
  ),
  reuse_without_own_progress: H(
    "# Week 1",
    "## Day 1",
    "t1 / used: none / 3x5 / progress: custom(a: 1) {~ weights += state.a ~}",
    "t2 / 3x5 / ...t1 / progress: custom(a: 2) { ...t1 }",
    "Deadlift / ...t2 / 1x5",
  ),
  reuse_without_own_update: H(
    "# Week 1",
    "## Day 1",
    "t1 / used: none / 3x5 / update: custom() {~ weights += 5lb ~}",
    "t2 / 3x5 / ...t1 / update: custom() { ...t1 }",
    "Deadlift / ...t2 / 1x5",
  ),
  reuse_progress_chain: H(
    "# Week 1",
    "## Day 1",
    "t1 / used: none / 3x5 / progress: custom(a: 1) {~ weights += state.a ~}",
    "t2 / used: none / ...t1 / progress: custom(a: 2) { ...t1 }",
    "Deadlift / ...t2 / 1x5",
  ),
  reuse_progress_chain_bad: H(
    "# Week 1",
    "## Day 1",
    "t1 / used: none / 3x5 / progress: custom(a: 1) {~ weights += state.a ~}",
    "t2: Bench Press / 3x5 / progress: custom(a: 2) { ...t1 }",
    "Deadlift / 1x5 / progress: custom(a: 3) { ...t2: Bench Press }",
  ),
  reuse_progress_own: H("# Week 1", "## Day 1", "a: Squat / 3x5 / progress: custom(a: 1) { ...a: Squat }"),
  reuse_progress_own_week2: H(
    "# Week 1",
    "## Day 1",
    "Squat / 3x5 / progress: custom(a: 1) {~ weights += 5lb ~}",
    "# Week 2",
    "## Day 1",
    "Squat / 3x5 / progress: custom(a: 1) { ...Squat }",
  ),
  reuse_progress_missing_target: H("# Week 1", "## Day 1", "Squat / 3x5 / progress: custom(a: 1) { ...zzz }"),
  reuse_progress_no_progress: H(
    "# Week 1",
    "## Day 1",
    "t1 / used: none / 3x5",
    "Bench Press / 3x5 / progress: custom(a: 1) { ...t1 }",
  ),
  reuse_progress_not_custom: H(
    "# Week 1",
    "## Day 1",
    "t1 / used: none / 3x5 / progress: lp(5lb)",
    "Bench Press / 3x5 / progress: custom(a: 1) { ...t1 }",
  ),
  reuse_progress_state_mismatch: H(
    "# Week 1",
    "## Day 1",
    "t1 / used: none / 3x5 / progress: custom(a: 1) {~ weights += state.a ~}",
    "Bench Press / 3x5 / progress: custom(a: 5lb) { ...t1 }",
  ),
  reuse_progress_state_key_quirk: H(
    "# Week 1",
    "## Day 1",
    "t1 / used: none / 3x5 / progress: custom(a: 1) {~ weights += state.a ~}",
    "Bench Press / 3x5 / progress: custom(a: 5lb, t1: 1) { ...t1 }",
  ),
  reuse_progress_cycle: H(
    "# Week 1",
    "## Day 1",
    "a / used: none / 3x5 / progress: custom() { ...b }",
    "b / used: none / 3x5 / progress: custom() { ...a }",
  ),
  reuse_progress_cycle_used: H(
    "# Week 1",
    "## Day 1",
    "a: Squat / 3x5 / progress: custom() { ...b: Bench Press }",
    "b: Bench Press / 3x5 / progress: custom() { ...a: Squat }",
  ),
  reuse_progress_script_not_found: H(
    "# Week 1",
    "## Day 1",
    "a / used: none / 3x5 / progress: custom() { ...b }",
    "b / used: none / 3x5 / progress: custom() { ...c }",
    "c / used: none / 3x5 / progress: custom() { ...d }",
    "d / used: none / 3x5 / progress: custom() {~ weights += 5lb ~}",
    "Squat / 3x5 / progress: custom() { ...a }",
  ),
  reuse_update: H(
    "# Week 1",
    "## Day 1",
    "t1 / used: none / 3x5 / progress: custom(n: 0) {~ weights += 5lb ~} / update: custom() {~ state.n += 1 ~}",
    "Bench Press / ...t1 / progress: custom(n: 3) { ...t1 } / update: custom() { ...t1 }",
    "Deadlift / 1x5 / progress: custom(n: 3) {~ weights += 5lb ~} / update: custom() { ...t1 }",
  ),
  reuse_update_errors: H(
    "# Week 1",
    "## Day 1",
    "t1 / used: none / 3x5 / progress: custom(n: 0) {~ weights += 5lb ~} / update: custom() {~ state.n += 1 ~}",
    "Bench Press / 3x5 / progress: custom(m: 0) {~ weights += 5lb ~} / update: custom() { ...t1 }",
  ),
  reuse_update_no_progress: H(
    "# Week 1",
    "## Day 1",
    "t1 / used: none / 3x5 / progress: custom(n: 0) {~ weights += 5lb ~} / update: custom() {~ state.n += 1 ~}",
    "Bench Press / 3x5 / update: custom() { ...t1 }",
  ),
  reuse_update_missing: H("# Week 1", "## Day 1", "Squat / 3x5 / update: custom() { ...zzz }"),
  reuse_update_own: H("# Week 1", "## Day 1", "a: Squat / 3x5 / update: custom() { ...a: Squat }"),
  reuse_update_no_section: H("# Week 1", "## Day 1", "t1 / used: none / 3x5", "Bench Press / 3x5 / update: custom() { ...t1 }"),
  reuse_update_chain: H(
    "# Week 1",
    "## Day 1",
    "t1 / used: none / 3x5 / update: custom() {~ weights += 5lb ~}",
    "t2 / used: none / 3x5 / update: custom() { ...t1 }",
    "Squat / 3x5 / update: custom() { ...t2 }",
  ),
  update_syntax_error: H(
    "# Week 1",
    "## Day 1",
    "Squat / 3x5 / update: custom() {~",
    "  if (setIndex == 1) {",
    "    weights = (",
    "  }",
    "~}",
  ),
  update_syntax_error_week2: H(
    "# Week 1",
    "## Day 1",
    "Squat / 3x5",
    "# Week 2",
    "## Day 1",
    "Bench Press / 3x5 / update: custom() {~ weights = completedWeights[1] +* 2 ~}",
  ),
  update_state: H(
    "# Week 1",
    "## Day 1",
    "Squat / 3x5 / progress: custom(n: 1) {~ weights += 5lb ~} / update: custom() {~ state.n = 2 ~}",
  ),
  update_state_missing: H(
    "# Week 1",
    "## Day 1",
    "Squat / 3x5 / progress: custom(m: 1) {~ weights += 5lb ~} / update: custom() {~ state.n = 2 ~}",
  ),
  description_reuse: H(
    "# Week 1",
    "## Day 1",
    "// Main lift",
    "t1: Squat / 3x5",
    "// ...t1: Squat",
    "Bench Press / 3x5",
    "# Week 2",
    "## Day 1",
    "// ...t1: Squat[1]",
    "Squat / 3x8",
  ),
  description_reuse_chain: H(
    "# Week 1",
    "## Day 1",
    "// d",
    "t1: Squat / 3x5",
    "// ...t1: Squat",
    "t2: Bench Press / 3x5",
    "// ...t2: Bench Press",
    "Deadlift / 3x5",
  ),
  description_reuse_self: H("# Week 1", "## Day 1", "// ...t1: Squat", "t1: Squat / 3x5"),
  description_reuse_missing: H("# Week 1", "## Day 1", "// ...zzz", "Squat / 3x5"),
  description_carry: H(
    "# Week 1",
    "## Day 1",
    "// squat desc",
    "Squat / 3x5",
    "# Week 2",
    "## Day 1",
    "Squat / 3x8",
    "# Week 3",
    "## Day 1",
    "// new desc",
    "Squat / 3x8",
  ),
  conflict_id: H("# Week 1", "## Day 1", "Squat / 3x5 / id: tags(1)", "# Week 2", "## Day 1", "Squat / 3x5 / id: tags(2)"),
  conflict_progress: H(
    "# Week 1",
    "## Day 1",
    "Squat / 3x5 / progress: lp(5lb)",
    "# Week 2",
    "## Day 1",
    "Squat / 3x5 / progress: lp(10lb)",
  ),
  conflict_update: H(
    "# Week 1",
    "## Day 1",
    "Squat / 3x5 / progress: custom(n: 0) {~ weights += 5lb ~} / update: custom() {~ state.n = 1 ~}",
    "# Week 2",
    "## Day 1",
    "Squat / 3x5 / update: custom() {~ state.n = 2 ~}",
  ),
  conflict_warmup: H(
    "# Week 1",
    "## Day 1",
    "Squat / 3x5 / warmup: 1x5 50%",
    "# Week 2",
    "## Day 1",
    "Squat / 3x5 / warmup: 1x5 60%",
  ),
  same_props_ok: H(
    "# Week 1",
    "## Day 1",
    "Squat / 3x5 / progress: lp(5lb) / warmup: 1x5 50% / id: tags(1)",
    "# Week 2",
    "## Day 1",
    "Squat / 3x8 / progress: lp(5lb) / warmup: 1x5 50% / id: tags(1)",
    "# Week 3",
    "## Day 1",
    "Squat / 3x8",
  ),
  hoist: H(
    "# Week 1",
    "## Day 1",
    "Squat / 3x5",
    "# Week 2",
    "## Day 1",
    "Squat / 3x8 / progress: custom(n: 0) {~ weights += 5lb ~} / warmup: 1x5 50% / update: custom() {~ state.n = 1 ~}",
    "# Week 3",
    "## Day 1",
    "Squat / 3x3",
  ),
  duplicate_in_day: H("# Week 1", "## Day 1", "Squat / 3x5", "Squat / 3x8"),
  duplicate_label_ok: H("# Week 1", "## Day 1", "a: Squat / 3x5", "b: Squat / 3x8"),
  unknown_exercise: H("# Week 1", "## Day 1", "Squat / 3x5", "Nopeee / 3x5"),
  unknown_variation: H("# Week 1", "## Day 1", "Squat | Nopeee / 3x5"),
  unknown_but_notused: H("# Week 1", "## Day 1", "Nopeee / used: none / 3x5", "Squat / 3x5"),
  variations_ok: H("# Week 1", "## Day 1", "Squat | Bench Press / 3x5", "Deadlift / 3x5"),
  dp_range: H(
    "# Week 1",
    "## Day 1",
    "Squat / 3x5-8 / progress: dp(5lb, 5, 8)",
    "Bench Press / 3x5 / progress: dp(5lb, 5, 8)",
  ),
  warmups: H(
    "# Week 1",
    "## Day 1",
    "Squat / 3x5 / warmup: 1x5 50%, 2x3 100lb, 1x1 60kg",
    "Bench Press / 3x5 / warmup: none",
    "Deadlift / 1x5",
  ),
  globals_and_sets: H(
    "# Week 1",
    "## Day 1",
    "t1 / used: none / 3x5 60s @8, 2x3 80% 90s @9 / progress: lp(5lb)",
    "Squat / ...t1 / 100lb 120s @7+",
    "Bench Press / ...t1 / 50% 60s",
    "Deadlift / ...t1 / 3x8 100lb",
  ),
  day_error: H("# Week 1", "## Day 1", "Squat / 3x5", "## Day 2", "Squat / 3x5 / bogusprop: 1", "## Day 3", "Bench Press / 3x5"),
  day_error_and_reuse: H(
    "# Week 1",
    "## Day 1",
    "t1 / used: none / 3x5",
    "## Day 2",
    "Bench Press / ...t1 / bogusprop: 1",
    "Deadlift / ...t1",
  ),
  empty: "",
  no_week: "Squat / 3x5",
  only_templates: H("# Week 1", "## Day 1", "t1 / used: none / 3x5"),
  custom_exercise: H("# Week 1", "## Day 1", "My Press / 3x5", "My Press, Dumbbell / 3x5 / used: none"),
  full_mode_repeat: H(
    "# Week 1",
    "## Day 1",
    "Squat[1-2] / 3x5",
    "## Day 2",
    "Bench Press / 3x5",
    "# Week 2",
    "## Day 1",
    "Deadlift / 1x5",
    "## Day 2",
  ),
  full_week_desc: H(
    "// week one",
    "# Week 1",
    "// day one",
    "## Day 1",
    "Squat / 3x5",
    "",
    "// week two",
    "// more",
    "# Week 2",
    "## Day 1",
    "Squat / 3x8",
  ),
};

// ---- recording

const cases: any[] = [];
let n = 0;

function plannerOf(text: string) {
  return { vtype: "planner", name: "p", weeks: PlannerProgram_evaluateText(text) };
}

function record(fn: string, name: string, inputs: any, out: () => any) {
  reseed();
  cases.push({ fn, name, inputs, output: run(out) });
  n++;
}

for (const [name, text] of Object.entries(programs)) {
  const planner = plannerOf(text);
  for (const sid of name === "custom_exercise" ? ["custom"] : ["lb"]) {
    const settings = settingsById[sid];
    record("forceEvaluate", name, { planner, settings: sid }, () => {
      const r = PlannerEvaluator_forceEvaluate(planner as any, settings);
      return { evaluatedWeeks: r.evaluatedWeeks.map((w: any[]) => w.map(either)), exerciseFullNames: r.exerciseFullNames };
    });
    record("evaluateFull", name, { text, settings: sid }, () => {
      const r = PlannerEvaluator_evaluateFull(text, settings);
      return {
        evaluatedWeeks: either(r.evaluatedWeeks),
        exerciseFullNames: r.exerciseFullNames,
      };
    });
    record("isValid", name, { planner, settings: sid }, () => PlannerProgram_isValid(planner as any, settings));
    record("topLineItems", name, { planner, settings: sid }, () => PlannerProgram_topLineItems(planner as any, settings));
    record("groupedTopLines", name, { planner, settings: sid }, () =>
      PlannerProgram_groupedTopLines(PlannerProgram_topLineItems(planner as any, settings)),
    );
    record("compact", name, { old: planner, planner, settings: sid, additional: [] }, () =>
      PlannerProgram_compact(JSON.parse(JSON.stringify(planner)), JSON.parse(JSON.stringify(planner)), settings),
    );
  }
  record("generateFullText", name, { weeks: planner.weeks }, () => PlannerProgram_generateFullText(planner.weeks as any));
}
// kg run of a few programs
for (const name of ["repeat_basic", "reuse_sets", "warmups", "globals_and_sets"]) {
  const planner = plannerOf(programs[name]);
  record("forceEvaluate", name + "_kg", { planner, settings: "kg" }, () => {
    const r = PlannerEvaluator_forceEvaluate(planner as any, kg);
    return { evaluatedWeeks: r.evaluatedWeeks.map((w: any[]) => w.map(either)), exerciseFullNames: r.exerciseFullNames };
  });
}

// compact with extra repeating exercises and a rename mapping, on programs with repeats
for (const name of ["repeat_basic", "repeat_order", "repeat_sparse", "repeat_template"]) {
  const planner = plannerOf(programs[name]);
  const modified = JSON.parse(JSON.stringify(planner));
  for (const w of modified.weeks) for (const d of w.days) d.exerciseText = d.exerciseText.replace(/\[[^\]]*\]/g, "");
  record("compact", name + "_stripped", { old: planner, planner: modified, settings: "lb", additional: ["squat_barbell"] }, () =>
    PlannerProgram_compact(
      JSON.parse(JSON.stringify(planner)),
      JSON.parse(JSON.stringify(modified)),
      lb,
      new Set(["squat_barbell"]),
    ),
  );
  const mapping = { squat_barbell: { to: "squat_barbell", dayData: { week: 1, dayInWeek: 1, day: 1 } } };
  record("compact", name + "_rename", { old: planner, planner: modified, settings: "lb", additional: [], mapping }, () =>
    PlannerProgram_compact(JSON.parse(JSON.stringify(planner)), JSON.parse(JSON.stringify(modified)), lb, undefined, mapping as any),
  );
  const described = JSON.parse(JSON.stringify(planner));
  described.weeks.forEach((w: any, wi: number) => w.days.forEach((d: any, di: number) => (d.description = wi === 1 ? "same" : di === 0 ? "same" : "other")));
  record("compact", name + "_descriptions", { old: planner, planner: described, settings: "lb", additional: [] }, () =>
    PlannerProgram_compact(JSON.parse(JSON.stringify(planner)), JSON.parse(JSON.stringify(described)), lb),
  );
}

// top lines and compact on a sample of the built-in programs
const names = builtinProgramNames();
const sample = names.filter((_, i) => i % 5 === 0);
for (const file of sample) {
  const text = loadBuiltinProgram(file);
  const planner = plannerOf(text);
  record("topLineItems", "builtin:" + file, { planner, settings: "lb" }, () => PlannerProgram_topLineItems(planner as any, lb));
  record("groupedTopLines", "builtin:" + file, { planner, settings: "lb" }, () =>
    PlannerProgram_groupedTopLines(PlannerProgram_topLineItems(planner as any, lb)),
  );
  record("compact", "builtin:" + file, { old: planner, planner, settings: "lb", additional: [] }, () =>
    PlannerProgram_compact(JSON.parse(JSON.stringify(planner)), JSON.parse(JSON.stringify(planner)), lb),
  );
  record("generateFullText", "builtin:" + file, { weeks: planner.weeks }, () => PlannerProgram_generateFullText(planner.weeks as any));
  if (file.startsWith("g") || file.startsWith("s")) {
    record("evaluateFull", "builtin:" + file, { text, settings: "lb" }, () => {
      const r = PlannerEvaluator_evaluateFull(text, lb);
      return { evaluatedWeeks: either(r.evaluatedWeeks), exerciseFullNames: r.exerciseFullNames };
    });
  }
}

// changeExerciseName
for (const [text, from, to] of [
  ["Squat / 3x5\nBench Press / 3x5\nSquat / 3x8", "Squat", "Front Squat"],
  ["# Week 1\n## Day 1\nSquat / 3x5", "Squat", "Deadlift"],
  ["t1: Squat / 3x5 / ...Squat", "Squat", "Zzz"],
]) {
  record("changeExerciseName", text.slice(0, 20), { text, from, to, settings: "lb" }, () =>
    PlannerEvaluator_changeExerciseName(text, from, to, lb),
  );
}

Deno.writeTextFileSync(dir + "cases_planner_eval.json", JSON.stringify({ settings: settingsById, cases }));
console.log(`wrote ${n} cases`);
