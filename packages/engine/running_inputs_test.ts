// PLAN 6.5 bullet 3: running inputs.
import {
  gapDistanceM,
  gapFactor,
  gradeAdjustedPace,
  gradeAdjustedSpeed,
  intensityFactor,
  minettiRatio,
  ngpFromGapDistance,
  riegel,
  rtss,
  rtssFromRun,
  thresholdPaceFromRace,
  vdotFromEffort,
} from "./running.ts";
import { assert, assertClose } from "./testutil.ts";

Deno.test("rTSS equals 100 for one hour at threshold on flat", () => {
  const IF = intensityFactor(3.0, 3.0); // NGP == threshold
  assert(IF === 1, "IF=1");
  assert(rtss(1, IF) === 100, "rTSS=100");
});

Deno.test("grade adjustment monotonic uphill, floored downhill", () => {
  const g0 = gapFactor(0);
  assertClose(g0, 1, 1e-9, "flat=1");
  assert(gapFactor(0.05) > g0, "uphill costs more");
  assert(gapFactor(0.1) > gapFactor(0.05), "monotonic");
  assert(gapFactor(0.15) > gapFactor(0.1), "monotonic 2");
  assertClose(gapFactor(0.1), minettiRatio(0.1), 1e-9, "uphill is Minetti");
  assert(gapFactor(-0.1) >= 0.88, "downhill floor 0.88");
  assert(gapFactor(-0.3) === 1.0, "beyond -18% capped at 1.0");
  assert(gapFactor(-0.18) === 1.0, "at -18% is 1.0");
});

Deno.test("VDOT from synthetic efforts matches Daniels within 0.5", () => {
  // 5000 m in 20:00 -> Daniels VDOT ~50; 10000 m in 40:00 -> ~52.
  const v = vdotFromEffort(5000, 1200);
  assertClose(v, 50, 0.5, `vdot=${v}`);
  const v2 = vdotFromEffort(10000, 2400);
  assertClose(v2, 52, 0.5, `vdot2=${v2}`);
  // Faster is fitter (monotonic).
  assert(vdotFromEffort(5000, 1100) > v, "monotonic");
});

Deno.test("one hour at threshold on flat ground is exactly rTSS 100 from a run", () => {
  const threshold = 4.0;
  const gapDist = gapDistanceM([{ grade: 0, meters: threshold * 3600 }]);
  const ngp = ngpFromGapDistance(gapDist, 3600);
  assertClose(ngp, threshold, 1e-9, "NGP equals threshold speed");
  assertClose(intensityFactor(ngp, threshold), 1, 1e-12, "IF equals 1");
  assertClose(
    rtssFromRun({
      gapDistM: gapDist,
      movingSec: 3600,
      thresholdMps: threshold,
    }),
    100,
    1e-9,
    "convenience helper agrees",
  );
});

Deno.test("run load helpers guard zero and NaN instead of returning Infinity", () => {
  assert(
    rtssFromRun({ gapDistM: 1000, movingSec: 300, thresholdMps: 0 }) === 0,
    "zero threshold",
  );
  assert(
    rtssFromRun({ gapDistM: 1000, movingSec: 0, thresholdMps: 4 }) === 0,
    "zero moving time",
  );
  assert(
    rtssFromRun({ gapDistM: NaN, movingSec: 300, thresholdMps: 4 }) === 0,
    "NaN distance",
  );
  assert(ngpFromGapDistance(500, 0) === 0, "no time, no pace");
  assert(gradeAdjustedSpeed(0, 0.05) === 0, "no speed");
  assert(gradeAdjustedPace(0, 0.05) === Infinity, "no pace");
  assertClose(
    gradeAdjustedSpeed(3, 0.1),
    3 * gapFactor(0.1),
    1e-12,
    "speed scales by the factor",
  );
  assertClose(
    gradeAdjustedPace(0.4, 0.1),
    0.4 / gapFactor(0.1),
    1e-12,
    "pace divides by it",
  );
  assertClose(
    gapDistanceM([
      { grade: 0, meters: 1000 },
      { grade: 0.1, meters: 1000 },
      { grade: 0.1, meters: -50 },
    ]),
    1000 + 1000 * gapFactor(0.1),
    1e-9,
    "negative lengths are skipped",
  );
});

Deno.test("Riegel doubles a 20:00 5 km to ~41:41 for 10 km", () => {
  assertClose(riegel(1200, 5000, 10000), 2501, 5, "Riegel 10 km");
  const threshold = thresholdPaceFromRace(5000, 1200);
  // ~42:55 10 km equivalent -> ~15.2 km in the hour -> ~4.2 m/s.
  assert(threshold > 3.9 && threshold < 4.5, `threshold sane: ${threshold}`);
});
