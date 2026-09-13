import { assertEquals } from "@std/assert";
import {
  avgPace,
  cueLabel,
  formatElapsed,
  formatPace,
  mpsToPaceSecPerMi,
} from "./pace.ts";

Deno.test("pace conversions round-trip through a mile", () => {
  // 9:00/mi is 1609.344/540 = 2.9799 m/s.
  assertEquals(formatPace(mpsToPaceSecPerMi(2.9799)), "9:00");
  assertEquals(formatPace(0), "--:--");
});

Deno.test("elapsed clock stacks hours Runkeeper-style", () => {
  assertEquals(formatElapsed(320), "5:20");
  assertEquals(formatElapsed(3720), "1:02:00");
});

Deno.test("average pace is distance over moving time", () => {
  assertEquals(formatPace(avgPace(4828.032, 1620)), "9:00");
});

Deno.test("cue label carries mile, pace and total", () => {
  assertEquals(cueLabel(2, 544, 1092), "Mile 2, 9:04 pace, 18:12 total");
});
