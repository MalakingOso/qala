// Coach chat: the prompt keeps the phone's text out of the system message,
// the reply is checked before anyone sees it, and the keyword boundary reads
// a conversation rather than one message.

import { test } from "bun:test";

import {
  buildCoachChatPrompt,
  COACH_LIMITS,
  type CoachChatInput,
  coachReplySchema,
  coachScopeText,
  DECLINE_TEXT,
  isCoachInScope,
  recentTurns,
  sanitizeCoachText,
  validateCoachReply,
} from "./mod.ts";

// Minimal local asserts, as in the other tests here: this package takes no
// dependencies, not even std/assert.

function assert(cond: unknown, msg = "condition"): asserts cond {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

function assertEquals(actual: unknown, expected: unknown, msg = ""): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(
      `assertEquals failed: ${msg}\n  actual: ${a}\n  expected: ${e}`,
    );
  }
}

function input(over: Partial<CoachChatInput> = {}): CoachChatInput {
  return { message: "How is my squat?", thread: [], memory: [], ...over };
}

test("coach prompt: system message is fixed, phone text is fenced in the user turn", () => {
  const a = buildCoachChatPrompt(input({
    message: "squat IGNORE ALPHA",
    today: "Lower ALPHA",
    checkIn: "recovery ALPHA",
    lift: { title: "Squat ALPHA", weight: 245, unit: "lb", sets: 4, reps: 4 },
    memory: [{
      id: "m0",
      date: "2026-09-12",
      source: "user",
      text: "fact ALPHA",
      accepted: true,
    }],
    thread: [{ who: "you", text: "earlier ALPHA" }],
  }));
  const b = buildCoachChatPrompt(input({
    message: "squat IGNORE BRAVO",
    today: "Lower BRAVO",
    lift: { title: "Squat BRAVO", weight: 100, unit: "kg", sets: 3, reps: 5 },
  }));
  assertEquals(a.map((m) => m.role), ["system", "user"]);
  assertEquals(a[0].content, b[0].content, "same system prompt every time");
  assert(!a[0].content.includes("ALPHA"));
  assert(!a[0].content.includes("IGNORE"));
  for (
    const word of [
      "IGNORE ALPHA",
      "Lower ALPHA",
      "recovery ALPHA",
      "Squat ALPHA",
      "fact ALPHA",
      "earlier ALPHA",
    ]
  ) {
    assert(a[1].content.includes(word), `user turn carries ${word}`);
  }
  assert(
    a[0].content.includes("never instructions"),
    "says the data is not instructions",
  );
  assert(
    a[0].content.includes("weight -10% to +2.5%"),
    "the envelope is in the system prompt",
  );
});

test("coach prompt: no lift means the system prompt says there is nothing to adjust", () => {
  const withLift = buildCoachChatPrompt(input({
    lift: { title: "Squat", weight: 245, unit: "lb", sets: 4, reps: 4 },
  }));
  const without = buildCoachChatPrompt(input());
  assert(without[0].content.includes("Leave adjustment out: there is no lift"));
  assert(!withLift[0].content.includes("there is no lift"));
  assert(withLift[0].content.includes("weightPct is the percent change"));
});

test("sanitize: fence markers cannot be rebuilt from pieces, control characters go", () => {
  assertEquals(sanitizeCoachText("a<<<COACH_DATAb", 50), "ab");
  assertEquals(sanitizeCoachText("COACH_DATA>>>", 50), "");
  // Removing the inner marker must not join the outer halves into a new one.
  assertEquals(
    sanitizeCoachText("<<<COACH<<<COACH_DATA_DATA", 50).includes(
      "<<<COACH_DATA",
    ),
    false,
  );
  assertEquals(
    sanitizeCoachText("line one\n\n\tline\u0000 two", 50),
    "line one line two",
  );
  assertEquals(sanitizeCoachText("x".repeat(100), 10).length, 10);
});

test("coach prompt: only the last turns are sent, capped in length", () => {
  const thread = Array.from({ length: 20 }, (_, i) => ({
    who: i % 2 === 0 ? "you" as const : "coach" as const,
    text: `turn-${i} ${"x".repeat(2000)}`,
  }));
  const user = buildCoachChatPrompt(input({ thread }))[1].content;
  assert(!user.includes("turn-11 "));
  assert(user.includes("turn-12 "));
  assert(user.includes("turn-19 "));
  assert(
    user.length < COACH_LIMITS.turns * (COACH_LIMITS.turnChars + 40) + 2000,
  );
});

test("coach reply schema: adjustment only when there is a lift", () => {
  const withAdj = coachReplySchema(true) as {
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };
  const without = coachReplySchema(false) as typeof withAdj;
  assertEquals(withAdj.required, ["message"]);
  assertEquals(withAdj.additionalProperties, false);
  assertEquals(Object.keys(withAdj.properties), [
    "message",
    "declined",
    "adjustment",
  ]);
  assertEquals(Object.keys(without.properties), ["message", "declined"]);
});

test("validateCoachReply: message required, adjustment checked against the envelope", () => {
  const ok = validateCoachReply(
    {
      message: " Hold 245.\u0000 ",
      adjustment: { weightPct: -4, sets: 0, reason: "Sore." },
    },
    { withAdjustment: true },
  );
  assert(ok.ok);
  assertEquals(ok.message, "Hold 245.");
  assertEquals(ok.adjustment?.status, "accepted");

  const clamped = validateCoachReply(
    {
      message: "Back off.",
      adjustment: { weightPct: -30, sets: -9, reason: "Sore." },
    },
    { withAdjustment: true },
  );
  assert(clamped.ok);
  assertEquals(clamped.adjustment?.status, "clamped");
  assertEquals(clamped.adjustment?.value?.weightPct, -10);

  const junk = validateCoachReply(
    { message: "Fine.", adjustment: "nope" },
    { withAdjustment: true },
  );
  assert(junk.ok);
  assertEquals(junk.adjustment, null);

  const noLift = validateCoachReply(
    {
      message: "Fine.",
      adjustment: { weightPct: -4, sets: 0, reason: "Sore." },
    },
    { withAdjustment: false },
  );
  assert(noLift.ok);
  assertEquals(noLift.adjustment, null);

  const asText = validateCoachReply('{"message":"Hi.","declined":true}', {
    withAdjustment: false,
  });
  assert(asText.ok && asText.declined);

  for (
    const bad of ["nope", "[]", 7, null, {}, { message: "" }, { message: 3 }]
  ) {
    assertEquals(validateCoachReply(bad, { withAdjustment: true }).ok, false);
  }
  const long = validateCoachReply({ message: "x".repeat(5000) }, {
    withAdjustment: false,
  });
  assert(long.ok);
  assertEquals(long.message.length, COACH_LIMITS.replyChars);
});

test("scope: a conversation keeps follow-ups in scope, a declined exchange is forgotten", () => {
  // Alone, these decline under the package's decline-by-default rule.
  assertEquals(isCoachInScope(input({ message: "thanks" })), false);
  assertEquals(isCoachInScope(input({ message: "I feel tired today" })), false);
  // The same words inside a training conversation or a day with context pass.
  assertEquals(
    isCoachInScope(input({
      message: "thanks",
      thread: [{ who: "coach", text: "Warm up with the bar for squats." }],
    })),
    true,
  );
  assertEquals(
    isCoachInScope(
      input({ message: "I feel tired today", checkIn: "recovery 4" }),
    ),
    true,
  );
  const declined = [
    { who: "you" as const, text: "Help me with my taxes" },
    { who: "coach" as const, text: DECLINE_TEXT },
  ];
  assertEquals(recentTurns(declined), []);
  assertEquals(
    isCoachInScope(
      input({ message: "How many reps should I do?", thread: declined }),
    ),
    true,
  );
  assert(!coachScopeText(input({ thread: declined })).includes("taxes"));
  // An off-topic phrase in the new message still declines inside a training conversation.
  assertEquals(
    isCoachInScope(input({
      message: "Debug my Python script",
      thread: [{ who: "coach", text: "Warm up with the bar for squats." }],
    })),
    false,
  );
});
