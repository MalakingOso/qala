import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  dayTime,
  defaultFocusId,
  pastColumns,
  relationLabel,
  stepFocus,
  weekSummary,
} from "./weekRibbon.ts";
import { sampleWeeks } from "../store/sample.ts";

const [past, current, future] = sampleWeeks;

test("each week summarises in its own tense", () => {
  assert.deepStrictEqual(weekSummary(past), "2,590 of 2,670 done");
  assert.deepStrictEqual(weekSummary(current), "2,240 done of 2,780 planned");
  assert.deepStrictEqual(weekSummary(future), "2,860 planned");
  assert.deepStrictEqual(relationLabel(past), "last week");
  assert.deepStrictEqual(relationLabel(current), "this week");
  assert.deepStrictEqual(relationLabel(future), "next week");
});

test("the past wash ends at today", () => {
  assert.deepStrictEqual(dayTime(past, 6), "past");
  assert.deepStrictEqual(dayTime(current, 5), "past");
  assert.deepStrictEqual(dayTime(current, 6), "today");
  assert.deepStrictEqual(dayTime(future, 0), "future");
  // All of week 2 plus Monday to Saturday of week 3.
  assert.deepStrictEqual(pastColumns(sampleWeeks), 13);
});

test("focus starts on the current week and steps within the three", () => {
  assert.deepStrictEqual(defaultFocusId(sampleWeeks), "w3");
  assert.deepStrictEqual(stepFocus(sampleWeeks, "w3", -1), "w2");
  assert.deepStrictEqual(stepFocus(sampleWeeks, "w2", -1), "w2");
  assert.deepStrictEqual(stepFocus(sampleWeeks, "w3", 1), "w4");
  assert.deepStrictEqual(stepFocus(sampleWeeks, "w4", 1), "w4");
});
