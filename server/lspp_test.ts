// The server's LS++ module against the real wasm build. Needs `bun run build:wasm`
// first; without it these fail with the "Run `bun run build:wasm`" message.

import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  diagnostics,
  fmt,
  loadLspp,
  loadLsppFrom,
  LsppUnavailableError,
} from "./lspp.ts";
import { MAX_LSPP_TEXT_CHARS } from "../packages/lspp/mod.ts";

test("two loads share one instance", async () => {
  const [a, b] = await Promise.all([loadLspp(), loadLspp()]);
  assert(a === b);
  assert(a === await loadLspp());
});

test("diagnostics: a broken line gets a position and a suggestion", async () => {
  const r = await diagnostics("Squat / 3x");
  assert(r.ok);
  assert.deepStrictEqual(r.value.length, 1);
  const d = r.value[0];
  assert.deepStrictEqual([d.line, d.col, d.endLine, d.endCol], [1, 10, 1, 11]);
  assert(d.from < d.to);
  assert(d.message.length > 0);
  assert(d.suggestion?.includes("rep count"), String(d.suggestion));
});

test("diagnostics: a clean program has none", async () => {
  const r = await diagnostics("# Week 1\n## Day 1\nSquat / 3x5 100lb\n");
  assert.deepStrictEqual(r, { ok: true, value: [] });
});

test("diagnostics: offsets are UTF-16, so an emoji above does not shift them", async () => {
  const text = "// 💪 heavy\nSquat / 3x\n";
  const r = await diagnostics(text);
  assert(r.ok);
  assert.deepStrictEqual(r.value.length, 1);
  assert.deepStrictEqual(r.value[0].line, 2);
  assert.deepStrictEqual(r.value[0].from, text.indexOf("3x") + 2);
});

test("diagnostics: text past the cap is refused before it reaches the wasm", async () => {
  const r = await diagnostics("a".repeat(MAX_LSPP_TEXT_CHARS + 1));
  assert(!r.ok);
  assert.deepStrictEqual(r.kind, "tooLarge");
});

test("fmt: normalizes spacing", async () => {
  const r = await fmt("Squat/3x5   100lb");
  assert.deepStrictEqual(r, {
    ok: true,
    value: { ok: true, text: "Squat / 3x5 100lb\n", changed: true },
  });
});

test("fmt: leaves formatted text alone", async () => {
  const r = await fmt("# Week 1\n## Day 1\nSquat / 3x5 100lb\n");
  assert(r.ok && r.value.ok);
  assert.deepStrictEqual(r.value.changed, false);
});

test("fmt: refuses a syntax error and says where", async () => {
  const r = await fmt("Squat / 3x");
  assert(r.ok);
  assert(!r.value.ok);
  assert.deepStrictEqual(r.value.reason, "syntax");
  assert.deepStrictEqual(r.value.diagnostics[0].line, 1);
});

test("a missing build throws an error that says how to build it", async () => {
  const gone = new URL("file:///nonexistent-lspp-build/");
  await assert.rejects(
    () => loadLsppFrom(gone),
    (err) =>
      err instanceof LsppUnavailableError &&
      err.message.includes("bun run build:wasm"),
  );
});
