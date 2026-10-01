// deno-lint-ignore-file no-explicit-any no-unused-vars ban-unused-ignore
// Shared helpers for the golden oracle (determinism, canonical JSON, tree dumps).
// Importing this module installs the Math.random / Date.now stubs.

import { createHash } from "node:crypto";
import {
  builtinProgramNames,
  loadBuiltinProgram,
} from "../packages/liftoscript/tests/helpers.ts";
import {
  forceEvaluateText,
  liftoscriptParser,
  plannerExerciseParser,
  PlannerProgram_evaluateText,
  qalaSettingsToLiftoscript,
} from "../packages/liftoscript/mod.ts";

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

export const PINNED_NOW = 1_700_000_000_000;

/** mulberry32, reseeded before every golden case so cases are independent. */
let prngState = 0;
export function reseed(seed = 12345): void {
  prngState = seed >>> 0;
}
Math.random = () => {
  prngState = (prngState + 0x6D2B79F5) >>> 0;
  let t = prngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
Date.now = () => PINNED_NOW;
reseed();

// ---------------------------------------------------------------------------
// Canonical JSON
// ---------------------------------------------------------------------------

/** Convert to plain JSON-safe data following the canonical rules. */
export function canon(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (value === Infinity) return "Infinity";
    if (value === -Infinity) return "-Infinity";
    if (Object.is(value, -0)) return 0;
    return value;
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (
    typeof value === "bigint" || typeof value === "function" ||
    typeof value === "symbol"
  ) {
    throw new Error(`cannot canonicalize ${typeof value}`);
  }
  const ctor = (value as { constructor?: { name?: string } }).constructor?.name;
  if (ctor === "TreeNode" || ctor === "BufferNode") {
    // A live Lezer SyntaxNode embedded in the evaluated program (the
    // `liftoscriptNode` field of progress/update). It drags in the whole
    // parent chain, so it is reduced to its name and range.
    const n = value as { name: string; from: number; to: number };
    return { "$lezerNode": n.name, from: n.from, to: n.to };
  }
  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      "$error": value.name,
      message: value.message,
    };
    for (const [k, v] of Object.entries(value)) {
      const c = canon(v);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((v) => {
      const c = canon(v);
      return c === undefined ? null : c;
    });
  }
  if (value instanceof Date) throw new Error("Date in golden output");
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const c = canon(v);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

export function toJson(value: unknown, indent: number | undefined): string {
  return JSON.stringify(canon(value), null, indent) + "\n";
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export const ROOT = new URL("../testdata/golden/liftoscript/", import.meta.url)
  .pathname;

export function writeGolden(
  rel: string,
  value: unknown,
  indent = 1,
): void {
  const path = ROOT + rel;
  Deno.mkdirSync(path.substring(0, path.lastIndexOf("/")), { recursive: true });
  const text = toJson(value, indent);
  if (text.length > 5_000_000) {
    console.warn(`WARNING ${rel} is ${text.length} bytes`);
  }
  Deno.writeTextFileSync(path, text);
}

// ---------------------------------------------------------------------------
// Lezer trees
// ---------------------------------------------------------------------------

export interface ITreeNode {
  name: string;
  from: number;
  to: number;
  children: ITreeNode[];
}

// deno-lint-ignore no-explicit-any
export function dumpTree(tree: any): ITreeNode {
  const root: ITreeNode = {
    name: "",
    from: 0,
    to: 0,
    children: [],
  };
  const stack: ITreeNode[] = [root];
  const popMarks: boolean[] = [];
  tree.iterate({
    // deno-lint-ignore no-explicit-any
    enter(n: any) {
      if (!n.name) {
        popMarks.push(false);
        return;
      }
      const node: ITreeNode = {
        name: n.name,
        from: n.from,
        to: n.to,
        children: [],
      };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
      popMarks.push(true);
    },
    leave() {
      if (popMarks.pop()) stack.pop();
    },
  });
  return root.children[0];
}

export interface IParseLog {
  input: string;
  tree: ITreeNode;
}

/** Wrap `parser.parse` so every string input is recorded (deduped, first-seen order). */
// deno-lint-ignore no-explicit-any
export function wrapParser(
  parser: any,
  sink: Map<string, ITreeNode>,
): () => void {
  const orig = parser.parse;
  parser.parse = function (input: unknown, ...rest: unknown[]) {
    const tree = orig.call(this, input, ...rest);
    if (typeof input === "string" && !sink.has(input)) {
      sink.set(input, dumpTree(tree));
    }
    return tree;
  };
  return () => {
    parser.parse = orig;
  };
}

/** Global collectors, active for the whole run. */
export const scriptSink = new Map<string, ITreeNode>();
wrapParser(liftoscriptParser, scriptSink);

export function toLog(m: Map<string, ITreeNode>): IParseLog[] {
  return [...m.entries()].map(([input, tree]) => ({ input, tree }));
}

export function liftSettings(unit: "lb" | "kg" = "lb") {
  return qalaSettingsToLiftoscript(
    { units: { weight: unit, distance: unit === "lb" ? "mi" : "km" } } as never,
  );
}

// ---------------------------------------------------------------------------
// Case builder with uid scrubbing
// ---------------------------------------------------------------------------

export const UID = "<uid>";

/** Paths (dotted, array indices as `[]`) of every field replaced by UID. */
export const uidPaths = new Map<string, Set<string>>();

function jsonClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(canon(v)));
}

function mergeUid(
  a: unknown,
  b: unknown,
  path: string,
  paths: Set<string>,
): unknown {
  if (typeof a === "string" && typeof b === "string") {
    if (a === b) return a;
    paths.add(path);
    return UID;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.map((x, i) => mergeUid(x, b[i], `${path}[]`, paths));
  }
  if (
    a && b && typeof a === "object" && typeof b === "object" &&
    !Array.isArray(a) && !Array.isArray(b)
  ) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.join("\0") !== kb.join("\0")) {
      throw new Error(`structure differs between seeds at ${path}`);
    }
    const out: Record<string, unknown> = {};
    for (const k of ka) {
      out[k] = mergeUid(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        path ? `${path}.${k}` : k,
        paths,
      );
    }
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`value differs between seeds at ${path}`);
  }
  return a;
}

let lastRawOutput: unknown = undefined;
/** Seed-1 output of the most recent makeCase, with real (unscrubbed) ids. */
export function getLastRaw<T = unknown>(): T {
  return JSON.parse(JSON.stringify(lastRawOutput));
}

export interface IGoldenCase {
  fn: string;
  version: 1;
  name: string;
  inputs: unknown;
  output: unknown;
}

/**
 * Build one golden case. `inputs` is frozen to canonical JSON first and `run`
 * always receives a fresh JSON round-trip of it, so Rust replays exactly what
 * TS ran on. `run` executes under two PRNG seeds; strings that differ between
 * the runs are random ids and are replaced by "<uid>".
 * `run` may throw: the thrown error is recorded as `{"$throws": ...}`.
 */
export function makeCase(
  fn: string,
  name: string,
  inputs: unknown,
  // deno-lint-ignore no-explicit-any
  run: (inputs: any) => unknown,
): IGoldenCase {
  const frozen = jsonClone(inputs);
  const exec = (seed: number) => {
    reseed(seed);
    try {
      return jsonClone(run(jsonClone(frozen)));
    } catch (e) {
      const err = e as Error;
      return { "$throws": err.name, message: err.message };
    }
  };
  const a = exec(1);
  lastRawOutput = a;
  const b = exec(2);
  const paths = new Set<string>();
  const output = mergeUid(a, b, "", paths);
  if (paths.size > 0) {
    const set = uidPaths.get(fn) ?? new Set<string>();
    for (const p of paths) set.add(p);
    uidPaths.set(fn, set);
  }
  reseed();
  return { fn, version: 1, name, inputs: frozen, output: shrink(output) };
}

/** Outputs above this many compact-JSON bytes are pruned (see README). */
const MAX_CASE_BYTES = 4_500_000;

function pruneNestedReuse(v: unknown, insideReuse: boolean): unknown {
  if (Array.isArray(v)) return v.map((x) => pruneNestedReuse(x, insideReuse));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "reuse" && insideReuse) continue;
      out[k] = pruneNestedReuse(x, insideReuse || k === "reuse");
    }
    return out;
  }
  return v;
}

function shrink(output: unknown): unknown {
  const full = JSON.stringify(output);
  if (full.length <= MAX_CASE_BYTES) return output;
  const sha256 = createHash("sha256").update(full).digest("hex");
  return {
    "$pruned": "reuse inside reuse removed",
    fullBytes: full.length,
    fullSha256: sha256,
    value: pruneNestedReuse(output, false),
  };
}
