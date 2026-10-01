// Generates randomized valid liftoscript programs from the grammar plus their Lezer
// trees, for the Rust script parser tests.
//
//   deno run -A scripts/gen_script_parse_cases.ts
//
// Writes testdata/golden/liftoscript/lezer_trees/scripts_fuzz.json as
// [{ input, tree: {name, from, to, children} }]. The PRNG is seeded, so output is
// deterministic.

import { liftoscriptParser } from "../packages/liftoscript/mod.ts";

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
const int = (n: number) => Math.floor(rnd() * n);
const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)];
const chance = (p: number) => rnd() < p;

const NAMES = ["a", "b", "x", "y", "rate", "w1", "my_var", "Total", "n", "sets", "reps", "weights", "RPE", "bar", "i", "k2"];
const FNS = ["floor", "ceil", "round", "min", "max", "sum", "abs", "rm1", "bar"];
const STATE_NAMES = ["x", "bar", "failed", "Count", "w_1"];
const OPS_PLUS = ["+", "-"];
const OPS_TIMES = ["*", "/", "%"];
const OPS_CMP = [">", ">=", "<", "<=", "==", "!="];
const OPS_ANDOR = ["&&", "||"];
const INC = ["+=", "-=", "*=", "/="];
const NUMBERS = ["0", "1", "5", "12", "100", "2.5", ".5", "5.", "1.2.3", "007", "10.25"];

// Whitespace between tokens: mostly spaces, sometimes newlines, comments and skipped tokens.
function ws(): string {
  const r = rnd();
  if (r < 0.55) return " ";
  if (r < 0.7) return "";
  if (r < 0.78) return "  ";
  if (r < 0.86) return "\n";
  if (r < 0.92) return " // c" + int(100) + "\n";
  if (r < 0.95) return ";";
  if (r < 0.98) return " {~ ";
  return " ~} ";
}
// Whitespace that must separate two tokens that would otherwise merge.
const sp = () => pick([" ", "\n", " // sep\n", "  "]);

function number(): string {
  return pick(NUMBERS);
}

function unitNumber(): string {
  const sign = chance(0.2) ? pick(OPS_PLUS) : "";
  return sign + number() + (chance(0.7) ? ws() : "") + pick(["lb", "kg"]);
}

function plainNumber(): string {
  const sign = chance(0.15) ? pick(OPS_PLUS) : "";
  return sign + number();
}

function variable(): string {
  return pick(["var.", "var."]) + pick(NAMES);
}

function stateRef(): string {
  const idx = chance(0.3) ? "[" + ws() + expr(2) + ws() + "]" : "";
  return "state" + idx + "." + pick(STATE_NAMES);
}

function varExpr(depth: number): string {
  const name = pick(NAMES);
  if (chance(0.3)) {
    const parts: string[] = [];
    const n = 1 + (chance(0.3) ? int(2) : 0);
    for (let i = 0; i < n; i++) {
      parts.push(chance(0.25) ? "*" : expr(depth + 1));
    }
    return name + "[" + ws() + parts.join(ws() + ":" + ws()) + ws() + "]";
  }
  return name;
}

function call(depth: number): string {
  const n = int(4);
  const args: string[] = [];
  for (let i = 0; i < n; i++) args.push(expr(depth + 1));
  return pick(FNS) + (chance(0.1) ? " " : "") + "(" + ws() + args.join(ws() + "," + ws()) + ws() + ")";
}

function atom(depth: number): string {
  const r = rnd();
  if (depth > 3 || r < 0.25) return plainNumber();
  if (r < 0.32) return unitNumber();
  if (r < 0.38) return number() + "%";
  if (r < 0.52) return varExpr(depth);
  if (r < 0.58) return variable();
  if (r < 0.64) return stateRef();
  if (r < 0.72) return call(depth);
  if (r < 0.78) return "(" + ws() + expr(depth + 1) + ws() + ")";
  if (r < 0.82) return "!" + (chance(0.3) ? "!" : "") + atom(depth + 1);
  return plainNumber();
}

// Binary operators need non-merging whitespace around signs so `a - 1` and `a -1` both occur.
function binary(depth: number): string {
  let s = atom(depth);
  const n = 1 + int(3);
  for (let i = 0; i < n; i++) {
    const op = pick([...OPS_PLUS, ...OPS_TIMES, ...OPS_CMP, ...OPS_ANDOR, "+", "*"]);
    // "%" glued to a number lexes as a Percentage, so always space it.
    const before = op === "%" ? " " : ws();
    s += before + op + ws() + atom(depth);
  }
  return s;
}

function expr(depth: number): string {
  const r = rnd();
  if (depth > 3) return atom(depth);
  if (r < 0.35) return atom(depth);
  if (r < 0.7) return binary(depth);
  if (r < 0.82) {
    return binary(depth + 1) + ws() + "?" + ws() + expr(depth + 1) + ws() + ":" + ws() + expr(depth + 1);
  }
  if (r < 0.9) return assignment(depth + 1);
  return binary(depth + 1);
}

function lhs(depth: number): string {
  const r = rnd();
  if (r < 0.5) return varExpr(depth);
  if (r < 0.75) return variable();
  return stateRef();
}

function assignment(depth: number): string {
  if (chance(0.3)) return lhs(depth) + ws() + pick(INC) + ws() + expr(depth + 1);
  return lhs(depth) + ws() + "=" + ws() + expr(depth + 1);
}

function block(depth: number): string {
  const n = int(4);
  const stmts: string[] = [];
  for (let i = 0; i < n; i++) stmts.push(stmt(depth + 1));
  return "{" + ws() + stmts.join(sp()) + ws() + "}";
}

function ifStmt(depth: number): string {
  let s = "if" + ws() + "(" + ws() + expr(depth + 1) + ws() + ")" + ws() + block(depth);
  const elifs = int(3);
  for (let i = 0; i < elifs; i++) {
    s += ws() + "else" + sp() + "if" + ws() + "(" + ws() + expr(depth + 1) + ws() + ")" + ws() + block(depth);
  }
  if (chance(0.4)) s += ws() + "else" + ws() + block(depth);
  return s;
}

function forStmt(depth: number): string {
  return "for" + ws() + "(" + ws() + variable() + sp() + "in" + sp() + expr(depth + 1) + ws() + ")" + ws() + block(depth);
}

function stmt(depth: number): string {
  const r = rnd();
  if (depth > 3) return assignment(depth);
  if (r < 0.45) return assignment(depth);
  if (r < 0.6) return ifStmt(depth);
  if (r < 0.7) return forStmt(depth);
  if (r < 0.8) return call(depth);
  return expr(depth);
}

function program(): string {
  const n = 1 + int(4);
  const stmts: string[] = [];
  for (let i = 0; i < n; i++) stmts.push(stmt(0));
  let s = stmts.join(sp());
  if (chance(0.15)) s = "// header\n" + s;
  if (chance(0.15)) s += " // trailing";
  if (chance(0.05)) s = "  " + s + "  \n";
  return s;
}

const N = 400;
const seen = new Set<string>();
const out: { input: string; tree: ITreeNode }[] = [];
while (out.length < N) {
  const input = program();
  if (seen.has(input)) continue;
  seen.add(input);
  out.push({ input, tree: dumpTree(liftoscriptParser.parse(input)) });
}

const path = new URL("../testdata/golden/liftoscript/lezer_trees/scripts_fuzz.json", import.meta.url);
// One case per line keeps the file small and diffs readable.
Deno.writeTextFileSync(path, "[\n" + out.map((e) => JSON.stringify(e)).join(",\n") + "\n]\n");
const errCount = out.filter((e) => JSON.stringify(e.tree).includes('"⚠"')).length;
console.log(`wrote ${out.length} cases (${errCount} contain error nodes)`);
