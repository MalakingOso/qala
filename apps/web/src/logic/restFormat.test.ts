import { test } from "bun:test";
import assert from "node:assert/strict";
import { formatClock, formatRestWhy } from "./restFormat.ts";

test("ticking clock pads seconds", () => {
  assert.deepStrictEqual(formatClock(225), "3:45");
  assert.deepStrictEqual(formatClock(9.2), "0:10");
});

test("why-line matches the DESIGN 7.6 shape", () => {
  assert.deepStrictEqual(
    formatRestWhy(225, {
      base: 180,
      adjustments: [
        { label: "your pace", seconds: -15 },
        { label: "last set RPE 9 vs 8", seconds: 30 },
        { label: "set 4 of squat", seconds: 30 },
      ],
    }),
    "3:45 · base 3:00, your pace -15 s, last set RPE 9 vs 8 +30 s, set 4 of squat +30 s",
  );
});
