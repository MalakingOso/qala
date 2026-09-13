// load_test.ts: rTSS identity, GAP shape, VDOT against Daniels' table.

import {
  gapFactor,
  intensityFactor,
  ngpMps,
  riegelSeconds,
  rtss,
  rtssFromRun,
  thresholdPaceFromRace,
  vdot,
} from "./load.ts";
import { assert, assertClose } from "./testutil.ts";

Deno.test("one hour at threshold on flat ground is exactly rTSS 100", () => {
  const threshold = 4.0;
  const gapDist = threshold * 3600; // flat: GAP distance == distance
  const ngp = ngpMps(gapDist, 3600);
  assertClose(ngp, threshold, 1e-9, "NGP equals threshold speed");
  assertClose(intensityFactor(ngp, threshold), 1, 1e-12, "IF equals 1");
  assertClose(rtss(1, 1), 100, 1e-9, "rTSS equals 100");
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

Deno.test("GAP is monotonic uphill and floored downhill", () => {
  assertClose(gapFactor(0), 1, 1e-12, "flat is 1");
  assert(
    gapFactor(0.15) > gapFactor(0.1) &&
      gapFactor(0.1) > gapFactor(0.05) &&
      gapFactor(0.05) > 1,
    "uphill cost rises with grade",
  );
  assertClose(gapFactor(-0.09), 0.88, 1e-9, "downhill floored at 0.88");
  assertClose(gapFactor(-0.3), 1.0, 1e-12, "beyond -18% back to 1.0");
});

Deno.test("VDOT of a 20:00 5 km matches Daniels' table within 0.5", () => {
  assertClose(vdot(5000, 1200), 49.8, 0.5, "VDOT 5k 20:00");
});

Deno.test("Riegel doubles a 20:00 5 km to ~41:41 for 10 km", () => {
  assertClose(riegelSeconds(1200, 5000, 10000), 2501, 5, "Riegel 10 km");
  const threshold = thresholdPaceFromRace(5000, 1200);
  // ~42:55 10 km equivalent -> ~15.2 km in the hour -> ~4.2 m/s.
  assert(threshold > 3.9 && threshold < 4.5, `threshold sane: ${threshold}`);
});
