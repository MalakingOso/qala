// PLAN 6.6 tests: table cells, clamps, failure-vs-effort, m learning.
import {
  computeRest,
  earlyStartWarning,
  learnRestMultiplier,
  restCell,
  REST_AFTER_PAIR,
} from "./rest.ts";
import { ReasonCode } from "./volume.ts";
import { assert, assertClose } from "./testutil.ts";

Deno.test("every table cell and clamp", () => {
  const expect: [string, string, number, number, number][] = [
    ["strength", "main", 180, 120, 300],
    ["strength", "secondary", 150, 90, 240],
    ["strength", "isolation", 90, 60, 150],
    ["hypertrophy", "main", 150, 90, 240],
    ["hypertrophy", "secondary", 120, 90, 180],
    ["hypertrophy", "isolation", 90, 60, 150],
    ["maintenance", "main", 150, 90, 240],
    ["maintenance", "secondary", 120, 90, 180],
    ["maintenance", "isolation", 90, 60, 150],
  ];
  for (const [a, c, b, mn, mx] of expect) {
    const cell = restCell(a as "strength", c as "main");
    assert(cell.base === b && cell.min === mn && cell.max === mx, `${a}/${c}`);
  }
  // Clamps bind: strength main max 300, isolation min 60.
  const hi = computeRest({ approach: "strength", cls: "main", failed: true, repsShort: true, setIndex: 5, drift: true, lowReadiness: true });
  assert(hi.seconds === 300, `max clamp: ${hi.seconds}`);
  const lo = computeRest({ approach: "hypertrophy", cls: "isolation", rpeLogged: 6, rpeTarget: 9 });
  assert(lo.seconds === 60, `min clamp: ${lo.seconds}`);
});

Deno.test("failure replaces effort", () => {
  const f = computeRest({ approach: "strength", cls: "main", rpeLogged: 10, rpeTarget: 8, failed: true });
  assert(f.seconds === 240 && f.reasons.includes(ReasonCode.REST_FAILURE), `fail: ${f.seconds}`);
  assert(!f.reasons.includes(ReasonCode.REST_EFFORT_HIGH), "no effort stacked");
  const fi = computeRest({ approach: "strength", cls: "isolation", failed: true });
  assert(fi.seconds === 120, `isolation fail +30: ${fi.seconds}`);
  const e = computeRest({ approach: "strength", cls: "main", rpeLogged: 9, rpeTarget: 8 });
  assert(e.seconds === 210 && e.reasons.includes(ReasonCode.REST_EFFORT_HIGH), `effort: ${e.seconds}`);
  const el = computeRest({ approach: "strength", cls: "main", rpeLogged: 7, rpeTarget: 8 });
  assert(el.seconds === 150 && el.reasons.includes(ReasonCode.REST_EFFORT_LOW), `easy: ${el.seconds}`);
});

Deno.test("short reps, late sets, drift, readiness each +30", () => {
  assert(computeRest({ approach: "hypertrophy", cls: "secondary", repsShort: true }).seconds === 150, "short");
  assert(computeRest({ approach: "strength", cls: "main", setIndex: 4 }).seconds === 210, "late set");
  assert(computeRest({ approach: "strength", cls: "main", setIndex: 2 }).seconds === 180, "early set none");
  assert(computeRest({ approach: "hypertrophy", cls: "secondary", drift: true }).seconds === 150, "drift");
  assert(computeRest({ approach: "hypertrophy", cls: "secondary", lowReadiness: true }).seconds === 150, "readiness");
  // Late set + drift together still +30 once (larger of the two).
  assert(computeRest({ approach: "strength", cls: "main", setIndex: 5, drift: true }).seconds === 210, "no double");
});

Deno.test("explicit timers replace base; clamps/adjustments/m still apply", () => {
  const r = computeRest({ approach: "strength", cls: "main", explicitBase: 60, failed: true });
  assert(r.base === 60 && r.seconds === 120, `explicit: ${r.seconds}`);
});

Deno.test("superset override 90 s, 60 s over budget", () => {
  const s = computeRest({ approach: "hypertrophy", cls: "secondary", superset: true });
  assert(s.seconds === 90 && s.reasons.includes(ReasonCode.REST_SUPERSET), "pair 90");
  const t = computeRest({ approach: "hypertrophy", cls: "secondary", superset: true, overTimeBudget: true });
  assert(t.seconds === 60, "pair 60 over budget");
  assert(REST_AFTER_PAIR === 120, "120 after pair");
});

Deno.test("early-start warning only below min on strength main", () => {
  assert(earlyStartWarning("strength", "main", 180, 90), "warns");
  assert(!earlyStartWarning("strength", "main", 180, 150), "above min silent");
  assert(!earlyStartWarning("hypertrophy", "main", 150, 60), "non-strength silent");
});

Deno.test("m after 10 on-target early taps at 90 s with B 120 is ~0.837", () => {
  let cur = { m: 1, samples: 0 };
  for (let i = 0; i < 10; i++) {
    const r = learnRestMultiplier(cur, { m: cur.m, B: 120, adjustments: 0, actual: 90, prescribed: 120, hitTarget: true });
    cur = { m: r.m, samples: r.samples };
    assert(r.updated, "updated");
  }
  assertClose(cur.m, 0.75 + 0.25 * Math.pow(0.9, 10), 0.001, `m=${cur.m}`);
});

Deno.test("early miss never lowers m; warmup never updates", () => {
  const before = { m: 0.9, samples: 5 };
  const miss = learnRestMultiplier(before, { m: 0.9, B: 120, adjustments: 0, actual: 60, prescribed: 120, hitTarget: false });
  assert(!miss.updated && miss.m === 0.9, "early miss ignored");
  const full = learnRestMultiplier(before, { m: 0.9, B: 120, adjustments: 0, actual: 120, prescribed: 120, hitTarget: false });
  assert(full.updated && full.m > 0.9, "full-rest miss raises m");
  const wu = learnRestMultiplier(before, { m: 0.9, B: 120, adjustments: 0, actual: 60, prescribed: 120, hitTarget: true, warmup: true });
  assert(!wu.updated && wu.m === 0.9, "warmup ignored");
});
