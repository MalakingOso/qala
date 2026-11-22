// Tests for @qala/llm using a fake transport (no model, no network).
// Covers: clamping of 7 over-envelope adjustments, discard of garbage and the
// persona decline outside topics.

import { test } from "bun:test";

import type { ChatTransport } from "./mod.ts";
import {
  classifyCoachTopic,
  DECLINE_TEXT,
  EnvelopeAdjustSchema,
  validateEnvelopeAdjustment,
} from "./mod.ts";

// Minimal local asserts (no network dependency for std/assert).

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

function assertEquals(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(
      `assertEquals failed: ${msg}\n  actual: ${a}\n  expected: ${e}`,
    );
  }
}

// Fake transport: replays canned JSON responses in order.

function fakeTransport(canned: unknown[]): ChatTransport {
  let i = 0;
  return (_messages, _schema) => {
    if (i >= canned.length) {
      return Promise.reject(new Error("fake transport exhausted"));
    }
    return Promise.resolve(canned[i++]);
  };
}

// Clamping of 7 over-envelope adjustments.

test("envelope: 7 over-envelope adjustments are clamped", async () => {
  const cases: { raw: unknown; weightPct: number; sets: number }[] = [
    {
      raw: { weightPct: -25, sets: 0, reason: "tired" },
      weightPct: -10,
      sets: 0,
    },
    {
      raw: { weightPct: 5, sets: 0, reason: "strong" },
      weightPct: 2.5,
      sets: 0,
    },
    { raw: { weightPct: 0, sets: -5, reason: "sore" }, weightPct: 0, sets: -2 },
    { raw: { weightPct: 0, sets: 3, reason: "fresh" }, weightPct: 0, sets: 1 },
    {
      raw: { weightPct: -11, sets: 2, reason: "beat up" },
      weightPct: -10,
      sets: 1,
    },
    {
      raw: { weightPct: 2.6, sets: -3, reason: "mixed" },
      weightPct: 2.5,
      sets: -2,
    },
    {
      raw: JSON.stringify({
        weightPct: 10,
        sets: 5,
        reason: "raw string output",
      }),
      weightPct: 2.5,
      sets: 1,
    },
  ];
  assertEquals(cases.length, 7, "seven over-envelope cases");
  const chat = fakeTransport(cases.map((c) => c.raw));
  for (const c of cases) {
    const raw = await chat([], EnvelopeAdjustSchema);
    const res = validateEnvelopeAdjustment(raw);
    assertEquals(res.status, "clamped", `clamped: ${JSON.stringify(c.raw)}`);
    assert(res.value !== null, "clamped value present");
    assertEquals(res.value.weightPct, c.weightPct, "weight clamped");
    assertEquals(res.value.sets, c.sets, "sets clamped");
    assertEquals(
      res.log.accepted,
      true,
      "clamped adjustment logged as accepted",
    );
  }
});

test("envelope: in-envelope adjustment accepted unchanged", () => {
  const res = validateEnvelopeAdjustment(
    { weightPct: -5, sets: 1, reason: "mild fatigue" },
  );
  assertEquals(res.status, "accepted", "status accepted");
  assertEquals(
    res.value,
    { weightPct: -5, sets: 1, reason: "mild fatigue" },
    "value kept",
  );
  assertEquals(res.log.accepted, true, "logged as accepted");
});

test("envelope: boundary values accepted unchanged", () => {
  for (
    const raw of [
      { weightPct: -10, sets: -2, reason: "low edge" },
      { weightPct: 2.5, sets: 1, reason: "high edge" },
    ]
  ) {
    const res = validateEnvelopeAdjustment(raw);
    assertEquals(
      res.status,
      "accepted",
      `boundary accepted: ${JSON.stringify(raw)}`,
    );
  }
});

// Discard of garbage.

test("envelope: garbage is discarded and logged", () => {
  const garbage: unknown[] = [
    "not json at all {{{",
    "42",
    "null",
    "[]",
    42,
    null,
    undefined,
    { weightPct: "heavy", sets: 0, reason: "nope" },
    { weightPct: 0, sets: 0 },
    { sets: 1, reason: "missing weight" },
    { weightPct: NaN, sets: 0, reason: "nan" },
    { weightPct: 0, sets: 0, reason: "   " },
    { message: "I am a teapot" },
  ];
  for (const g of garbage) {
    const res = validateEnvelopeAdjustment(g, { promptHash: "deadbeef" });
    assertEquals(
      res.status,
      "discarded",
      `discarded: ${JSON.stringify(String(g)).slice(0, 60)}`,
    );
    assertEquals(res.value, null, "no value on discard");
    assertEquals(res.log.accepted, false, "logged as not accepted");
    assertEquals(res.log.promptHash, "deadbeef", "prompt hash kept in log");
  }
});

// Persona boundary.

test("coach: declines outside topics, keeps inside ones", () => {
  const outside = [
    "File my taxes for me before the deadline",
    "Who should I vote for in the election?",
    "Debug this Rust borrow checker error in my code",
    // No keyword hit either way: the default must be decline, not allow.
    "What's the capital of France?",
    // "pr"/"rep" are substrings of "prepare" but must not count as a hit.
    "Help me prepare my taxes before the deadline",
    // "pr" is a substring of "president" too.
    "Which president should I vote for in the election?",
  ];
  for (const text of outside) {
    const verdict = classifyCoachTopic(text);
    assertEquals(verdict.inScope, false, `out of scope: ${text}`);
  }
  assert(DECLINE_TEXT.length > 0, "decline text non-empty");

  const inside = [
    "How should I warm up for squats today?",
    "My quads are still sore, should I deload this week?",
    "Explain why my tempo run became easy",
    "I slept badly, how does that affect recovery?",
    // Plural forms of the short, boundary-checked keywords must still hit.
    "How many sets and reps should I do today?",
    "I got a new pr on my squat, what's next?",
  ];
  for (const text of inside) {
    assertEquals(classifyCoachTopic(text).inScope, true, `in scope: ${text}`);
  }
});

test("classifier: out-of-scope phrases match whole words, not parts of words", () => {
  for (
    const text of [
      "Give me an example of a deload week",
      "I'm frustrated with my squat",
      "Should I trust the engine on bench?",
      "My syntax for the bar path is off, any tips on my squat?",
    ]
  ) {
    assertEquals(classifyCoachTopic(text).inScope, true, text);
  }
  for (
    const text of [
      "Which stocks should I buy for my training budget?",
      "Help me debugging my Python script after my workout",
      "Can you do my taxes before my run?",
    ]
  ) {
    assertEquals(classifyCoachTopic(text).inScope, false, text);
  }
  assertEquals(classifyCoachTopic("deload exams").inScope, false, "exams");
});
