// What the program editor shows from the LS++ wasm (DESIGN 7.15): the marks drawn in
// the text and listed under it, the answer to Format, and the dry run as lines of text.
// Pure, so it tests without the wasm or a browser. Rust gives UTF-16 offsets and
// 1-based line and column, which are what CodeMirror and this list use.

import type {
  LsppDiagnostic,
  LsppDryRunResult,
  LsppDrySet,
  LsppFormatResult,
  LsppLint,
  LsppWeight,
} from "../../../../packages/lspp/mod.ts";

export interface EditorIssue {
  severity: "error" | "warning";
  from: number;
  to: number;
  line: number;
  col: number;
  message: string;
  /** A one-line fix idea, when the Rust side has one. */
  suggestion?: string;
  /** Lint rule id, for warnings. */
  code?: string;
}

/** The list under the editor shows this many; the rest are counted. */
export const MAX_LISTED_ISSUES = 6;

function issue(
  d: LsppDiagnostic,
  severity: EditorIssue["severity"],
  docLength: number,
  code?: string,
): EditorIssue {
  let from = Math.min(Math.max(d.from, 0), docLength);
  let to = Math.min(Math.max(d.to, from), docLength);
  // A mark of no width can't be seen. Take the character before it instead.
  if (to === from) {
    if (to < docLength) to += 1;
    else if (from > 0) from -= 1;
  }
  const out: EditorIssue = {
    severity,
    from,
    to,
    line: d.line,
    col: d.col,
    message: d.message,
  };
  if (d.suggestion) out.suggestion = d.suggestion;
  if (code) out.code = code;
  return out;
}

/**
 * Syntax errors and lint warnings as one list in text order. The parser marks several
 * places along one broken line (an unclosed brace gives five), and only the first, the
 * leftmost, is where the line went wrong. So a line keeps one error, and one warning
 * per lint rule; the rest show up once that one is fixed.
 */
export function toIssues(
  errors: readonly LsppDiagnostic[],
  warnings: readonly LsppLint[],
  docLength: number,
): EditorIssue[] {
  const all = [
    ...errors.map((d) => issue(d, "error", docLength)),
    ...warnings.map((d) => issue(d, "warning", docLength, d.code)),
  ].sort((a, b) =>
    a.from - b.from ||
    (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1)
  );
  const seen = new Set<string>();
  return all.filter((i) => {
    const key = `${i.severity}|${i.line}|${i.code ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function countIssues(
  issues: readonly EditorIssue[],
): { errors: number; warnings: number } {
  const errors = issues.filter((i) => i.severity === "error").length;
  return { errors, warnings: issues.length - errors };
}

/** "line:col", as the list prints it. */
export function issuePosition(i: Pick<EditorIssue, "line" | "col">): string {
  return `${i.line}:${i.col}`;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** The pill text for the status row. */
export function issueSummary(issues: readonly EditorIssue[]): string {
  const { errors, warnings } = countIssues(issues);
  if (errors === 0 && warnings === 0) return "No errors";
  const parts: string[] = [];
  if (errors > 0) parts.push(plural(errors, "error"));
  if (warnings > 0) parts.push(plural(warnings, "warning"));
  return parts.join(", ");
}

export interface FormatOutcome {
  /** The new text to put in the editor, when there is one and it differs. */
  text?: string;
  note: string;
}

/** What Format does with the Rust answer, and what it tells the user. */
export function formatOutcome(r: LsppFormatResult): FormatOutcome {
  if (r.ok) {
    return r.changed
      ? { text: r.text, note: "Formatted." }
      : { note: "Already formatted." };
  }
  if (r.reason === "syntax") {
    return { note: "Can't format yet. Fix the syntax errors first." };
  }
  return { note: `Left as it was: ${r.reason}` };
}

/**
 * Where the caret goes when Format replaces the whole text: the same line and column,
 * or the end of that line when it got shorter. Format never adds or removes a line, so
 * the line number holds.
 */
export function caretAfterFormat(
  oldText: string,
  head: number,
  newText: string,
): number {
  const before = oldText.slice(0, head);
  const row = before.split("\n").length - 1;
  const col = head - (before.lastIndexOf("\n") + 1);
  const lines = newText.split("\n");
  const target = Math.min(row, lines.length - 1);
  let pos = 0;
  for (let i = 0; i < target; i++) pos += lines[i].length + 1;
  return pos + Math.min(col, lines[target].length);
}

function numberText(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function describeWeight(w: LsppWeight | null): string {
  return w ? `${numberText(w.value)} ${w.unit}` : "";
}

function setKey(s: LsppDrySet): string {
  return JSON.stringify([
    s.reps,
    s.minReps,
    s.weight,
    s.isAmrap,
    s.blank,
    s.rpe,
  ]);
}

function describeSet(s: LsppDrySet, count: number): string {
  let reps = s.reps === null ? "?" : numberText(s.reps);
  if (s.minReps !== null && s.minReps !== s.reps) {
    reps = `${numberText(s.minReps)}-${reps}`;
  }
  if (s.isAmrap) reps += "+";
  let out = `${count}x${reps}`;
  if (s.weight) out += ` @ ${describeWeight(s.weight)}`;
  else if (s.blank) out += ", weight to set";
  if (s.rpe !== null) out += ` RPE ${numberText(s.rpe)}`;
  return out;
}

/** "3x5 @ 245 lb": runs of identical sets collapse, so five sets of five read as one. */
export function describeSets(sets: readonly LsppDrySet[]): string {
  const parts: string[] = [];
  for (let i = 0; i < sets.length;) {
    let j = i + 1;
    while (j < sets.length && setKey(sets[j]) === setKey(sets[i])) j++;
    parts.push(describeSet(sets[i], j - i));
    i = j;
  }
  return parts.join(", ");
}

export interface DryRunView {
  summary: string;
  sessions: {
    title: string;
    lines: { name: string; sets: string }[];
    errors: string[];
  }[];
}

export function dryRunView(r: LsppDryRunResult): DryRunView {
  const parts = [plural(r.sessions.length, "session")];
  if (r.blankSets > 0) {
    parts.push(`${plural(r.blankSets, "set")} waiting for a weight`);
  }
  return {
    summary: parts.join(", "),
    sessions: r.sessions.map((s) => ({
      title: `Week ${s.week} · ${s.name}`,
      lines: s.exercises.map((e) => ({
        name: e.name,
        sets: describeSets(e.sets),
      })),
      errors: s.errors,
    })),
  };
}
