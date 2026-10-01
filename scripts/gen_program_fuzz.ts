// deno-lint-ignore-file no-explicit-any no-unused-vars ban-unused-ignore
// Program-level differential fuzz oracle for the Rust port of liftoscript.
//
//   deno run -A scripts/gen_program_fuzz.ts
//
// Builds ~600 random valid planner programs (text-level mutations of the 60
// builtins plus small programs generated from the planner grammar), runs the
// TS oracle on them and writes testdata/golden/liftoscript/fuzz/programs_fuzz_NN.json.
// Output is deterministic: a private seeded PRNG drives generation and the
// golden lib's seeded Math.random / pinned Date.now drive the oracle.
// File format and canonical JSON rules: testdata/golden/liftoscript/README.md.
// The replay test is crates/qala-lspp/tests/fuzz_programs.rs.

import {
  builtinProgramNames,
  loadBuiltinProgram,
} from "../packages/liftoscript/tests/helpers.ts";
import {
  Exercise_toKey,
  forceEvaluateText,
  liftoscriptParser,
  plannerExerciseParser,
  PlannerProgram_evaluateText,
  PlannerProgram_generateFullText,
  Program_getProgramDay,
  Program_nextHistoryEntry,
  runAllFinishDayScripts,
  runUpdateScriptForEntry,
  Stats_getEmpty,
  Weight_build,
  Weight_is,
} from "../packages/liftoscript/mod.ts";
import { Program_getProgramExerciseForKeyAndDay } from "../packages/liftoscript/src/models/program.ts";
import {
  canon,
  getLastRaw,
  type IGoldenCase,
  liftSettings,
  makeCase,
  ROOT,
  toJson,
} from "./golden_liftoscript_lib.ts";

type Any = any;

const TOTAL_PROGRAMS = 600;
const BUILTIN_SHARE = 0.55;
const KG_COUNT = 100;
const FINISH_DAY_COUNT = 150;
const CHAIN_COUNT = 40;
/** Max compact-JSON bytes of one evaluated program kept in the fuzz set. */
const MAX_EVAL_BYTES = 90_000;
/** Same cap for programs that get finish-day cases (outputs embed the program). */
const MAX_FINISH_BYTES = 40_000;
const FILE_BYTES = 4_500_000;
const OUT_PREFIX = "fuzz/programs_fuzz_";

// ---------------------------------------------------------------------------
// Private PRNG (independent of the Math.random stub the oracle runs under)
// ---------------------------------------------------------------------------

class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Inclusive integer range. */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

// FUZZ_SEED varies the corpus for exploration; the committed files use the default.
const rng = new Rng(Number(Deno.env.get("FUZZ_SEED") ?? 20261001));

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

const NAMES = [
  "Squat",
  "Bench Press",
  "Deadlift",
  "Overhead Press",
  "Bent Over Row",
  "Lat Pulldown",
  "Bicep Curl",
  "Skullcrusher",
  "Leg Press",
  "Romanian Deadlift",
  "Front Squat",
  "Incline Bench Press",
  "Hammer Curl",
  "Chin Up",
  "Lateral Raise",
  "Triceps Extension",
  "Face Pull",
  "Bench Press, Dumbbell",
  "Romanian Deadlift, Barbell",
  "Seated Leg Curl",
  "Pull Up",
  "Leg Extension",
  "Leg Curl",
  "Preacher Curl",
  "Standing Calf Raise",
  "Lunge",
];

const PROGRESS_POOL = [
  "progress: lp(5lb)",
  "progress: lp(2.5lb)",
  "progress: lp(5lb, 1, 0, 10%, 2, 0)",
  "progress: lp(2.5lb, 2, 0, 15%, 3, 0)",
  "progress: dp(5lb, 8, 12)",
  "progress: dp(2.5lb, 6, 10)",
  "progress: dp(5lb, 10, 20)",
  "progress: dp(10lb, 3, 5)",
  "progress: custom(increment: 5lb) {~\n  if (completedReps >= reps) {\n    weights += state.increment\n  }\n~}",
  "progress: custom(increase: 5lb) {~ if (completedReps >= reps) { weights = completedWeights[ns] + state.increase } ~}",
  "progress: custom(stage: 1, increase: 5lb) {~\n  if (completedReps >= reps) {\n    weights = completedWeights[ns] + state.increase\n  } else if (state.stage == 1) {\n    state.stage = 2\n  } else {\n    state.stage = 1\n    weights = completedWeights[1] * 0.9\n  }\n~}",
  "progress: custom(failures: 0, increase: 5lb) {~\n  if (completedReps >= reps) {\n    weights += state.increase\n    state.failures = 0\n  } else {\n    state.failures += 1\n    if (state.failures >= 3) {\n      weights = weights * 90%\n      state.failures = 0\n    }\n  }\n~}",
  "progress: custom(increment: 2.5lb) {~\n  if (completedRPE[ns] <= 8) {\n    weights += state.increment\n  } else if (completedRPE[ns] >= 10) {\n    weights -= state.increment\n  }\n~}",
  "progress: custom() {~ if (day == 1) { weights *= 1.05 } ~}",
  "progress: custom() {~\n  if (sum(completedReps) >= sum(reps)) {\n    weights += 5lb\n  }\n~}",
  "progress: custom(upper: 12, lower: 8) {~\n  var.total = sum(completedReps)\n  if (var.total >= state.upper * ns) {\n    weights += 5lb\n  } else if (var.total < state.lower * ns) {\n    weights -= 5lb\n  }\n~}",
  "progress: custom() {~\n  for (var.i in completedReps) {\n    if (completedReps[var.i] < reps[var.i]) {\n      var.failed = 1\n    }\n  }\n  if (var.failed == 0) {\n    weights += 5lb\n  }\n~}",
  "progress: custom(increment: 5lb) {~\n  weights[*] = completedReps[ns] >= reps[ns] ? weights[ns] + state.increment : weights[ns]\n~}",
  "progress: custom() {~\n  rm1 = completedWeights[1] / rpeMultiplier(completedReps[1], 10)\n  weights = completedWeights[1] * 0.85\n~}",
  "progress: custom(level: 1) {~\n  if (completedReps >= reps) {\n    state.level += 1\n    setVariationIndex += 1\n  } else {\n    setVariationIndex = 1\n  }\n~}",
  "progress: custom() {~\n  if (descriptionIndex == 1) {\n    descriptionIndex = 2\n  }\n  weights = roundWeight(completedWeights[ns] * 1.025)\n~}",
  "progress: custom() {~ weights = max(weights[1], 45lb) ~}",
];

const UPDATE_POOL = [
  "update: custom() {~ if (setIndex == 1) { weights = completedWeights[1] } ~}",
  "update: custom() {~\n  if (setIndex == 2 && completedReps[setIndex] >= reps[setIndex]) {\n    weights[3] = weights[3] + 5lb\n  }\n~}",
  "update: custom() {~\n  if (completedReps[setIndex] < reps[setIndex]) {\n    weights[setIndex + 1] = weights[setIndex + 1] * 90%\n  }\n~}",
  "update: custom() {~ reps[*] = 5 ~}",
  "update: custom() {~\n  if (setIndex == ns) {\n    weights[1] = completedWeights[setIndex]\n  }\n~}",
];

const WARMUP_POOL = [
  "warmup: none",
  "warmup: 1x5 50%",
  "warmup: 2x5 40%, 1x3 60%, 1x1 80%",
  "warmup: 5 45lb, 3 95lb",
  "warmup: 1x5 45lb, 1x3 60%",
  "warmup: 5 40%, 3 60%",
];

const LABELS = ["AMRAP", "Back", "Heavy", "RstPause", "Top", "Drop"];
const COMMENTS = [
  "// note",
  "// Warm up well",
  "/// Day description",
  "//",
  "// 5x5, then 1x5+",
];

// Validate every pooled script parses cleanly; fail loudly instead of
// silently producing syntax-error programs.
function treeHasError(parser: Any, text: string): boolean {
  let bad = false;
  parser.parse(text).iterate({
    enter(n: Any) {
      if (n.type.isError) bad = true;
    },
  });
  return bad;
}
for (const s of [...PROGRESS_POOL, ...UPDATE_POOL]) {
  for (const m of s.matchAll(/\{~([\s\S]*?)~\}/g)) {
    if (treeHasError(liftoscriptParser, m[1])) {
      throw new Error(`pooled script has a syntax error: ${m[1]}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Text-level units
// ---------------------------------------------------------------------------

type UnitKind = "week" | "day" | "comment" | "blank" | "exercise";
interface Unit {
  kind: UnitKind;
  text: string; // may span several lines (multi-line script)
}

function toUnits(text: string): Unit[] {
  const lines = text.split("\n");
  const units: Unit[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const t = line.trim();
    if (t === "") {
      units.push({ kind: "blank", text: line });
    } else if (t.startsWith("##")) {
      units.push({ kind: "day", text: line });
    } else if (t.startsWith("#")) {
      units.push({ kind: "week", text: line });
    } else if (t.startsWith("//")) {
      units.push({ kind: "comment", text: line });
    } else {
      // an exercise unit continues while a script block is open
      while (
        line.lastIndexOf("{~") > line.lastIndexOf("~}") && i + 1 < lines.length
      ) {
        i++;
        line += "\n" + lines[i];
      }
      units.push({ kind: "exercise", text: line });
    }
  }
  return units;
}

const fromUnits = (units: Unit[]) => units.map((u) => u.text).join("\n");

/** Split on " / " outside script blocks. Returns null if the unit is opaque. */
function splitSections(text: string): string[] | null {
  if (text.includes("\\")) return null;
  const out: string[] = [];
  let cur = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("{~", i)) {
      const end = text.indexOf("~}", i);
      if (end < 0) return null;
      cur += text.slice(i, end + 2);
      i = end + 2;
      continue;
    }
    if (text.startsWith("//", i)) return null;
    if (text.startsWith(" / ", i)) {
      out.push(cur);
      cur = "";
      i += 3;
      continue;
    }
    cur += text[i];
    i++;
  }
  out.push(cur);
  return out;
}

const isScriptSection = (s: string) => s.includes("{~");
const isPropertySection = (s: string) =>
  /^\s*[A-Za-z_][A-Za-z0-9_]*\s*:/.test(s) || s.includes("...");
/** A section made of set parts, weights, timers etc. */
const isSetsSection = (s: string) =>
  !isScriptSection(s) && !isPropertySection(s) && s.trim() !== "";
const sectionKeyword = (s: string) =>
  s.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/)?.[1];

/** Apply `fn` to the parts of a sets section outside `(label)` groups. */
function mapOutsideLabels(s: string, fn: (part: string) => string): string {
  return s.split(/(\([^)]*\))/).map((p, i) => i % 2 === 1 ? p : fn(p)).join("");
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

const fmtNum = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1);

function randWeightValue(): number {
  return rng.pick([
    2.5,
    5,
    10,
    15,
    20,
    25,
    35,
    45,
    60,
    65,
    95,
    100,
    135,
    145,
    185,
    225,
    315,
    405,
  ]);
}

type SectionMut = (s: string) => string;

const NUM_MUTS: SectionMut[] = [
  // set count (kept small so totals stay well under 30)
  (s) =>
    mapOutsideLabels(
      s,
      (p) =>
        p.replace(/(\d+)(\+?)x(?=\d)/, (_m, _n, plus) =>
          `${rng.int(1, 5)}${plus}x`),
    ),
  // reps and rep ranges
  (s) =>
    mapOutsideLabels(s, (p) =>
      p.replace(/x(\d+)(?:-(\d+))?/, (_m, a, b) => {
        const lo = rng.int(1, 15);
        if (b != null || rng.chance(0.2)) {
          return `x${lo}-${lo + rng.int(1, 5)}`;
        }
        return `x${lo}`;
      })),
  // weights
  (s) =>
    mapOutsideLabels(s, (p) =>
      p.replace(/(\d+(?:\.\d+)?)(lb|kg)/, () => {
        return `${fmtNum(randWeightValue())}${rng.pick(["lb", "lb", "kg"])}`;
      })),
  // percentages
  (s) =>
    mapOutsideLabels(
      s,
      (p) => p.replace(/(\d+(?:\.\d+)?)%/, () => `${rng.int(8, 20) * 5}%`),
    ),
  // rpe
  (s) =>
    mapOutsideLabels(
      s,
      (p) =>
        p.replace(/@(\d+(?:\.\d+)?)/, () =>
          `@${rng.pick([6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10])}`),
    ),
  // timers
  (s) =>
    mapOutsideLabels(
      s,
      (p) =>
        p.replace(
          /(?<![\d|.])(\d+)s(?![|+\w])/,
          () => `${rng.int(2, 20) * 15}s`,
        ),
    ),
  // make the first set group an amrap
  (s) =>
    mapOutsideLabels(
      s,
      (p) =>
        p.replace(
          /(\d+)x(\d+)(?!\d|-|\+)/,
          (m) => rng.chance(0.5) ? `${m}+` : m,
        ),
    ),
  // add a modifier to the first set group
  (s) =>
    s.replace(
      /^(\s*\d+\+?x\d+(?:-\d+)?\+?)/,
      (m) =>
        m +
        rng.pick([
          " @8",
          " 90s",
          " ?+",
          " @8+",
          " 60s|90s",
          " 120s+|?",
          " 85%",
        ]),
    ),
  // add a label to the first set group
  (s) =>
    s.replace(
      /^(\s*\d+\+?x\d+(?:-\d+)?\+?)(?!\s*\()/,
      (m) => `${m} (${rng.pick(LABELS)})`,
    ),
];

/** Returns new sections for one exercise unit, or null if nothing applied. */
function mutateUnitSections(sections: string[]): string[] {
  const out = [...sections];
  const setIdx = out.map((s, i) => isSetsSection(s) && i > 0 ? i : -1).filter((
    i,
  ) => i >= 0);
  const kwIdx = (kw: string) =>
    out.findIndex((s, i) => i > 0 && sectionKeyword(s) === kw);
  const op = rng.int(0, 13);
  switch (op) {
    case 0:
    case 1:
    case 2:
    case 3:
    case 4: {
      if (setIdx.length === 0) break;
      const i = rng.pick(setIdx);
      out[i] = rng.pick(NUM_MUTS)(out[i]);
      break;
    }
    case 5: { // add or replace warmup
      const w = rng.pick(WARMUP_POOL);
      const k = kwIdx("warmup");
      if (k >= 0) out[k] = w;
      else out.splice(rng.int(1, out.length), 0, w);
      break;
    }
    case 6: { // add or replace progress
      const p = rng.pick(PROGRESS_POOL);
      const k = kwIdx("progress");
      if (k >= 0) out[k] = p;
      else out.push(p);
      break;
    }
    case 7: { // remove progress
      const k = kwIdx("progress");
      if (k >= 0) out.splice(k, 1);
      break;
    }
    case 8: { // add or replace update
      const p = rng.pick(UPDATE_POOL);
      const k = kwIdx("update");
      if (k >= 0) out[k] = p;
      else out.push(p);
      break;
    }
    case 9: { // remove update
      const k = kwIdx("update");
      if (k >= 0) out.splice(k, 1);
      break;
    }
    case 10: { // repeat on the name
      const m = out[0].match(/^(.*?)(\[[^\]]*\])?\s*$/s);
      if (m && m[2] == null) {
        out[0] = `${m[1]}${
          rng.pick(["[1,2]", "[1-3]", "[2]", "[1,3-4]", "[2-5]"])
        }`;
      }
      break;
    }
    case 11: { // swap exercise name
      const m = out[0].match(
        /^((?:[A-Za-z0-9_]+: )?)([A-Z][A-Za-z ,]*?)(\[[^\]]*\])?\s*$/,
      );
      if (m) out[0] = `${m[1]}${rng.pick(NAMES)}${m[3] ?? ""}`;
      break;
    }
    case 12: { // append a plain extra sets section
      out.splice(
        rng.int(1, out.length),
        0,
        rng.pick(["60s", "0lb", "3x8", "1x5 @8", "75%", "90s"]),
      );
      break;
    }
    case 13: { // drop a sets section
      if (setIdx.length > 1) out.splice(rng.pick(setIdx), 1);
      break;
    }
  }
  return out;
}

function mutateBuiltin(text: string): string {
  const units = toUnits(text);
  const exIdx = () =>
    units.map((u, i) => u.kind === "exercise" ? i : -1).filter((i) => i >= 0);
  const rate = rng.pick([0.05, 0.15, 0.4, 0.8]);
  for (const i of exIdx()) {
    if (!rng.chance(rate)) continue;
    const sections = splitSections(units[i].text);
    if (!sections) continue;
    const n = rng.int(1, 2);
    let cur = sections;
    for (let k = 0; k < n; k++) cur = mutateUnitSections(cur);
    units[i] = { kind: "exercise", text: cur.join(" / ") };
  }
  // program-level operations
  const ops = rng.int(0, 5);
  for (let k = 0; k < ops; k++) {
    const ex = exIdx();
    if (ex.length === 0) break;
    const i = rng.pick(ex);
    switch (rng.int(0, 10)) {
      case 0: // drop an exercise
        units.splice(i, 1);
        break;
      case 1: { // swap adjacent units
        if (i + 1 < units.length && units[i + 1].kind === "exercise") {
          [units[i], units[i + 1]] = [units[i + 1], units[i]];
        }
        break;
      }
      case 2: // day header
        units.splice(i, 0, {
          kind: "day",
          text: `## ${rng.pick(["Extra", "Day X", "Push", "Legs A"])}`,
        });
        break;
      case 3: // week header
        units.splice(i, 0, {
          kind: "week",
          text: `# ${rng.pick(["Week X", "Deload", "Block 2"])}`,
        });
        break;
      case 4: { // duplicate an exercise line
        units.splice(i, 0, { ...units[i] });
        break;
      }
      case 5:
      case 6: { // reuse line pointing at a template or an exercise
        // targets and the new line stay inside the current day
        let lo = i;
        while (
          lo > 0 && units[lo - 1].kind !== "day" &&
          units[lo - 1].kind !== "week"
        ) lo--;
        let hi = i;
        while (
          hi + 1 < units.length && units[hi + 1].kind !== "day" &&
          units[hi + 1].kind !== "week"
        ) hi++;
        const defs: string[] = [];
        const dayNames = new Set<string>();
        for (let j = lo; j <= hi; j++) {
          if (units[j].kind !== "exercise") continue;
          const sec = splitSections(units[j].text);
          if (!sec) continue;
          const nm = sec[0].replace(/^\s*(?:[A-Za-z0-9_]+: )?/, "").replace(
            /\[[^\]]*\]\s*$/,
            "",
          ).trim();
          dayNames.add(nm);
          if (nm && !nm.includes("|") && !nm.includes("!")) defs.push(nm);
        }
        if (defs.length === 0) break;
        const target = rng.pick(defs);
        const spec = rng.pick(["", "", "", "", "[1]", "[_:1]"]);
        const extra = rng.chance(0.3)
          ? ` / ${rng.pick(PROGRESS_POOL.slice(0, 8))}`
          : "";
        let nm = rng.pick(NAMES);
        for (let k = 0; k < 20 && dayNames.has(nm); k++) nm = rng.pick(NAMES);
        units.splice(i + 1, 0, {
          kind: "exercise",
          text: `${nm} / ...${target}${spec}${extra}`,
        });
        break;
      }
      case 7: { // superset on this and the next exercise line
        if (i + 1 < units.length && units[i + 1].kind === "exercise") {
          const a = splitSections(units[i].text);
          const b = splitSections(units[i + 1].text);
          if (
            a && b && !a.some((s) => sectionKeyword(s) === "superset") &&
            !b.some((s) => sectionKeyword(s) === "superset")
          ) {
            const tag = rng.pick(["ss", "pair", "a1"]);
            units[i] = {
              kind: "exercise",
              text: [...a, `superset: ${tag}`].join(" / "),
            };
            units[i + 1] = {
              kind: "exercise",
              text: [...b, `superset: ${tag}`].join(" / "),
            };
          }
        }
        break;
      }
      case 8: // comment line
        units.splice(i, 0, { kind: "comment", text: rng.pick(COMMENTS) });
        break;
      case 9: // blank line
        units.splice(i, 0, { kind: "blank", text: "" });
        break;
      case 10: { // alternate-variation exercise line
        const sec = splitSections(units[i].text);
        if (
          sec && !sec[0].includes("|") && !sec[0].includes("!") &&
          /^[A-Z]/.test(sec[0])
        ) {
          sec[0] = `${sec[0].replace(/\[[^\]]*\]\s*$/, "")} | ${
            rng.pick(["!", ""])
          }${rng.pick(NAMES)}`;
          units[i] = { kind: "exercise", text: sec.join(" / ") };
        }
        break;
      }
    }
  }
  return fromUnits(units);
}

/** Keep the first `n` weeks of a multi-week program text. */
function keepWeeks(text: string, n: number): string {
  const units = toUnits(text);
  let seen = 0;
  for (let i = 0; i < units.length; i++) {
    if (units[i].kind === "week") {
      seen++;
      if (seen > n) {
        let end = i;
        while (
          end > 0 &&
          (units[end - 1].kind === "comment" || units[end - 1].kind === "blank")
        ) end--;
        return fromUnits(units.slice(0, end)) + "\n";
      }
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// From-scratch generator (planner grammar)
// ---------------------------------------------------------------------------

function genSetGroup(): string {
  const count = rng.int(1, 5);
  const reps = rng.int(1, 15);
  let s: string;
  const form = rng.int(0, 9);
  if (form === 0) s = `${count}+x${reps}`;
  else if (form === 1) s = `${count}x${reps}+`;
  else if (form === 2) s = `${count}x${reps}-${reps + rng.int(1, 4)}`;
  else if (form === 3) s = `${count}x${reps}-${reps + rng.int(1, 4)}+`;
  else s = `${count}x${reps}`;
  const mods: string[] = [];
  if (rng.chance(0.5)) {
    const k = rng.int(0, 5);
    if (k === 0) mods.push(`${fmtNum(randWeightValue())}lb`);
    else if (k === 1) mods.push(`${fmtNum(randWeightValue())}kg`);
    else if (k === 2) mods.push(`${fmtNum(randWeightValue())}lb+`);
    else if (k === 3) mods.push(`${rng.int(8, 20) * 5}%+`);
    else mods.push(`${rng.int(8, 20) * 5}%`);
  }
  if (rng.chance(0.3)) {
    mods.push(rng.pick(["@8", "@7.5", "@9", "@8+", "@10", "@+"]));
  }
  if (rng.chance(0.3)) {
    mods.push(
      rng.pick(["60s", "90s", "180s", "60s|90s", "120s+|?", "30s|60s"]),
    );
  }
  if (rng.chance(0.12)) mods.push("?+");
  if (rng.chance(0.15)) mods.push(`(${rng.pick(LABELS)})`);
  // order of modifiers does not matter to the grammar
  for (let i = mods.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [mods[i], mods[j]] = [mods[j], mods[i]];
  }
  return [s, ...mods].join(" ");
}

function genSets(): string[] {
  const groups = rng.int(1, 3);
  const g: string[] = [];
  for (let i = 0; i < groups; i++) g.push(genSetGroup());
  // sometimes spread the first group across two sections like builtins do
  if (rng.chance(0.25) && !g[0].includes(" (")) {
    const toks = g[0].split(" ");
    if (toks.length > 1) {
      return [toks[0], toks.slice(1).join(" "), ...g.slice(1)];
    }
  }
  return [g.join(", ")];
}

function genScriptSection(kind: "progress" | "update"): string {
  return rng.pick(kind === "progress" ? PROGRESS_POOL : UPDATE_POOL);
}

const BAD_SECTIONS = [
  "progress: dp(5lb, 12, 8)",
  "progress: lp()",
  "progress: nonsense(1)",
  "3x0",
  "0x5",
  "@11",
  "150%",
  "0lb",
  "tempo: 5lb",
  "progress: lp(5lb, 1, 0, 10%)",
];

function genExerciseLine(
  templates: string[],
  defined: string[],
  usedInDay: Set<string>,
  tplSpec: string,
  prior: string[],
): string {
  const sections: string[] = [];
  // names recur across days in real programs, which exercises sibling instances
  let base = prior.length > 0 && rng.chance(0.35)
    ? rng.pick(prior)
    : rng.pick(NAMES);
  for (let k = 0; k < 20 && usedInDay.has(base); k++) base = rng.pick(NAMES);
  usedInDay.add(base);
  prior.push(base);
  let name = base;
  if (rng.chance(0.08)) {
    name = `${rng.pick(NAMES)} | ${rng.chance(0.5) ? "!" : ""}${
      rng.pick(NAMES)
    }`;
  }
  if (rng.chance(0.12)) {
    name += rng.pick(["[1,2]", "[1-3]", "[2]", "[1,3-5]", "[1,2-4]"]);
  }
  if (rng.chance(0.1)) {
    name = `${rng.pick(["t1", "t2", "aux", "acc"])}: ${name}`;
  }
  sections.push(name);
  if (templates.length > 0 && rng.chance(0.35)) {
    const t = rng.pick(templates);
    sections.push(`...${t}${tplSpec}`);
  } else if (defined.length > 0 && rng.chance(0.08)) {
    sections.push(`...${rng.pick(defined)}${tplSpec}`);
  } else {
    sections.push(...genSets());
  }
  if (rng.chance(0.3)) sections.push(rng.pick(WARMUP_POOL));
  if (rng.chance(0.45)) sections.push(genScriptSection("progress"));
  if (rng.chance(0.1)) sections.push(genScriptSection("update"));
  if (rng.chance(0.08)) {
    sections.push(`superset: ${rng.pick(["ss", "pair", "a1"])}`);
  }
  if (rng.chance(0.04)) sections.push(rng.pick(BAD_SECTIONS));
  // property/section order is free in the grammar
  if (rng.chance(0.15) && sections.length > 2) {
    const k = rng.int(2, sections.length - 1);
    [sections[1], sections[k]] = [sections[k], sections[1]];
    if (isPropertySection(sections[1]) && !sections[1].startsWith("...")) {
      // keep it valid: name must stay first, which it does
    }
  }
  return sections.join(" / ");
}

function genProgram(): string {
  const lines: string[] = [];
  const weeks = rng.chance(0.55) ? 1 : rng.int(2, 3);
  const headers = rng.chance(0.85);
  const templates: string[] = [];
  const priorNames: string[] = [];
  const wantTemplates = rng.chance(0.45);
  const genTemplates = () => {
    const n = rng.int(1, 2);
    for (let i = 0; i < n; i++) {
      const t = rng.pick(["main", "t1", "t2", "volume", "heavy"]);
      if (templates.includes(t)) continue;
      const sections = [t, "used: none", ...genSets()];
      if (rng.chance(0.5)) {
        sections.push(genScriptSection("progress"));
        if (rng.chance(0.5)) sections.push(genScriptSection("update"));
      }
      templates.push(t);
      lines.push(sections.join(" / "));
    }
  };
  if (wantTemplates && !headers) genTemplates();
  for (let w = 1; w <= weeks; w++) {
    if (rng.chance(0.15)) lines.push(rng.pick(COMMENTS));
    if (headers) {
      lines.push(
        `# ${
          rng.chance(0.7) ? `Week ${w}` : rng.pick(["Base", "Peak", "Deload"])
        }`,
      );
    }
    const days = headers ? rng.int(1, 4) : 1;
    for (let d = 1; d <= days; d++) {
      if (rng.chance(0.15)) lines.push(rng.pick(COMMENTS));
      if (headers) {
        lines.push(
          `## ${
            rng.chance(0.7)
              ? `Day ${d}`
              : rng.pick(["Push", "Pull", "Legs A", "Upper", "Lower"])
          }`,
        );
      }
      if (wantTemplates && headers && w === 1 && d === 1) genTemplates();
      const tplSpec = headers && !(w === 1 && d === 1) ? "[1:1]" : "";
      const usedInDay = new Set<string>();
      const defined: string[] = [];
      const exs = rng.int(1, 6);
      for (let e = 0; e < exs; e++) {
        const line = genExerciseLine(
          templates,
          defined,
          usedInDay,
          tplSpec,
          priorNames,
        );
        const first = line.split(" / ")[0];
        if (
          /^[A-Z]/.test(first) && !first.includes("|") && !first.includes(":")
        ) {
          defined.push(first.replace(/\[[^\]]*\]\s*$/, ""));
        }
        lines.push(line);
        if (rng.chance(0.06)) lines.push("");
        if (rng.chance(0.06)) lines.push(rng.pick(COMMENTS));
      }
      if (rng.chance(0.3)) lines.push("");
    }
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Candidate screening with the TS oracle
// ---------------------------------------------------------------------------

const settingsLb = liftSettings("lb");
const settingsKg = liftSettings("kg");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

interface Candidate {
  id: string;
  source: "builtin" | "scratch";
  text: string;
  evalBytes: number;
  errorCount: number;
}

function hasHugeSets(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasHugeSets);
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (k === "sets" && Array.isArray(x) && x.length > 30) return true;
      if (hasHugeSets(x)) return true;
    }
  }
  return false;
}

function screen(
  text: string,
): { evalBytes: number; errorCount: number } | null {
  if (text.trim() === "") return null;
  if (treeHasError(plannerExerciseParser, text)) return null;
  try {
    const prog = forceEvaluateText(text, "fuzz.md", clone(settingsLb));
    forceEvaluateText(text, "fuzz.md", clone(settingsKg));
    const weeks = PlannerProgram_evaluateText(text);
    PlannerProgram_generateFullText(weeks);
    const json = JSON.stringify(canon(prog));
    if (json.length > MAX_EVAL_BYTES) return null;
    if (hasHugeSets(prog)) return null;
    return { evalBytes: json.length, errorCount: (prog as Any).errors.length };
  } catch (_e) {
    return null;
  }
}

function buildCandidates(): Candidate[] {
  const builtins = builtinProgramNames().map((f) => ({
    file: f,
    text: loadBuiltinProgram(f),
  }));
  const wantBuiltin = Math.round(TOTAL_PROGRAMS * BUILTIN_SHARE);
  const out: Candidate[] = [];
  const seen = new Set<string>();
  let nb = 0;
  let errPrograms = 0;
  const errQuota = Math.round(TOTAL_PROGRAMS * 0.28);
  const take = (c: { evalBytes: number; errorCount: number } | null) =>
    c != null && (c.errorCount === 0 || errPrograms < errQuota);
  let attempts = 0;
  while (nb < wantBuiltin && attempts < wantBuiltin * 40) {
    attempts++;
    const b = builtins[attempts % builtins.length];
    const mutated = mutateBuiltin(b.text);
    // shrink multi-week programs until they fit the size cap
    const weekCount = toUnits(mutated).filter((u) => u.kind === "week").length;
    const tries = weekCount > 1 ? [rng.int(1, 3), 2, 1] : [0];
    let pick:
      | { text: string; cand: { evalBytes: number; errorCount: number } }
      | null = null;
    for (const w of tries) {
      const t = w > 0 ? keepWeeks(mutated, w) : mutated;
      if (seen.has(t)) continue;
      const c = screen(t);
      if (!c) continue;
      if (c.errorCount === 0) {
        pick = { text: t, cand: c };
        break;
      }
      pick ??= { text: t, cand: c };
    }
    if (!pick || !take(pick.cand)) continue;
    seen.add(pick.text);
    if (pick.cand.errorCount > 0) errPrograms++;
    out.push({
      id: `fz${String(out.length).padStart(3, "0")}`,
      source: "builtin",
      text: pick.text,
      ...pick.cand,
    });
    nb++;
  }
  attempts = 0;
  while (out.length < TOTAL_PROGRAMS && attempts < TOTAL_PROGRAMS * 40) {
    attempts++;
    const text = genProgram();
    if (seen.has(text)) continue;
    const cand = screen(text);
    if (!cand || !take(cand)) continue;
    seen.add(text);
    if (cand.errorCount > 0) errPrograms++;
    out.push({
      id: `fz${String(out.length).padStart(3, "0")}`,
      source: "scratch",
      text,
      ...cand,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Case building
// ---------------------------------------------------------------------------

interface IFixtures {
  programs: Record<string, unknown>;
  settings: Record<string, unknown>;
}
interface Unit_ {
  cases: IGoldenCase[];
  fixtures: IFixtures;
}

const RM1_BY_ID: Record<string, number> = {
  squat: 200,
  benchPress: 150,
  deadlift: 250,
  overheadPress: 110,
};

const throws = (c: IGoldenCase) =>
  c.output != null && typeof c.output === "object" &&
  "$throws" in (c.output as Any);

function usedExercises(prog: Any, day: number): Any[] {
  const pd = Program_getProgramDay(prog, day);
  return (pd?.exercises ?? []).filter((e: Any) =>
    !e.notused && e.exerciseType != null
  );
}

function dayCount(prog: Any): number {
  return prog.weeks.reduce((n: number, w: Any) => n + w.days.length, 0);
}

function newEntry(prog: Any, day: number, key: string, settings: Any): Any {
  const p = clone(prog);
  const pd = Program_getProgramDay(p, day)!;
  const pe = Program_getProgramExerciseForKeyAndDay(p, day, key)!;
  const index = usedExercises(p, day).findIndex((e: Any) => e.key === key);
  return Program_nextHistoryEntry(
    p,
    pd.dayData,
    index,
    pe,
    Stats_getEmpty(),
    settings,
  );
}

type Spec = { mode: string; k?: number };

function randomSpec(): Spec {
  return rng.pick<Spec>([
    { mode: "hit" },
    { mode: "hit" },
    { mode: "miss", k: 1 },
    { mode: "miss", k: 3 },
    { mode: "over", k: 3 },
    { mode: "partial" },
    { mode: "none" },
    { mode: "bump", k: 5 },
  ]);
}

function complete(entry: Any, spec: Spec): Any {
  const e = clone(entry);
  const n = e.sets.length;
  e.sets.forEach((set: Any, i: number) => {
    const last = i === n - 1;
    let reps: number | null = set.reps ?? 0;
    if (spec.mode === "miss" && last) reps = Math.max(0, reps - (spec.k ?? 1));
    else if (spec.mode === "over" && last) reps = reps + (spec.k ?? 1);
    else if (spec.mode === "partial") {
      reps = rng.chance(0.3) ? null : Math.max(0, reps - rng.int(0, 2));
    } else if (spec.mode === "none") reps = null;
    if (reps == null) return;
    const w = set.weight ?? Weight_build(0, "lb");
    set.completedReps = reps;
    let cw = Weight_is(w) ? w : Weight_build(0, "lb");
    if (spec.mode === "bump" && cw.unit !== "%") {
      cw = Weight_build(cw.value + (spec.k ?? 5), cw.unit);
    }
    set.completedWeight = cw;
    set.isCompleted = true;
  });
  return e;
}

function buildUnit(
  cand: Candidate,
  doKg: boolean,
  finish: boolean,
  chain: boolean,
): Unit_ {
  const cases: IGoldenCase[] = [];
  const fixtures: IFixtures = { programs: {}, settings: {} };
  const pid = cand.id;
  const name = `${pid}.md`;
  const text = cand.text;

  const stage = makeCase(
    "PlannerProgram_evaluateText",
    `${pid} stage_planner`,
    { text },
    (i) => PlannerProgram_evaluateText(i.text),
  );
  cases.push(stage);
  const evaluated = makeCase(
    "forceEvaluateText",
    `${pid} evaluated`,
    { programText: text, name, settingsRef: "lb" },
    (i) =>
      forceEvaluateText(
        i.programText,
        i.name,
        clone(i.settingsRef === "kg" ? settingsKg : settingsLb),
      ),
  );
  cases.push(evaluated);
  const probe = getLastRaw<Any>();
  if (doKg) {
    cases.push(makeCase(
      "forceEvaluateText",
      `${pid} evaluated_kg`,
      { programText: text, name, settingsRef: "kg" },
      (i) =>
        forceEvaluateText(
          i.programText,
          i.name,
          clone(i.settingsRef === "kg" ? settingsKg : settingsLb),
        ),
    ));
  }
  const gen = makeCase(
    "PlannerProgram_generateFullText",
    `${pid} generate_full_text`,
    { weeks: stage.output },
    (i) => PlannerProgram_generateFullText(i.weeks),
  );
  cases.push(gen);
  if (typeof gen.output === "string") {
    cases.push(makeCase(
      "PlannerProgram_evaluateText",
      `${pid} roundtrip_stage_planner`,
      { text: gen.output },
      (i) => PlannerProgram_evaluateText(i.text),
    ));
  }

  if (!finish || cand.errorCount > 0 || cand.evalBytes > MAX_FINISH_BYTES) {
    return { cases, fixtures };
  }

  // finish-day scenarios: program evaluated with rm1s, as the golden does
  const settings = liftSettings("lb") as Any;
  for (const week of probe.weeks) {
    for (const day of week.days) {
      for (const e of day.exercises) {
        if (e.exerciseType != null && RM1_BY_ID[e.exerciseType.id] != null) {
          settings.exerciseData[Exercise_toKey(e.exerciseType)] = {
            rm1: Weight_build(RM1_BY_ID[e.exerciseType.id], "lb"),
          };
        }
      }
    }
  }
  const sref = `${pid}_rm1`;
  fixtures.settings[sref] = settings;
  const rm1Case = makeCase(
    "forceEvaluateText",
    `${pid} evaluated_rm1`,
    { programText: text, name, settingsRef: sref },
    (i) =>
      forceEvaluateText(
        i.programText,
        i.name,
        clone(fixtures.settings[i.settingsRef] as Any),
      ),
  );
  cases.push(rm1Case);
  const prog = getLastRaw<Any>();
  fixtures.programs[pid] = prog;
  const stats = Stats_getEmpty();

  const days = dayCount(prog);
  let day = 0;
  const order = Array.from({ length: days }, (_, i) => i + 1);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const d of order) {
    if (usedExercises(prog, d).length > 0) {
      day = d;
      break;
    }
  }
  if (day === 0) return { cases, fixtures };

  const runStep = (
    progId: string,
    stepName: string,
    stepDay: number,
  ): Any | null => {
    const p = fixtures.programs[progId] as Any;
    const ex = usedExercises(p, stepDay);
    const entries: Any[] = [];
    for (const e of ex) {
      try {
        entries.push(
          complete(newEntry(p, stepDay, e.key, settings), randomSpec()),
        );
      } catch (_e) {
        // exercise the oracle cannot build an entry for
      }
    }
    if (entries.length === 0) return null;
    const c = makeCase(
      "runAllFinishDayScripts",
      stepName,
      { programRef: progId, day: stepDay, entries, settingsRef: sref, stats },
      (i) =>
        runAllFinishDayScripts(
          clone(fixtures.programs[i.programRef]) as Any,
          i.day,
          i.entries,
          clone(fixtures.settings[i.settingsRef]) as Any,
          i.stats,
          { onError: () => {} },
        ),
    );
    if (throws(c)) return null;
    cases.push(c);
    return getLastRaw<Any>();
  };

  // Program_nextHistoryEntry for the exercises of the chosen day
  const exs = usedExercises(prog, day).slice(0, 4);
  exs.forEach((e: Any, index: number) => {
    const c = makeCase(
      "Program_nextHistoryEntry",
      `${pid} nextHistoryEntry day ${day} ${e.key}`,
      {
        programRef: pid,
        day,
        exerciseKey: e.key,
        index,
        settingsRef: sref,
        stats,
      },
      (i) => {
        const p = clone(fixtures.programs[i.programRef]) as Any;
        const pd = Program_getProgramDay(p, i.day)!;
        const pe = Program_getProgramExerciseForKeyAndDay(
          p,
          i.day,
          i.exerciseKey,
        )!;
        return Program_nextHistoryEntry(
          p,
          pd.dayData,
          i.index,
          pe,
          i.stats,
          clone(fixtures.settings[i.settingsRef]) as Any,
        );
      },
    );
    if (!throws(c)) cases.push(c);
  });

  // runUpdateScriptForEntry where the exercise carries an update script
  let updates = 0;
  for (const e of usedExercises(prog, day)) {
    if (updates >= 2) break;
    const pe = Program_getProgramExerciseForKeyAndDay(
      clone(prog),
      day,
      e.key,
    ) as Any;
    if (!pe?.update) continue;
    let entry: Any;
    try {
      entry = complete(newEntry(prog, day, e.key, settings), randomSpec());
    } catch (_e) {
      continue;
    }
    const setIndex = rng.int(-1, Math.max(0, entry.sets.length - 1));
    const c = makeCase(
      "runUpdateScriptForEntry",
      `${pid} update day ${day} ${e.key} set ${setIndex}`,
      {
        programRef: pid,
        day,
        exerciseKey: e.key,
        entry,
        otherStates: {},
        setIndex,
        settingsRef: sref,
        stats,
      },
      (i) => {
        const p = clone(fixtures.programs[i.programRef]) as Any;
        const pd = Program_getProgramDay(p, i.day)!;
        const pex = Program_getProgramExerciseForKeyAndDay(
          p,
          i.day,
          i.exerciseKey,
        )!;
        return runUpdateScriptForEntry(
          i.entry,
          pd.dayData,
          pex,
          i.otherStates,
          i.setIndex,
          clone(fixtures.settings[i.settingsRef]) as Any,
          i.stats,
        );
      },
    );
    if (!throws(c)) {
      cases.push(c);
      updates++;
    }
  }

  const after = runStep(pid, `${pid} finish_day day ${day}`, day);
  if (after && chain) {
    const next = after.evaluatedProgram;
    const cid = `${pid}@c1`;
    fixtures.programs[cid] = next;
    const nd = after.nextDay;
    if (typeof nd === "number" && usedExercises(next, nd).length > 0) {
      runStep(cid, `${pid} finish_day chain day ${nd}`, nd);
    } else {
      delete fixtures.programs[cid];
    }
  }
  return { cases, fixtures };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const candidates = buildCandidates();

// choose which programs get kg and finish-day cases (seeded, spread over the set)
function chooseSubset(pool: number[], n: number): Set<number> {
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return new Set(arr.slice(0, n));
}
const all = candidates.map((_, i) => i);
const kgSet = chooseSubset(all, KG_COUNT);
const finishPool = all.filter((i) =>
  candidates[i].errorCount === 0 && candidates[i].evalBytes <= MAX_FINISH_BYTES
);
const finishSet = chooseSubset(finishPool, FINISH_DAY_COUNT);
const chainSet = chooseSubset([...finishSet], CHAIN_COUNT);

// stale files from earlier runs
const outDir = ROOT + "fuzz/";
Deno.mkdirSync(outDir, { recursive: true });
for (const e of Deno.readDirSync(outDir)) {
  if (e.name.startsWith("programs_fuzz")) Deno.removeSync(outDir + e.name);
}

interface FileAcc {
  cases: IGoldenCase[];
  fixtures: IFixtures;
  bytes: number;
}
const newAcc = (): FileAcc => ({
  cases: [],
  fixtures: {
    programs: {},
    settings: { lb: clone(settingsLb), kg: clone(settingsKg) },
  },
  bytes: 0,
});
let acc = newAcc();
let fileNo = 0;
const written: { file: string; cases: number; bytes: number }[] = [];

function flush(): void {
  if (acc.cases.length === 0) return;
  fileNo++;
  const rel = `${OUT_PREFIX}${String(fileNo).padStart(2, "0")}.json`;
  const text = toJson(
    { version: 1, fixtures: acc.fixtures, cases: acc.cases },
    0,
  );
  Deno.writeTextFileSync(ROOT + rel, text);
  written.push({ file: rel, cases: acc.cases.length, bytes: text.length });
  acc = newAcc();
}

const stats = {
  programs: candidates.length,
  builtin: candidates.filter((c) => c.source === "builtin").length,
  withErrors: candidates.filter((c) => c.errorCount > 0).length,
  kg: kgSet.size,
  finishPrograms: 0,
  cases: 0,
};
const byFn = new Map<string, number>();

for (let i = 0; i < candidates.length; i++) {
  const unit = buildUnit(
    candidates[i],
    kgSet.has(i),
    finishSet.has(i),
    chainSet.has(i),
  );
  if (finishSet.has(i) && Object.keys(unit.fixtures.programs).length > 0) {
    stats.finishPrograms++;
  }
  const size = JSON.stringify(unit).length;
  if (acc.bytes + size > FILE_BYTES && acc.cases.length > 0) flush();
  acc.cases.push(...unit.cases);
  Object.assign(acc.fixtures.programs, unit.fixtures.programs);
  Object.assign(acc.fixtures.settings, unit.fixtures.settings);
  acc.bytes += size;
  for (const c of unit.cases) {
    byFn.set(c.fn, (byFn.get(c.fn) ?? 0) + 1);
    stats.cases++;
  }
}
flush();

console.log(
  JSON.stringify(
    { ...stats, byFn: Object.fromEntries(byFn), files: written },
    null,
    1,
  ),
);
