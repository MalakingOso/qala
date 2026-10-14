// The server's LS++ module against the real wasm build. Needs `deno task build:wasm`
// first; without it these fail with the "Run `deno task build:wasm`" message.

import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  diagnostics,
  fmt,
  loadLspp,
  loadLsppFrom,
  LsppUnavailableError,
} from "./lspp.ts";
import { MAX_LSPP_TEXT_CHARS } from "../packages/lspp/mod.ts";

Deno.test("two loads share one instance", async () => {
  const [a, b] = await Promise.all([loadLspp(), loadLspp()]);
  assert(a === b);
  assert(a === await loadLspp());
});

Deno.test("diagnostics: a broken line gets a position and a suggestion", async () => {
  const r = await diagnostics("Squat / 3x");
  assert(r.ok);
  assertEquals(r.value.length, 1);
  const d = r.value[0];
  assertEquals([d.line, d.col, d.endLine, d.endCol], [1, 10, 1, 11]);
  assert(d.from < d.to);
  assert(d.message.length > 0);
  assert(d.suggestion?.includes("rep count"), String(d.suggestion));
});

Deno.test("diagnostics: a clean program has none", async () => {
  const r = await diagnostics("# Week 1\n## Day 1\nSquat / 3x5 100lb\n");
  assertEquals(r, { ok: true, value: [] });
});

Deno.test("diagnostics: offsets are UTF-16, so an emoji above does not shift them", async () => {
  const text = "// 💪 heavy\nSquat / 3x\n";
  const r = await diagnostics(text);
  assert(r.ok);
  assertEquals(r.value.length, 1);
  assertEquals(r.value[0].line, 2);
  assertEquals(r.value[0].from, text.indexOf("3x") + 2);
});

Deno.test("diagnostics: text past the cap is refused before it reaches the wasm", async () => {
  const r = await diagnostics("a".repeat(MAX_LSPP_TEXT_CHARS + 1));
  assert(!r.ok);
  assertEquals(r.kind, "tooLarge");
});

Deno.test("fmt: normalizes spacing", async () => {
  const r = await fmt("Squat/3x5   100lb");
  assertEquals(r, {
    ok: true,
    value: { ok: true, text: "Squat / 3x5 100lb\n", changed: true },
  });
});

Deno.test("fmt: leaves formatted text alone", async () => {
  const r = await fmt("# Week 1\n## Day 1\nSquat / 3x5 100lb\n");
  assert(r.ok && r.value.ok);
  assertEquals(r.value.changed, false);
});

Deno.test("fmt: refuses a syntax error and says where", async () => {
  const r = await fmt("Squat / 3x");
  assert(r.ok);
  assert(!r.value.ok);
  assertEquals(r.value.reason, "syntax");
  assertEquals(r.value.diagnostics[0].line, 1);
});

Deno.test("a missing build throws an error that says how to build it", async () => {
  const gone = new URL("file:///nonexistent-lspp-build/");
  const err = await assertRejects(
    () => loadLsppFrom(gone),
    LsppUnavailableError,
  );
  assert(err.message.includes("deno task build:wasm"), err.message);
});
