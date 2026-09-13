// pipeline_test.ts: end-to-end processRun over a 2-mile run with a stop.

import { processRun } from "./mod.ts";
import { MILE_M } from "./splits.ts";
import type { RunWorkout } from "./types.ts";
import { assert, assertClose, lineFixes, stopFixes } from "./testutil.ts";

Deno.test("pipeline: 2 miles with a stop, guided tempo", () => {
  // 545 fixes = 544 segments x 3 m = 1632 m per leg: mile 1 falls inside
  // leg 1 (~537 s), mile 2 inside leg 2, with a 30 s stop between.
  const leg1 = lineFixes({ count: 545, speedMps: 3 });
  const end1 = leg1[leg1.length - 1];
  const stop = stopFixes({ count: 30, t0: 545, lat: end1.lat, lon: end1.lon });
  const leg2 = lineFixes({
    count: 545,
    speedMps: 3,
    t0: 575,
    startLat: end1.lat,
  });
  const workout: RunWorkout = {
    type: "tempo",
    steps: [
      { kind: "warmup", seconds: 300 },
      { kind: "work", seconds: 600, paceLoMps: 2.9, paceHiMps: 3.2 },
      { kind: "cooldown" },
    ],
  };
  const run = processRun([...leg1, ...stop, ...leg2], { workout });

  assertClose(
    run.distanceM,
    2 * 544 * 3,
    2 * 544 * 3 * 0.01,
    "distance within 1%",
  );
  assert(run.splits.length >= 2, `mile splits recorded: ${run.splits.length}`);
  assertClose(run.splits[0].sec, MILE_M / 3, 3, "mile 1 time");
  assert(run.paused.length === 1, `one auto-pause, got ${run.paused.length}`);
  assert(run.movingSec < run.elapsedSec, "moving excludes the stop");
  assertClose(run.elapsedSec, 1119, 2, "elapsed spans everything");
  assert(
    run.currentSpeedMps !== null && run.currentSpeedMps > 2.5,
    "live pace reads out",
  );
  assertClose(
    run.avgSpeedMps,
    run.distanceM / run.movingSec,
    1e-9,
    "average is distance over moving",
  );
  const kinds = run.guidedEvents.map((e) => e.type);
  assert(kinds.includes("stepEnd"), "guided steps advance on moving time");
  assert(run.points.length === 545 + 30 + 545, "no point cap, nothing lost");
  assert(run.points[0].t === 0, "first point kept");
});
