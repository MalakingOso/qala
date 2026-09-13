// splits_test.ts: mile boundaries, interpolation, configurable units.

import { filterFixes } from "./filter.ts";
import { computeSplits, KM_M, MILE_M } from "./splits.ts";
import { assert, assertClose, lineFixes } from "./testutil.ts";

Deno.test("two miles at 3 m/s split at the right times", () => {
  // 2 mi = 3218.7 m; at 3 m/s ~1073 s. Generate 1100 s: 2 full + partial.
  const pts = filterFixes(lineFixes({ count: 1100, speedMps: 3 }));
  const splits = computeSplits(pts);
  assert(splits.length === 3, `two full miles + partial, got ${splits.length}`);
  const mileSec = MILE_M / 3;
  assertClose(splits[0].sec, mileSec, 2, "mile 1 time");
  assertClose(splits[1].sec, mileSec, 2, "mile 2 time");
  assertClose(splits[1].cumSec, 2 * mileSec, 3, "cumulative time");
  assertClose(splits[0].distM, MILE_M, 1e-9, "split length");
  assert(splits[2].distM < MILE_M, "trailing partial included");
});

Deno.test("crossings interpolate between sparse fixes", () => {
  // 30 m fix spacing at 3 m/s: the mile boundary falls mid-segment.
  // 119 segments x 30 m = 3570 m: 2 full miles + partial.
  const pts = filterFixes(lineFixes({ count: 120, speedMps: 3, dt: 10 }));
  const splits = computeSplits(pts);
  assert(splits.length === 3, `two miles + partial, got ${splits.length}`);
  assertClose(splits[0].sec, MILE_M / 3, 1, "interpolated split time");
  assertClose(splits[1].sec, MILE_M / 3, 1, "second split time");
});

Deno.test("split unit is configurable; partial trailing splits included", () => {
  const pts = filterFixes(lineFixes({ count: 1300, speedMps: 3 }));
  const splits = computeSplits(pts, { splitM: KM_M });
  // 1299 raw segments ~3897 m: 3 full km plus a ~897 m partial.
  assert(splits.length === 4, `3 km + partial, got ${splits.length}`);
  assertClose(splits[0].sec, KM_M / 3, 2, "km split time");
  assert(splits[3].distM < KM_M && splits[3].distM > 800, "partial length");
  assert(computeSplits([]).length === 0, "no points, no splits");
});
