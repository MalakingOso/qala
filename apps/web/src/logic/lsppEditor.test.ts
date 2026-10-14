import { assertEquals } from "@std/assert";
import type {
  LsppDiagnostic,
  LsppDrySet,
  LsppLint,
} from "../../../../packages/lspp/mod.ts";
import {
  caretAfterFormat,
  countIssues,
  describeSets,
  describeWeight,
  dryRunView,
  formatOutcome,
  issuePosition,
  issueSummary,
  toIssues,
} from "./lsppEditor.ts";

const diag = (
  from: number,
  to: number,
  line: number,
  col: number,
  message = "Syntax error",
  suggestion?: string,
): LsppDiagnostic => ({
  from,
  to,
  message,
  line,
  col,
  endLine: line,
  endCol: col + (to - from),
  ...(suggestion ? { suggestion } : {}),
});

const lint = (from: number, to: number, code: string): LsppLint => ({
  ...diag(from, to, 3, 1, `lint ${code}`, "do the other thing"),
  code,
});

const set = (over: Partial<LsppDrySet> = {}): LsppDrySet => ({
  reps: 5,
  minReps: null,
  weight: { value: 245, unit: "lb" },
  isAmrap: false,
  askWeight: false,
  blank: false,
  rpe: null,
  ...over,
});

Deno.test("toIssues merges errors and warnings in text order, errors first on a tie", () => {
  const issues = toIssues(
    [diag(20, 21, 2, 4, "late"), diag(5, 6, 1, 6, "early", "add a rep count")],
    [lint(5, 6, "too-many-sets")],
    100,
  );
  assertEquals(issues.map((i) => [i.severity, i.from, i.message]), [
    ["error", 5, "early"],
    ["warning", 5, "lint too-many-sets"],
    ["error", 20, "late"],
  ]);
  assertEquals(issues[0].suggestion, "add a rep count");
  assertEquals(issues[1].code, "too-many-sets");
  assertEquals(issues[2].suggestion, undefined);
});

Deno.test("toIssues keeps the leftmost error on a line and one warning per rule", () => {
  const issues = toIssues(
    [
      diag(40, 41, 1, 41, "later on the line"),
      diag(25, 26, 1, 26, "first on the line", "add the missing closing }"),
      diag(30, 31, 1, 31, "also later"),
      diag(60, 61, 2, 5, "next line"),
    ],
    [
      lint(3, 4, "mixed-units"),
      lint(7, 8, "mixed-units"),
      lint(8, 9, "unused-state"),
    ],
    100,
  );
  assertEquals(issues.map((i) => [i.severity, i.message]), [
    ["warning", "lint mixed-units"],
    ["warning", "lint unused-state"],
    ["error", "first on the line"],
    ["error", "next line"],
  ]);
});

Deno.test("toIssues keeps every mark inside the text and at least one character wide", () => {
  const [past] = toIssues([diag(90, 95, 4, 1)], [], 40);
  assertEquals([past.from, past.to], [39, 40]);
  const [empty] = toIssues([diag(12, 12, 1, 13)], [], 40);
  assertEquals([empty.from, empty.to], [12, 13]);
  const [spill] = toIssues([diag(30, 80, 1, 31)], [], 40);
  assertEquals([spill.from, spill.to], [30, 40]);
  assertEquals(toIssues([], [], 0), []);
});

Deno.test("counts, summary and position text", () => {
  const issues = toIssues(
    [diag(1, 2, 1, 2), diag(8, 9, 2, 3)],
    [lint(3, 4, "mixed-units")],
    20,
  );
  assertEquals(countIssues(issues), { errors: 2, warnings: 1 });
  assertEquals(issueSummary(issues), "2 errors, 1 warning");
  assertEquals(issueSummary(toIssues([diag(1, 2, 1, 2)], [], 9)), "1 error");
  assertEquals(issueSummary([]), "No errors");
  assertEquals(issuePosition(issues[0]), "1:2");
});

Deno.test("formatOutcome: new text, no change, syntax errors, and unsafe", () => {
  assertEquals(
    formatOutcome({ ok: true, text: "Squat / 3x5\n", changed: true }),
    { text: "Squat / 3x5\n", note: "Formatted." },
  );
  assertEquals(
    formatOutcome({ ok: true, text: "Squat / 3x5\n", changed: false }),
    { note: "Already formatted." },
  );
  assertEquals(
    formatOutcome({
      ok: false,
      reason: "syntax",
      diagnostics: [diag(1, 2, 1, 2)],
    }),
    { note: "Can't format yet. Fix the syntax errors first." },
  );
  assertEquals(
    formatOutcome({
      ok: false,
      reason: "the result would not evaluate the same",
      diagnostics: [],
    }),
    { note: "Left as it was: the result would not evaluate the same" },
  );
});

Deno.test("describeSets collapses runs and spells out reps, weight and RPE", () => {
  assertEquals(describeSets([set(), set(), set()]), "3x5 @ 245 lb");
  assertEquals(
    describeSets([set(), set({ weight: { value: 247.5, unit: "lb" } })]),
    "1x5 @ 245 lb, 1x5 @ 247.5 lb",
  );
  assertEquals(
    describeSets([set({ reps: 12, minReps: 8, weight: null, rpe: 8 })]),
    "1x8-12 RPE 8",
  );
  assertEquals(describeSets([set({ isAmrap: true })]), "1x5+ @ 245 lb");
  assertEquals(
    describeSets([
      set({ weight: null, askWeight: true, blank: true }),
      set({ weight: null, askWeight: true, blank: true }),
    ]),
    "2x5, weight to set",
  );
  assertEquals(describeSets([]), "");
  assertEquals(describeWeight(null), "");
  assertEquals(describeWeight({ value: 100, unit: "kg" }), "100 kg");
});

Deno.test("dryRunView names each session and counts the sets waiting for a weight", () => {
  const view = dryRunView({
    blankSets: 2,
    finalText: "",
    sessions: [
      {
        session: 0,
        day: 1,
        week: 1,
        dayInWeek: 1,
        name: "Day 1: Lower A",
        exercises: [
          { key: "squat_barbell", name: "Squat", sets: [set(), set(), set()] },
          {
            key: "split_squat",
            name: "Split Squat",
            sets: [
              set({ weight: null, blank: true }),
              set({ weight: null, blank: true }),
            ],
          },
        ],
        errors: [],
      },
      {
        session: 1,
        day: 2,
        week: 1,
        dayInWeek: 2,
        name: "Day 2: Upper A",
        exercises: [],
        errors: ["something broke"],
      },
    ],
  });
  assertEquals(view.summary, "2 sessions, 2 sets waiting for a weight");
  assertEquals(view.sessions[0].title, "Week 1 · Day 1: Lower A");
  assertEquals(view.sessions[0].lines, [
    { name: "Squat", sets: "3x5 @ 245 lb" },
    { name: "Split Squat", sets: "2x5, weight to set" },
  ]);
  assertEquals(view.sessions[1].errors, ["something broke"]);
});

Deno.test("caretAfterFormat keeps the line and clamps the column", () => {
  const before = "Squat/3x5   100lb\nBench / 3x5\n";
  const after = "Squat / 3x5 100lb\nBench / 3x5\n";
  // On line 1 at the end of "Squat/3x5   100lb" (17 chars): the new line is the same length.
  assertEquals(caretAfterFormat(before, 17, after), 17);
  // The end of a line that got shorter lands at its new end.
  assertEquals(caretAfterFormat("a    b    c\nx", 11, "a b c\nx"), 5);
  // The start of line 2 stays the start of line 2.
  assertEquals(caretAfterFormat(before, 18, after), 18);
  assertEquals(caretAfterFormat("", 0, ""), 0);
});
