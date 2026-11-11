// pipeline_test.ts: end-to-end processRun over a 2-mile run with a stop.

import { processRun } from "./mod.ts";
import { causalClockTrace } from "./autopause.ts";
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

Deno.test("guided clock: a step boundary inside the 5 s pause hold, clock steps back", () => {
  // 30 s at 3 m/s, then stopped. The still seconds start at t = 30 and the
  // pause is only confirmed at t = 35, so the clock reads 34 at t = 34 and
  // steps back to 30 at t = 35, then holds while paused.
  const speeds: { t: number; speedMps: number }[] = [];
  for (let t = 0; t < 60; t++) speeds.push({ t, speedMps: t < 30 ? 3 : 0 });
  const clock = causalClockTrace(speeds);
  assertClose(clock[34], 34, 1e-12, "still counted as moving during the hold");
  assertClose(clock[35], 30, 1e-12, "confirmed pause back-dates to its start");
  assert(clock[34] - clock[35] === 4, "stepped back by 4 s");
  assertClose(clock[59], 30, 1e-12, "held while paused");

  // A step of 32 s ends at t = 32, inside the hold; the next step starts from
  // that reading, and the clock stepping back afterwards cannot re-trigger it.
  const line = lineFixes({ count: 30, speedMps: 3 });
  const end = line[line.length - 1];
  const still = stopFixes({ count: 40, t0: 30, lat: end.lat, lon: end.lon });
  const workout: RunWorkout = {
    type: "intervals",
    steps: [
      { kind: "warmup", seconds: 32 },
      { kind: "work", seconds: 5 },
      { kind: "cooldown" },
    ],
  };
  const fixes = [...line, ...still];
  const endsBy = (k: number) =>
    processRun(fixes.slice(0, k), { workout }).guidedEvents.filter((e) =>
      e.type === "stepEnd"
    ).length;
  assert(endsBy(32) === 0, "not yet at t = 31");
  assert(
    endsBy(33) === 1,
    "warmup ends at t = 32, three seconds before the pause is known",
  );
  assert(endsBy(70) === 1, "the clock stepping back does not end another step");
});

Deno.test("guided events are causal: a prefix of the fixes gives a prefix of the events", () => {
  const leg1 = lineFixes({ count: 200, speedMps: 3 });
  const end1 = leg1[leg1.length - 1];
  const stop = stopFixes({ count: 40, t0: 200, lat: end1.lat, lon: end1.lon });
  const leg2 = lineFixes({
    count: 200,
    speedMps: 3.4,
    t0: 240,
    startLat: end1.lat,
  });
  const fixes = [...leg1, ...stop, ...leg2];
  const workout: RunWorkout = {
    type: "intervals",
    steps: [
      { kind: "warmup", seconds: 60 },
      { kind: "work", seconds: 150, paceLoMps: 2.9, paceHiMps: 3.1 },
      { kind: "recover", seconds: 40 },
      { kind: "cooldown" },
    ],
  };
  const full = processRun(fixes, { workout }).guidedEvents;
  assert(full.length > 6, `enough events to compare, got ${full.length}`);
  for (const k of [1, 61, 150, 203, 215, 238, 250, 300, 441]) {
    const part = processRun(fixes.slice(0, k), { workout }).guidedEvents;
    assert(part.length <= full.length, `prefix ${k} is not longer`);
    assert(
      JSON.stringify(part) === JSON.stringify(full.slice(0, part.length)),
      `events for ${k} fixes are a prefix of the full run's`,
    );
  }
});
