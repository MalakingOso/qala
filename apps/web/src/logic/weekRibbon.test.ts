import { test } from "bun:test";
import assert from "node:assert/strict";
import { dayTime, weekSummary } from "./weekRibbon.ts";
import { sampleWeeks } from "../store/sample.ts";

const [past, current, future] = sampleWeeks;

test("each week summarises in its own tense", () => {
  assert.deepStrictEqual(weekSummary(past), "2,590 of 2,670 done");
  assert.deepStrictEqual(weekSummary(current), "2,240 done of 2,780 planned");
  assert.deepStrictEqual(weekSummary(future), "2,860 planned");
});

test("the past wash ends at today", () => {
  assert.deepStrictEqual(dayTime(past, 6), "past");
  assert.deepStrictEqual(dayTime(current, 5), "past");
  assert.deepStrictEqual(dayTime(current, 6), "today");
  assert.deepStrictEqual(dayTime(future, 0), "future");
});
