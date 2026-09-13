// pace_test.ts: windowed pace fixtures + batched == on-time.

import { filterFixes } from "./filter.ts";
import { averagePace, cuePace, currentPace, windowSpeed } from "./pace.ts";
import { assert, assertClose, lineFixes } from "./testutil.ts";

Deno.test("steady run: 20 s, 30 s and average pace agree", () => {
  const pts = filterFixes(lineFixes({ count: 121, speedMps: 3 }));
  const cur = currentPace(pts);
  const cue = cuePace(pts);
  const avg = averagePace(pts[pts.length - 1].distM, 120);
  assert(cur !== null && cue !== null && avg !== null, "paces read out");
  assertClose(cur.speedMps, 3, 0.05, "current pace");
  assertClose(cue.speedMps, 3, 0.05, "cue pace");
  assertClose(avg.speedMps, 3, 0.05, "average pace");
  assertClose(avg.paceSecPerM, 1 / 3, 0.001, "pace reciprocal");
});

Deno.test("jara timestamps: batched-late fixes give the same pace as on-time", () => {
  const fixes = lineFixes({ count: 120, speedMps: 2.8 });
  const onTime = filterFixes(fixes);
  // Same fixes, delivered in three late batches: identical input, identical pace.
  const batched = filterFixes([
    ...fixes.slice(0, 40),
    ...fixes.slice(40, 80),
    ...fixes.slice(80),
  ]);
  const a = currentPace(onTime);
  const b = currentPace(batched);
  assert(a !== null && b !== null, "paces read out");
  assertClose(b.speedMps, a.speedMps, 1e-9, "batched == on-time");
  // And pace at an intermediate clock time does not depend on later fixes.
  const early = windowSpeed(onTime.slice(0, 60), 59, 20);
  const late = windowSpeed(onTime, 59, 20);
  assert(early !== null && late !== null, "window paces read out");
  assertClose(early.speedMps, late.speedMps, 1e-9, "window ignores the future");
});

Deno.test("average pace is distance over moving time", () => {
  const avg = averagePace(300, 100);
  assert(avg !== null, "reads out");
  assertClose(avg.speedMps, 3, 1e-12, "300 m / 100 s");
  assert(averagePace(300, 0) === null, "null with no moving time");
  assert(currentPace([]) === null, "null with no points");
  assert(currentPace([{ t: 0, distM: 0 }]) === null, "null with one point");
});
