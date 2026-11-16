import { test } from "bun:test";
import assert from "node:assert/strict";
import { formatPace } from "./pace.ts";

test("pace renders as minutes and seconds per mile", () => {
  assert.deepStrictEqual(formatPace(542), "9:02");
  assert.deepStrictEqual(formatPace(0), "--:--");
});
