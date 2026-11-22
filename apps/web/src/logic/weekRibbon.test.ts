import { test } from "bun:test";
import assert from "node:assert/strict";
import { weekSummary } from "./weekRibbon.ts";
import { sampleBlockWeeks } from "../store/sample.ts";

const [past, current, future] = sampleBlockWeeks.slice(1, 4);

test("each week summarises in its own tense", () => {
  assert.deepStrictEqual(weekSummary(past), "2,590 of 2,670 done");
  assert.deepStrictEqual(weekSummary(current), "2,240 done of 2,780 planned");
  assert.deepStrictEqual(weekSummary(future), "2,860 planned");
});
