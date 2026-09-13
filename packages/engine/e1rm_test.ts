// e1RM 4 observation rules (PLAN 6.2 / B6) + RTS table provenance.
import { observeSet, bestObservation } from "./e1rm.ts";
import { rtsLookup, RTS_VERIFICATION_STATUS } from "./rtsTable.ts";
import { assert, assertClose } from "./testutil.ts";

Deno.test("rule 1: single at RPE>=9.5 is tested 1RM", () => {
  const o = observeSet({ w: 200, r: 1, rpe: 9.5, completed: true });
  assert(o !== null && o.e1rm === 200 && o.tested, "tested single");
});

Deno.test("rule 1: flagged test attempt at any RPE", () => {
  const o = observeSet({ w: 190, r: 1, rpe: 8, completed: true, tested1rm: true });
  assert(o !== null && o.e1rm === 190 && o.tested, "flagged test");
});

Deno.test("rule 2: RPE logged, reps+RIR<=10 uses RTS table", () => {
  // 100 x 5 @ RPE 8 -> RTS 81.1 (== 6 @ 9 by the one-column shift) -> 123.30
  const o = observeSet({ w: 100, r: 5, rpe: 8, completed: true });
  assert(o !== null && !o.tested, "observed");
  assertClose(o!.e1rm, 100 / 0.811, 0.05, "rts 5@8");
  // 6 @ 10 = 83.7 agrees with Helms 2016 (~83% 6RM)
  const o6 = observeSet({ w: 83.7, r: 6, rpe: 10, completed: true });
  assertClose(o6!.e1rm, 100, 0.05, "6@10 helms anchor");
});

Deno.test("rule 3: no RPE, reps<=10 uses Epley with target-RPE RIR", () => {
  const o = observeSet({ w: 100, r: 5, completed: true, targetRpe: 8 });
  assertClose(o!.e1rm, 100 * (1 + 7 / 30), 1e-9, "epley target rir");
  const o2 = observeSet({ w: 100, r: 5, completed: true });
  assertClose(o2!.e1rm, 100 * (1 + 5 / 30), 1e-9, "epley rir 0");
  // single with reps+RIR=1 -> load exactly
  const o3 = observeSet({ w: 150, r: 1, completed: true });
  assert(o3!.e1rm === 150, "single no rpe");
});

Deno.test("rule 4: reps>10 gives no observation", () => {
  assert(observeSet({ w: 60, r: 12, rpe: 9, completed: true }) === null, "12 @9 none");
  assert(observeSet({ w: 60, r: 12, completed: true }) === null, "12 no-rpe none");
});

Deno.test("bestObservation picks max, skips warmup and incomplete", () => {
  const b = bestObservation([
    { w: 100, r: 5, rpe: 8, completed: true },
    { w: 200, r: 5, rpe: 8, completed: true, warmup: true },
    { w: 105, r: 5, rpe: 8, completed: false },
    { w: 102, r: 5, rpe: 8, completed: true },
  ]);
  assertClose(b!.e1rm, 102 / 0.811, 0.05, "best is 102 set");
});

Deno.test("RTS table marked unverified per PLAN 6.2", () => {
  assert(RTS_VERIFICATION_STATUS === "unverified-third-party-reproduction", "status");
  assert(rtsLookup(5, 8).verified === false, "cells unverified");
  assert(rtsLookup(5, 8).useRule3Fallback === false, "unflagged usable");
  assert(rtsLookup(7, 8).pct === null, "reps>6 off-table");
});
