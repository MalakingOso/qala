// gpx_test.ts + tcx_test.ts: exporter round-trips via string parsing
// (no DOM dependency: the library stays pure string building).

import { filterFixes } from "./filter.ts";
import { exportRunGpx } from "./gpx.ts";
import { GuidedRun } from "./guided.ts";
import { exportRunTcx, splitsToLaps, workoutLaps } from "./tcx.ts";
import { computeSplits } from "./splits.ts";
import type { RunWorkout } from "./types.ts";
import { assert, assertClose, lineFixes } from "./testutil.ts";

function trkpts(gpx: string): { lat: number; lon: number; hr?: number }[] {
  const out: { lat: number; lon: number; hr?: number }[] = [];
  const re =
    /<trkpt lat="(-?\d+(?:\.\d+)?)" lon="(-?\d+(?:\.\d+)?)">(?:[\s\S]*?<gpxtpx:hr>(\d+)<\/gpxtpx:hr>)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(gpx)) !== null) {
    const pt: { lat: number; lon: number; hr?: number } = {
      lat: parseFloat(m[1]),
      lon: parseFloat(m[2]),
    };
    if (m[3] !== undefined) pt.hr = parseInt(m[3], 10);
    out.push(pt);
  }
  return out;
}

Deno.test("GPX round-trip preserves points and HR", () => {
  const pts = filterFixes(lineFixes({ count: 120, speedMps: 3, hr: 150 }));
  const gpx = exportRunGpx({
    name: "Test & run",
    startTimeMs: 1700000000000,
    points: pts,
  });
  assert(gpx.includes("Test &amp; run"), "name is XML-escaped");
  assert(
    gpx.includes('xmlns="http://www.topografix.com/GPX/1/1"'),
    "GPX 1.1 namespace",
  );
  assert(gpx.includes("TrackPointExtension"), "Garmin extension present");
  const back = trkpts(gpx);
  assert(back.length === pts.length, `all points survive: ${back.length}`);
  assertClose(back[0].lat, pts[0].lat, 1e-6, "first latitude");
  assertClose(
    back[back.length - 1].lon,
    pts[pts.length - 1].lon,
    1e-6,
    "last longitude",
  );
  assert(back.every((p) => p.hr === 150), "HR on every point");
});

Deno.test("GPX starts a new trkseg at a gap point instead of a straight line", () => {
  const pts = filterFixes(lineFixes({ count: 5, speedMps: 3 }));
  // Simulate a re-anchor: filter.ts sets `gap: true` on the point right
  // after an unfiltered jump was excluded from the counted distance.
  pts[3] = { ...pts[3], gap: true };
  const gpx = exportRunGpx({ startTimeMs: 1700000000000, points: pts });
  const segCount = (gpx.match(/<trkseg>/g) ?? []).length;
  assert(segCount === 2, `one new segment per gap point, got ${segCount}`);
  assert(
    (gpx.match(/<\/trkseg>/g) ?? []).length === segCount,
    "every trkseg is closed",
  );
  const back = trkpts(gpx);
  assert(back.length === pts.length, "no points dropped across the split");
});

Deno.test("TCX laps: one per workout step, one per split without a workout", () => {
  const workout: RunWorkout = {
    type: "intervals",
    steps: [
      { kind: "warmup", seconds: 60 },
      { kind: "work", seconds: 60, repeat: 2 },
      { kind: "recover", seconds: 60 },
    ],
  };
  const guided = new GuidedRun(workout);
  let dist = 0;
  for (let t = 0; t <= 240; t++) {
    dist += 3;
    guided.update({ cueSpeedMps: 3, distM: dist, timeSec: t });
  }
  assert(guided.complete, "workout finished");
  const laps = workoutLaps(guided.stepSummaries, 1700000000000, 0);
  assert(laps.length === 4, `one lap per expanded step, got ${laps.length}`);
  assert(laps[3].intensity === "Rest", "recover maps to Rest");
  assert(laps[0].intensity === "Active", "warmup maps to Active");
  const tcx = exportRunTcx({ startTimeMs: 1700000000000, laps });
  const lapCount = (tcx.match(/<Lap /g) ?? []).length;
  assert(lapCount === 4, `TCX carries 4 laps, got ${lapCount}`);
  assert(tcx.includes('Sport="Running"'), "running sport");
  const caloriesCount = (tcx.match(/<Calories>/g) ?? []).length;
  assert(
    caloriesCount === 4,
    `every lap has the schema-required Calories element, got ${caloriesCount}`,
  );
  assert(
    /<DistanceMeters>[^<]*<\/DistanceMeters><Calories>/.test(tcx),
    "Calories comes right after DistanceMeters, before AverageHeartRateBpm",
  );

  const pts = filterFixes(lineFixes({ count: 1100, speedMps: 3 }));
  const splits = computeSplits(pts);
  const splitLaps = splitsToLaps(splits, 1700000000000, pts[0].t);
  assert(splitLaps.length === splits.length, "one lap per split");
  const totalLapDist = splitLaps.reduce((s, l) => s + l.distanceM, 0);
  assertClose(
    totalLapDist,
    splits[splits.length - 1].cumDistM,
    1e-6,
    "lap distances cover the run",
  );
});
