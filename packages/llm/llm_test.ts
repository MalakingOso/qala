// Tests for @qala/llm using a fake transport (no model, no network).
// Covers: valid check-in JSON, clamping of 7 over-envelope adjustments,
// discard of garbage, persona decline outside topics, memory round-trip,
// and context injection in all 7 prompt builders.

import type { ChatTransport, PromptContext } from "./mod.ts";
import {
  acceptedMemories,
  acceptProposal,
  buildCheckinPrompt,
  buildEnvelopeAdjustPrompt,
  buildExplanationPrompt,
  buildGoalParamsPrompt,
  buildMemoryProposalPrompt,
  buildRecoveryPrompt,
  buildWeeklyNarrativePrompt,
  CheckinParseSchema,
  classifyCoachTopic,
  DECLINE_TEXT,
  declineResponse,
  deserializeProposals,
  EnvelopeAdjustSchema,
  pendingProposals,
  proposeMemories,
  rejectProposal,
  serializeProposals,
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

function testContext(): PromptContext {
  return {
    coachMemory: [
      {
        id: "m1",
        date: "2026-09-01",
        source: "user",
        text: "Prefers morning sessions before work.",
        accepted: true,
      },
    ],
    computedProfile: {
      calibration: "squat p0=100 k1=2.1 theta=4.0 (n=12)",
      recoveryPattern: "quads recover in ~48h, calves slower",
      adherence: "11/12 sessions last 4 weeks",
      prTrend: "bench e1RM +2.5% over 4 weeks",
    },
    fourWeekSummary: {
      sessions: 11,
      runs: 6,
      distanceKm: 42,
      trimp: 980,
      trimpLift: 700,
      trimpRun: 280,
      performancePct: 1.5,
      vdotTrend: "VDOT 38 -> 39",
    },
    engineOutput: {
      kind: "lift",
      recommendation: "Squat 4x5 @ 80%, sets held after soreness 3 on quads.",
      reasons: ["SORENESS_HOLD", "VOLUME_RAMP"],
    },
    envelope: { weightPctMin: -10, weightPctMax: 2.5, setsMin: -2, setsMax: 1 },
  };
}

// Feature 1: valid check-in JSON through the fake transport.

Deno.test("checkin: valid JSON passes through", async () => {
  const ctx = testContext();
  const messages = buildCheckinPrompt(
    ctx,
    "slept 7.5h, quads still sore, 40 min max",
  );
  const chat = fakeTransport([
    { sleepHours: 7.5, timeLimitMin: 40, notes: "quads still sore" },
  ]);
  const out = await chat(messages, CheckinParseSchema) as Record<
    string,
    unknown
  >;
  assertEquals(out["sleepHours"], 7.5, "sleepHours parsed");
  assertEquals(out["timeLimitMin"], 40, "timeLimitMin parsed");
  assert(typeof out["notes"] === "string", "notes present");
});

// Feature 2: clamping of 7 over-envelope adjustments.

Deno.test("envelope: 7 over-envelope adjustments are clamped", async () => {
  const ctx = testContext();
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
    const messages = buildEnvelopeAdjustPrompt(ctx, "Squat 4x5 @ 100kg");
    const raw = await chat(messages, EnvelopeAdjustSchema);
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

Deno.test("envelope: in-envelope adjustment accepted unchanged", () => {
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

Deno.test("envelope: boundary values accepted unchanged", () => {
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

Deno.test("envelope: garbage is discarded and logged", () => {
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

Deno.test("coach: declines outside topics, keeps inside ones", () => {
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
  const decline = declineResponse();
  assertEquals(decline.message, DECLINE_TEXT, "decline text matches");
  assert(decline.message.length > 0, "decline text non-empty");

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

// Memory round-trip.

Deno.test("memory: propose, accept/reject, serialize round-trip", () => {
  const proposals = proposeMemories([
    { text: "Trains best in the morning.", source: "user" },
    { text: "Quads recover slowly after tempo runs.", source: "gemma" },
  ]);
  assertEquals(proposals.length, 2, "two proposals");
  assertEquals(pendingProposals(proposals).length, 2, "both pending");

  const afterAccept = acceptProposal(proposals, proposals[0].id);
  const afterBoth = rejectProposal(afterAccept, proposals[1].id);
  assertEquals(proposals[0].status, "proposed", "input list untouched");
  assertEquals(pendingProposals(afterBoth).length, 0, "none pending");
  assertEquals(acceptedMemories(afterBoth).length, 1, "one accepted");
  assertEquals(
    acceptedMemories(afterBoth)[0].text,
    "Trains best in the morning.",
    "accepted text kept",
  );

  const json = serializeProposals(afterBoth);
  const back = deserializeProposals(json);
  assertEquals(back, afterBoth, "round-trip preserves proposals");
});

// Every builder injects all five context pieces.

Deno.test("prompts: all 7 builders inject full context", () => {
  const ctx = testContext();
  const builders = [
    buildCheckinPrompt(ctx, "tired"),
    buildEnvelopeAdjustPrompt(ctx, "Squat 4x5"),
    buildExplanationPrompt(ctx, "Lower A squat day"),
    buildRecoveryPrompt(ctx, ["RECOVERY_NUDGE"]),
    buildWeeklyNarrativePrompt(ctx),
    buildGoalParamsPrompt(ctx, "get stronger on squat"),
    buildMemoryProposalPrompt(ctx, ["slept well"]),
  ];
  assertEquals(builders.length, 7, "seven builders");
  const needles = [
    "Prefers morning sessions",
    "squat p0=100",
    "11 sessions",
    "Squat 4x5 @ 80%",
    "SORENESS_HOLD",
    "weight -10% to +2.5%",
    "sets -2 to +1",
  ];
  for (const messages of builders) {
    assertEquals(messages.length, 2, "system + user message");
    assertEquals(messages[0].role, "system", "first message is system");
    for (const needle of needles) {
      assert(
        messages[0].content.includes(needle),
        `system prompt injects context (${needle})`,
      );
    }
  }
});
