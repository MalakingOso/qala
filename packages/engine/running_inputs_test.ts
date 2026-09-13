// PLAN 6.5 bullet 3: running inputs.
import { gapFactor, intensityFactor, rtss, vdotFromEffort, minettiRatio } from "./running.ts";
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
