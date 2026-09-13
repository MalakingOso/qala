// PLAN 6.5: dt across DST and month boundaries; decay math.
import { applyInput, daysBetween, decayValue, muscleTau } from "./decay.ts";
import { assert, assertClose } from "./testutil.ts";

Deno.test("daysBetween across US DST spring forward (Mar 8 2026)", () => {
  // Noon EST -> noon EDT next-next day = 47 h, not 48.
  const dt = daysBetween(
    "2026-03-07T12:00:00-05:00",
    "2026-03-09T12:00:00-04:00",
  );
  assertClose(dt, 47 / 24, 1e-9, "DST spring dt");
});

Deno.test("daysBetween across DST fall back", () => {
  const dt = daysBetween(
    "2026-10-31T12:00:00-04:00",
    "2026-11-02T12:00:00-05:00",
  );
  assertClose(dt, 49 / 24, 1e-9, "DST fall dt");
});

Deno.test("daysBetween across month boundary", () => {
  assertClose(
    daysBetween("2026-01-31T00:00:00Z", "2026-02-02T00:00:00Z"),
    2,
    1e-9,
    "month",
  );
  assertClose(
    daysBetween("2026-02-28T00:00:00Z", "2026-03-01T00:00:00Z"),
    1,
    1e-9,
    "feb-mar",
  );
});

Deno.test("decay equation x*exp(-dt/tau) + k*input", () => {
  assertClose(decayValue(100, 0, 45), 100, 1e-12, "dt0");
  assertClose(decayValue(100, 45, 45), 100 / Math.E, 1e-9, "tau");
  assertClose(applyInput(100, 45, 45, 2, 10), 100 / Math.E + 20, 1e-9, "input");
  assert(decayValue(100, -3, 45) === 100, "negative dt clamps");
});

Deno.test("muscle taus: 2.0 default, 2.5 posterior/large", () => {
  assert(muscleTau("chest") === 2.0, "chest");
  assert(muscleTau("triceps") === 2.0, "triceps");
  assert(muscleTau("quads") === 2.5, "quads");
  assert(muscleTau("hamstrings") === 2.5, "hams");
  assert(muscleTau("glutes") === 2.5, "glutes");
  assert(muscleTau("calves") === 2.5, "calves");
  assert(muscleTau("back") === 2.5, "back");
  assert(muscleTau("lats") === 2.5, "lats");
});
