import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  THETA_FREE_AT,
  THETA_PRIOR,
  thetaFree,
  thetaShown,
} from "./calibration.ts";
import { sampleLifts } from "../store/sample.ts";

test("a lift past 20 observations shows its estimate", () => {
  assert.deepStrictEqual(thetaShown({ theta: 3.62, obs: 34 }), {
    value: 3.62,
    source: "estimate",
    text: "3.6",
  });
});

test("a lift under 20 shows the prior, labelled, whatever is stored", () => {
  const held = {
    value: THETA_PRIOR,
    source: "prior",
    text: "4.0 (prior until 20)",
  };
  assert.deepStrictEqual(thetaShown({ theta: 4, obs: 18 }), held);
  assert.deepStrictEqual(thetaShown({ theta: 3.1, obs: 18 }), held);
  assert.deepStrictEqual(thetaShown({ theta: 4, obs: 0 }), held);
});

test("theta frees at exactly 20, as the engine's lock does", () => {
  assert.deepStrictEqual(THETA_FREE_AT, 20);
  assert.deepStrictEqual(thetaFree(19), false);
  assert.deepStrictEqual(thetaFree(20), true);
  assert.deepStrictEqual(thetaShown({ theta: 4.3, obs: 19 }).source, "prior");
  // At 20 the value still equals the prior, but it is the filter's now.
  assert.deepStrictEqual(thetaShown({ theta: 4, obs: 20 }).source, "estimate");
});

test("the sample: only Press is still held at the prior", () => {
  assert.deepStrictEqual(
    sampleLifts.map((l) => [l.id, thetaShown(l.calibration).source]),
    [
      ["squat", "estimate"],
      ["bench", "estimate"],
      ["deadlift", "estimate"],
      ["press", "prior"],
    ],
  );
});
