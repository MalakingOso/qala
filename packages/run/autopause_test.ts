// autopause_test.ts: exact machine behaviour + a filtered integration case.

import { computePauses } from "./autopause.ts";
import { processRun } from "./mod.ts";
import { assert, assertClose, lineFixes, stopFixes } from "./testutil.ts";

function hold(speed: number, from: number, count: number) {
  const out: { t: number; speedMps: number }[] = [];
  for (let i = 0; i < count; i++) out.push({ t: from + i, speedMps: speed });
  return out;
}

Deno.test("60 s stop mid-run pauses once and moving excludes it", () => {
  const pts = [
    ...hold(3, 0, 60),
    ...hold(0, 60, 60),
    ...hold(3, 120, 61),
  ];
  const r = computePauses(pts);
  assert(r.paused.length === 1, `one pause, got ${r.paused.length}`);
  assertClose(
    r.paused[0].startT,
    60,
    1e-9,
    "pause starts at first still sample",
  );
  assertClose(r.paused[0].endT, 120, 1e-9, "pause ends at first moving sample");
  assertClose(r.elapsedSec, 180, 1e-9, "elapsed keeps the stop");
  assertClose(r.movingSec, 120, 1e-9, "moving excludes the stop");
});

Deno.test("a 3 s dip never pauses; resume needs 3 s above 1.0", () => {
  const pts = [...hold(3, 0, 30), ...hold(0, 30, 3), ...hold(3, 33, 30)];
  const r = computePauses(pts);
  assert(r.paused.length === 0, "no pause for a short dip");
  assertClose(r.movingSec, r.elapsedSec, 1e-9, "nothing excluded");
});

Deno.test("run ending mid-pause closes the interval at the last fix", () => {
  const pts = [...hold(3, 0, 30), ...hold(0, 30, 30)];
  const r = computePauses(pts);
  assert(r.paused.length === 1, "pause recorded");
  assertClose(r.paused[0].endT, 59, 1e-9, "closed at last fix");
  assertClose(r.movingSec, 30, 1e-9, "moving is the running part");
});

Deno.test("integration: filtered stop yields one pause and sane moving time", () => {
  const moving = lineFixes({ count: 60, speedMps: 3 });
  const last = moving[moving.length - 1];
  const stop = stopFixes({ count: 60, t0: 60, lat: last.lat, lon: last.lon });
  const more = lineFixes({
    count: 60,
    speedMps: 3,
    t0: 120,
    startLat: last.lat,
  });
  const run = processRun([...moving, ...stop, ...more]);
  assert(run.paused.length === 1, `one pause, got ${run.paused.length}`);
  assertClose(run.elapsedSec, 179, 2, "elapsed spans the run");
  // 119 s of running plus Kalman settle on either side of the stop.
  assert(
    run.movingSec > 110 && run.movingSec < 130,
    `moving ~119 s, got ${run.movingSec}`,
  );
  assert(run.avgSpeedMps > 2.5 && run.avgSpeedMps < 3.5, "avg pace sane");
});
