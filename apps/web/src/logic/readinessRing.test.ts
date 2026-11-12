import { test } from "bun:test";
import assert from "node:assert/strict";
import { readinessRing } from "./readinessRing.ts";

test("sample ring: 72 with avg 76, low 64", () => {
  const r = readinessRing(0.72, 76, 64, 20, 7);
  assert.deepStrictEqual(r.value, 72);
  assert.deepStrictEqual(r.low, false);
  assert.deepStrictEqual(r.avgFrac, 0.76);
  assert.deepStrictEqual(r.legendAvg, "your avg 76");
  assert.deepStrictEqual(r.legendLow, "low under 64");
});

test("PRS 4 or below is always low", () => {
  assert.deepStrictEqual(readinessRing(0.8, 76, 64, 20, 4).low, true);
});

test("average hidden before 14 check-ins, low line at 50", () => {
  const r = readinessRing(0.72, 76, 64, 5, 7);
  assert.deepStrictEqual(r.avgFrac, null);
  assert.deepStrictEqual(r.lowFrac, 0.5);
  assert.deepStrictEqual(r.legendLow, "low under 50");
});

test("usual range is the average plus and minus one SD", () => {
  const r = readinessRing(0.72, 76, 64, 20, 7);
  assert.deepStrictEqual(r.usualLoFrac, 0.68);
  assert.deepStrictEqual(r.usualHiFrac, 0.84);
  assert.deepStrictEqual(r.legendUsual, "68 to 84");
  assert.deepStrictEqual(r.margin, 8);
});

test("no usual range before 14 check-ins", () => {
  const r = readinessRing(0.58, 76, 64, 5, 7);
  assert.deepStrictEqual(r.usualLoFrac, null);
  assert.deepStrictEqual(r.margin, 8);
});
