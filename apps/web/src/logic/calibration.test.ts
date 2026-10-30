import { assertEquals } from "@std/assert";
import {
  THETA_FREE_AT,
  THETA_PRIOR,
  thetaFree,
  thetaShown,
} from "./calibration.ts";
import { sampleLifts } from "../store/sample.ts";

Deno.test("a lift past 20 observations shows its estimate", () => {
  assertEquals(thetaShown({ theta: 3.62, obs: 34 }), {
    value: 3.62,
    source: "estimate",
    text: "3.6",
  });
});

Deno.test("a lift under 20 shows the prior, labelled, whatever is stored", () => {
  const held = {
    value: THETA_PRIOR,
    source: "prior",
    text: "4.0 (prior until 20)",
  };
  assertEquals(thetaShown({ theta: 4, obs: 18 }), held);
  assertEquals(thetaShown({ theta: 3.1, obs: 18 }), held);
  assertEquals(thetaShown({ theta: 4, obs: 0 }), held);
});

Deno.test("theta frees at exactly 20, as the engine's lock does", () => {
  assertEquals(THETA_FREE_AT, 20);
  assertEquals(thetaFree(19), false);
  assertEquals(thetaFree(20), true);
  assertEquals(thetaShown({ theta: 4.3, obs: 19 }).source, "prior");
  // At 20 the value still equals the prior, but it is the filter's now.
  assertEquals(thetaShown({ theta: 4, obs: 20 }).source, "estimate");
});

Deno.test("the sample: only Press is still held at the prior", () => {
  assertEquals(
    sampleLifts.map((l) => [l.id, thetaShown(l.calibration).source]),
    [
      ["squat", "estimate"],
      ["bench", "estimate"],
      ["deadlift", "estimate"],
      ["press", "prior"],
    ],
  );
});
