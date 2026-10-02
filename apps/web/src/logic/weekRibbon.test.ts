import { assertEquals } from "@std/assert";
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

Deno.test("each week summarises in its own tense", () => {
  assertEquals(weekSummary(past), "2,590 of 2,670 done");
  assertEquals(weekSummary(current), "2,240 done of 2,780 planned");
  assertEquals(weekSummary(future), "2,860 planned");
  assertEquals(relationLabel(past), "last week");
  assertEquals(relationLabel(current), "this week");
  assertEquals(relationLabel(future), "next week");
});

Deno.test("the past wash ends at today", () => {
  assertEquals(dayTime(past, 6), "past");
  assertEquals(dayTime(current, 5), "past");
  assertEquals(dayTime(current, 6), "today");
  assertEquals(dayTime(future, 0), "future");
  // All of week 2 plus Monday to Saturday of week 3.
  assertEquals(pastColumns(sampleWeeks), 13);
});

Deno.test("focus starts on the current week and steps within the three", () => {
  assertEquals(defaultFocusId(sampleWeeks), "w3");
  assertEquals(stepFocus(sampleWeeks, "w3", -1), "w2");
  assertEquals(stepFocus(sampleWeeks, "w2", -1), "w2");
  assertEquals(stepFocus(sampleWeeks, "w3", 1), "w4");
  assertEquals(stepFocus(sampleWeeks, "w4", 1), "w4");
});
