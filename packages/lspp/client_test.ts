// The client against a fake wasm module: envelope handling, error values, the
// trap latch and the size cap. The real wasm is exercised in server/lspp_test.ts.

import { assert, assertEquals } from "@std/assert";
import { createLspp, MAX_LSPP_TEXT_CHARS } from "./client.ts";
import type { LsppWasm } from "./types.ts";

function fakeWasm(over: Partial<LsppWasm> = {}): LsppWasm & {
  seen: string[];
} {
  const seen: string[] = [];
  const reply = (result: unknown) => JSON.stringify({ v: 1, result });
  return {
    seen,
    diagnosePlanner: (t) => (seen.push(t), reply([])),
    lintPlanner: () => reply([]),
    formatPlanner: (t) => reply({ ok: true, text: t, changed: false }),
    dryRun: (
      r,
    ) => (seen.push(r), reply({ sessions: [], blankSets: 0, finalText: "" })),
    forceEvaluateText: (r) => (seen.push(r), reply({ errors: [] })),
    qalaSettingsToLiftoscript: (r) => (seen.push(r), reply({ timers: {} })),
    ...over,
  };
}

Deno.test("a success envelope is unwrapped", () => {
  const lspp = createLspp(fakeWasm());
  assertEquals(lspp.diagnose("Squat / 3x5"), { ok: true, value: [] });
  assertEquals(lspp.format("Squat / 3x5"), {
    ok: true,
    value: { ok: true, text: "Squat / 3x5", changed: false },
  });
});

Deno.test("an error envelope becomes a failed value, not an exception", () => {
  const lspp = createLspp(fakeWasm({
    dryRun: () =>
      JSON.stringify({
        v: 1,
        error: { kind: "evaluation", message: "no day 9" },
      }),
  }));
  assertEquals(
    lspp.dryRun({ programText: "x", settings: {} }),
    { ok: false, kind: "evaluation", message: "no day 9" },
  );
});

Deno.test("a reply that is not an envelope is reported, not thrown", () => {
  const notJson = createLspp(fakeWasm({ diagnosePlanner: () => "oops" }));
  const r1 = notJson.diagnose("x");
  assert(!r1.ok && r1.kind === "badEnvelope");
  const wrongVersion = createLspp(fakeWasm({
    diagnosePlanner: () => JSON.stringify({ v: 2, result: [] }),
  }));
  const r2 = wrongVersion.diagnose("x");
  assert(!r2.ok && r2.kind === "badEnvelope");
});

Deno.test("requests carry the envelope version and drop unset options", () => {
  const wasm = fakeWasm();
  const lspp = createLspp(wasm);
  lspp.dryRun({ programText: "# Week 1", settings: { a: 1 }, sessions: 2 });
  lspp.evaluateText({ programText: "# Week 1", name: "n", settings: {} });
  lspp.settingsFromCore({ units: {} });
  const [dry, evaluate, settings] = wasm.seen.map((s) => JSON.parse(s));
  assertEquals(dry, {
    v: 1,
    programText: "# Week 1",
    name: "Program",
    settings: { a: 1 },
    sessions: 2,
  });
  assertEquals(evaluate.v, 1);
  assertEquals(settings, { v: 1, coreSettings: { units: {} } });
});

Deno.test("a trap kills the client and later calls fail fast", () => {
  let calls = 0;
  const lspp = createLspp(fakeWasm({
    diagnosePlanner: () => {
      calls++;
      throw new Error("unreachable executed");
    },
  }));
  const first = lspp.diagnose("x");
  assert(!first.ok && first.kind === "trap");
  assert(first.message.includes("unreachable executed"));
  const second = lspp.lint("x");
  assert(!second.ok && second.kind === "trap");
  lspp.diagnose("y");
  assertEquals(calls, 1);
});

Deno.test("text past the cap never reaches the wasm", () => {
  const wasm = fakeWasm();
  const lspp = createLspp(wasm);
  const big = "a".repeat(MAX_LSPP_TEXT_CHARS + 1);
  const r = lspp.diagnose(big);
  assert(!r.ok && r.kind === "tooLarge");
  const d = lspp.dryRun({ programText: big, settings: {} });
  assert(!d.ok && d.kind === "tooLarge");
  assertEquals(wasm.seen, []);
  assert(lspp.diagnose("a".repeat(MAX_LSPP_TEXT_CHARS)).ok);
});
