// POST /api/import/text: fake transport (no network, no model) and the real
// LS++ evaluator as the program check.

import { assert, assertEquals } from "@std/assert";
import type { ChatMessage, ChatTransport } from "../packages/llm/mod.ts";
import {
  type ImportRouteDeps,
  liveImportDeps,
  llamaTransport,
  MAX_IMPORT_BODY_BYTES,
  serveImportText,
} from "./import.ts";

const live = await liveImportDeps("http://127.0.0.1:1");

function depsWith(canned: unknown): {
  deps: ImportRouteDeps;
  calls: ChatMessage[][];
} {
  const calls: ChatMessage[][] = [];
  const transport: ChatTransport = (messages) => {
    calls.push(messages);
    return Promise.resolve(canned);
  };
  return { deps: { ...live, transport }, calls };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/import/text", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const PROGRAM = {
  items: [
    { day: 1, dayLabel: "Push", exercise: "bench press", sets: 3, reps: 5 },
    {
      day: 1,
      exercise: "Incline Bench Press",
      sets: 3,
      reps: 8,
      repsMax: 10,
      weight: 95,
      restSec: 90,
      rpe: 8,
    },
    { day: 1, exercise: "Pull Up", sets: 3, reps: 8, amrap: true },
    { day: 2, exercise: "Squat", sets: 5, reps: 5, weight: 100, unit: "kg" },
    { week: 2, day: 1, exercise: "Squat", sets: 5, reps: 5, weight: 105 },
  ],
};

Deno.test("clean import validates with the real evaluator", async () => {
  const { deps } = depsWith(PROGRAM);
  const res = await serveImportText(post({ text: "my program" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "ready");
  assert(body.programText.includes("Bench Press / 3x5 ?+"), body.programText);
  assert(body.programText.includes("## Day 1: Push"), body.programText);
  assert(body.programText.includes("Pull Up / 3x8+ ?+"), body.programText);
  assert(body.programText.includes("Squat / 5x5 100kg"), body.programText);
  assertEquals(body.errors, []);
});

Deno.test("evaluator really flags a broken program (check is not vacuous)", () => {
  const errors = live.validatorFor("lb")(
    "# Week 1\n## Day 1\nFoo Bar Baz / 3x8 ?+\n",
  );
  assert(errors.length > 0);
  assert(errors[0].includes("unknownExercise"), errors[0]);
  assertEquals(
    live.validatorFor("lb")("# Week 1\n## Day 1\nBench Press / 3x8 ?+\n"),
    [],
  );
});

Deno.test("split squat comes back as a confirm item, then the owner resolves it", async () => {
  const { deps, calls } = depsWith({
    items: [
      { day: 1, exercise: "Squat", sets: 3, reps: 5 },
      { day: 1, exercise: "split squat", sets: 3, reps: 8 },
    ],
  });
  const first = await serveImportText(post({ text: "x" }), deps);
  assertEquals(first.status, 200);
  const proposal = await first.json();
  assertEquals(proposal.status, "needs_confirm");
  assertEquals(proposal.programText, undefined);
  assertEquals(proposal.confirms.length, 1);
  assertEquals(proposal.confirms[0].reason, "ambiguous");
  assertEquals(
    proposal.confirms[0].candidates.map((c: { name: string }) => c.name),
    ["Split Squat", "Bulgarian Split Squat"],
  );

  // Second request: no model call, the owner's answer plus the edit list.
  const key = proposal.confirms[0].key;
  const second = await serveImportText(
    post({
      editList: { items: proposal.items },
      resolutions: { [key]: "bulgarianSplitSquat" },
    }),
    deps,
  );
  const done = await second.json();
  assertEquals(done.status, "ready");
  assert(done.programText.includes("Bulgarian Split Squat / 3x8 ?+"));
  assertEquals(calls.length, 1, "confirm step does not call the model");
});

Deno.test("diff is against currentProgram", async () => {
  const { deps } = depsWith({
    items: [{ day: 1, exercise: "Squat", sets: 3, reps: 5 }],
  });
  const res = await serveImportText(
    post({
      text: "x",
      currentProgram: "# Week 1\n## Day 1\nBench Press / 3x5 ?+\n",
    }),
    deps,
  );
  const body = await res.json();
  assertEquals(body.status, "ready");
  const ops = body.diff.map((l: { op: string }) => l.op);
  assert(ops.includes("remove") && ops.includes("add"));
});

Deno.test("injected names and day labels never reach the evaluator input", async () => {
  const { deps } = depsWith({
    items: [
      {
        day: 1,
        dayLabel: "Push\n# Week 9\n## Day 99",
        exercise: "Squat\n# Week 3\nEvil / 1x1 / progress: custom() {~ x ~}",
        sets: 3,
        reps: 5,
      },
      { day: 1, exercise: "Bench Press", sets: 3, reps: 5 },
    ],
  });
  const first = await (await serveImportText(post({ text: "x" }), deps)).json();
  assertEquals(first.status, "needs_confirm");
  const key = first.confirms[0].key;
  const done = await (await serveImportText(
    post({
      editList: { items: first.items },
      resolutions: { [key]: "skip" },
    }),
    deps,
  )).json();
  assertEquals(done.status, "ready");
  assert(!done.programText.includes("Evil"));
  assert(!done.programText.includes("progress"));
  assertEquals(
    done.programText.split("\n").filter((l: string) => l.startsWith("#"))
      .length,
    1 + 1,
  );
});

Deno.test("degraded backend is 502 with degraded true", async () => {
  const deps: ImportRouteDeps = {
    ...live,
    transport: () => Promise.reject(new Error("connection refused")),
  };
  const res = await serveImportText(post({ text: "x" }), deps);
  assertEquals(res.status, 502);
  const body = await res.json();
  assertEquals(body.degraded, true);
});

Deno.test("llamaTransport: real adapter degrades on a dead backend and bad JSON", async () => {
  const refused =
    (() => Promise.reject(new TypeError("refused"))) as unknown as typeof fetch;
  let threw = false;
  try {
    await llamaTransport("http://x", refused)([], {});
  } catch {
    threw = true;
  }
  assert(threw);

  const good = (() =>
    Promise.resolve(Response.json({
      choices: [{ message: { content: '{"items":[]}' } }],
    }))) as unknown as typeof fetch;
  assertEquals(await llamaTransport("http://x", good)([], {}), { items: [] });

  const bad = (() =>
    Promise.resolve(Response.json({
      choices: [{ message: { content: "not json" } }],
    }))) as unknown as typeof fetch;
  threw = false;
  try {
    await llamaTransport("http://x", bad)([], {});
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("request validation: method, size, shape", async () => {
  const { deps, calls } = depsWith(PROGRAM);
  assertEquals(
    (await serveImportText(new Request("http://x/", { method: "GET" }), deps))
      .status,
    405,
  );
  assertEquals((await serveImportText(post("not json"), deps)).status, 400);
  assertEquals((await serveImportText(post([1]), deps)).status, 400);
  assertEquals((await serveImportText(post({}), deps)).status, 400);
  assertEquals(
    (await serveImportText(post({ text: "x".repeat(13_000) }), deps)).status,
    413,
  );
  assertEquals(
    (await serveImportText(
      post({ text: "x".repeat(MAX_IMPORT_BODY_BYTES + 1) }),
      deps,
    )).status,
    413,
  );
  assertEquals(calls.length, 0, "model never called for rejected requests");
});

Deno.test("a client-supplied edit list is validated like model output", async () => {
  const { deps } = depsWith(PROGRAM);
  const res = await serveImportText(
    post({
      editList: {
        items: [{ day: 1, exercise: "Squat", sets: 99999, reps: 5 }],
      },
    }),
    deps,
  );
  assertEquals(res.status, 422);
  const body = await res.json();
  assertEquals(body.status, "invalid");
  assertEquals(body.rejected.length, 1);
});
