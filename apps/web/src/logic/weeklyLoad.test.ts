import { test } from "bun:test";
import assert from "node:assert/strict";
import { weekTotals } from "./weeklyLoad.ts";
import { sampleWeekLoad } from "../store/sample.ts";

test("sample week totals split lifting and running", () => {
  const t = weekTotals(sampleWeekLoad);
  assert.deepStrictEqual(t.liftDone, 1760);
  assert.deepStrictEqual(t.runDone, 480);
  assert.deepStrictEqual(t.planned, 1760 + 1020);
  assert.deepStrictEqual(t.done, 2240);
});
