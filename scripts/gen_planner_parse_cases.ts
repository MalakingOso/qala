// Generates randomized valid planner programs from the grammar plus their Lezer trees,
// for the Rust planner parser tests.
//
//   deno run -A scripts/gen_planner_parse_cases.ts
//
// Writes testdata/golden/liftoscript/lezer_trees/planner_fuzz.json as
// [{ input, tree: {name, from, to, children} }]. The PRNG is seeded, so output is
// deterministic. Generated inputs whose Lezer tree contains an error node are dropped.

import { plannerExerciseParser } from "../packages/liftoscript/mod.ts";

interface ITreeNode {
  name: string;
  from: number;
  to: number;
  children: ITreeNode[];
}

// deno-lint-ignore no-explicit-any
function dumpTree(tree: any): ITreeNode {
  const root: ITreeNode = { name: "", from: 0, to: 0, children: [] };
  const stack: ITreeNode[] = [root];
  tree.iterate({
    // deno-lint-ignore no-explicit-any
    enter(n: any) {
      const node: ITreeNode = { name: n.name, from: n.from, to: n.to, children: [] };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    },
    leave() {
      stack.pop();
    },
  });
  return root.children[0];
}

function hasError(n: ITreeNode): boolean {
  return n.name === "⚠" || n.children.some(hasError);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(20260930);
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = <T>(xs: T[]): T => xs[int(0, xs.length - 1)];
const chance = (p: number) => rnd() < p;
const sp = () => pick(["", " ", " ", " ", "  ", "\t"]);

const NAME_WORDS = [
  "Squat", "Bench", "Press", "Deadlift", "Row", "Curl,", "Barbell", "Dumbbell", "Romanian",
  "T-Bar", "Pull-Up", "Overhead", "Cable", "(Wide)x", "Fly", "Crunch", "Snatch", "Zercher",
  "Soleil", "Ångström", "Straße", "café", "日本語", "Press-1", "a_b", "x2", "A.B.", "S&M",
  "Lift:", "Max@8", "5x5ish", "t1", "t2", "none", "auto", "superset", "warmup",
];
const KEYWORDS = ["progress", "update", "warmup", "t1", "x", "custom", "lp", "dp", "sum", "a_1"];
const FN_NAMES = ["lp", "dp", "sum", "custom", "weights", "rpe", "foo_bar"];

function nameText(): string {
  const n = int(1, 3);
  const words: string[] = [];
  for (let i = 0; i < n; i++) words.push(pick(NAME_WORDS));
  return words.join(pick([" ", " ", "  "]));
}

function num(): string {
  return pick(["0", "1", "2", "3", "5", "8", "10", "12", "45", "100", "225", "315"]);
}
function float(): string {
  return pick(["2.5", "7.5", ".5", "0.5", "1.25", "62.5", "100.0"]);
}
function posNum(): string {
  return chance(0.4) ? float() : num();
}
function weight(): string {
  const sign = pick(["", "", "", "+", "-"]);
  return sign + (chance(0.3) ? float() : num()) + pick(["lb", "kg"]);
}
function pct(): string {
  const sign = pick(["", "", "", "+", "-"]);
  return sign + (chance(0.3) ? float() : num()) + "%";
}
function rpe(): string {
  const r = int(0, 5);
  if (r === 0) return "@+";
  if (r === 1) return "@" + posNum() + "+";
  return "@" + posNum();
}
function timer(): string {
  const r = int(0, 3);
  if (r === 0) return num() + "s+|" + num() + "s";
  if (r === 1) return num() + "s|?";
  if (r === 2) return num() + "s|" + num() + "s";
  return num() + "s";
}
function label(): string {
  const n = int(1, 2);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(pick(["amrap", "drop", "back-off", "top,set", "a:b", "Ünï"]));
  return "(" + parts.join(" ") + ")";
}
function setPart(): string {
  const reps = chance(0.2) ? num() + "-" + num() : num();
  const r1 = num() + (chance(0.1) ? "+" : "");
  return r1 + "x" + reps + (chance(0.15) ? "+" : "");
}
function setItem(): string {
  const r = int(0, 11);
  if (r <= 3) return setPart();
  if (r === 4) return weight() + (chance(0.2) ? "+" : "");
  if (r === 5) return pct() + (chance(0.2) ? "+" : "");
  if (r === 6) return rpe();
  if (r === 7) return timer();
  if (r === 8) return label();
  if (r === 9) return "?+";
  if (r === 10) return "auto";
  return setPart();
}
function exerciseSet(): string {
  // Items must start with a set part for readability, but any order is grammatical.
  const n = int(1, 4);
  const items: string[] = [];
  for (let i = 0; i < n; i++) items.push(i === 0 && chance(0.7) ? setPart() : setItem());
  return items.join(pick([" ", " ", "  "]));
}
function exerciseSets(): string {
  const n = int(1, 3);
  const sets: string[] = [];
  for (let i = 0; i < n; i++) sets.push(exerciseSet());
  return (chance(0.1) ? "!" : "") + sets.join(pick([", ", ",", " , "]));
}
function warmupSet(): string {
  const n = int(1, 3);
  const items: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = int(0, 3);
    if (r === 0) items.push(weight().replace(/^[+-]/, ""));
    else if (r === 1) items.push(pct().replace(/^[+-]/, ""));
    else if (r === 2) items.push(num() + "x" + num());
    else items.push(num());
  }
  return items.join(" ");
}
function warmupSets(): string {
  const n = int(1, 3);
  const sets: string[] = [];
  for (let i = 0; i < n; i++) sets.push(warmupSet());
  return sets.join(", ");
}
function fnArg(): string {
  const r = int(0, 9);
  if (r === 0) return weight();
  if (r === 1) return pct();
  if (r === 2) return rpe();
  if (r === 3) return num() + "-" + num();
  if (r === 4) return pick(["", "+", "-"]) + posNum();
  if (r === 5) {
    return pick(KEYWORDS) + pick(["", "", "+"]) + ":" + sp() +
      pick([weight(), pct(), pick(["", "+", "-"]) + posNum()]);
  }
  return posNum();
}
function reuseName(): string {
  return pick(["Squat", "t1", "Bench Press", "_x", "A-B", "Row"]);
}
function weekDay(): string {
  const a = chance(0.2) ? "_" : num();
  const b = chance(0.2) ? "_" : num();
  return "[" + a + (chance(0.5) ? ":" + b : "") + "]";
}
function fnExpr(): string {
  let s = pick(FN_NAMES);
  if (chance(0.8)) {
    const n = int(0, 4);
    const args: string[] = [];
    for (let i = 0; i < n; i++) args.push(fnArg());
    s += "(" + args.join(pick([", ", ",", " , "])) + ")";
  }
  const r = int(0, 3);
  if (r === 0) s += " {~ if (completedReps >= reps) { weights += 5lb } ~}";
  else if (r === 1) s += " {" + sp() + "..." + reuseName() + sp() + "}";
  else if (r === 2) s += "{~ var.x = 1 ~}";
  return s;
}
function property(): string {
  const key = pick(KEYWORDS);
  const r = int(0, 3);
  if (r === 0) return key + ":" + sp() + "none";
  if (r === 1) return key + ":" + sp() + warmupSets();
  return key + ":" + sp() + fnExpr();
}
function section(): string {
  const r = int(0, 9);
  if (r <= 3) return exerciseSets();
  if (r <= 6) return property();
  if (r === 7) return "..." + reuseName() + (chance(0.4) ? weekDay() : "");
  if (r === 8) return "superset:" + sp() + nameText();
  return exerciseSets();
}
function repeat(): string {
  const n = int(1, 3);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(chance(0.3) ? num() + "-" + num() : num());
  return "[" + parts.join(",") + "]";
}
function exerciseLine(): string {
  const nv = chance(0.15) ? 2 : 1;
  const vars: string[] = [];
  for (let i = 0; i < nv; i++) vars.push((chance(0.1) ? "!" : "") + nameText());
  let s = vars.join(pick([" | ", "|", " |"]));
  if (chance(0.15)) s += repeat();
  const ns = int(0, 4);
  for (let i = 0; i < ns; i++) {
    s += pick([" / ", "/", " /  "]);
    if (chance(0.05)) continue; // empty section
    s += section();
    if (chance(0.08)) s += " \\\n";
  }
  if (chance(0.05)) s += " /";
  return s;
}
function line(): string {
  const r = int(0, 14);
  if (r === 0) return "# Week " + int(1, 9);
  if (r === 1) return "## Day " + int(1, 9);
  if (r === 2) return "// " + nameText();
  if (r === 3) return "/// " + nameText();
  if (r === 4) return "";
  return sp() + exerciseLine();
}
function program(): string {
  const n = int(1, 8);
  const lines: string[] = [];
  for (let i = 0; i < n; i++) lines.push(line());
  const eol = chance(0.15) ? "\r\n" : "\n";
  let text = lines.join(eol);
  if (chance(0.5)) text += eol;
  return text;
}

const out: { input: string; tree: ITreeNode }[] = [];
const seen = new Set<string>();
let dropped = 0;
function add(input: string) {
  if (seen.has(input)) return;
  seen.add(input);
  const tree = dumpTree(plannerExerciseParser.parse(input));
  if (hasError(tree)) {
    dropped++;
    return;
  }
  out.push({ input, tree });
}

for (let i = 0; i < 350; i++) add(exerciseLine() + (chance(0.5) ? "\n" : ""));
for (let i = 0; i < 150; i++) add(program());

const path = new URL("../testdata/golden/liftoscript/lezer_trees/planner_fuzz.json", import.meta.url);
Deno.writeTextFileSync(path, JSON.stringify(out));
console.log(`wrote ${out.length} cases (${dropped} dropped for Lezer errors) to ${path.pathname}`);
