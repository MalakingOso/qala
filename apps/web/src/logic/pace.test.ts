import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  avgPace,
  cueLabel,
  formatElapsed,
  formatPace,
  mpsToPaceSecPerMi,
} from "./pace.ts";

test("pace conversions round-trip through a mile", () => {
  // 9:00/mi is 1609.344/540 = 2.9799 m/s.
  assert.deepStrictEqual(formatPace(mpsToPaceSecPerMi(2.9799)), "9:00");
  assert.deepStrictEqual(formatPace(0), "--:--");
});

test("elapsed clock stacks hours Runkeeper-style", () => {
  assert.deepStrictEqual(formatElapsed(320), "5:20");
  assert.deepStrictEqual(formatElapsed(3720), "1:02:00");
});

test("average pace is distance over moving time", () => {
  assert.deepStrictEqual(formatPace(avgPace(4828.032, 1620)), "9:00");
});

test("cue label carries mile, pace and total", () => {
  assert.deepStrictEqual(cueLabel(2, 544, 1092), "Mile 2, 9:04 pace, 18:12 total");
});
