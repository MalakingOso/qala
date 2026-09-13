// PLAN 6.5 bullet 2: hybrid week.
import { logSession, predictReadiness, recommendNextSession } from "./mod.ts";
import { initialState, type RunWorkout } from "./state.ts";
import { ReasonCode } from "./volume.ts";
import { assert, assertClose } from "./testutil.ts";

function tempo10k(endIso: string): RunWorkout {
  // 10 km tempo, 45 min -> ends at endIso.
  const end = Date.parse(endIso);
  return {
    kind: "run",
    id: "tempo1",
    date: new Date(end - 45 * 60000).toISOString(),
    distanceM: 10000,
    movingSec: 2700,
    elapsedSec: 2700,
    srpe: 8,
    minutes: 45,
  };
}

const SQUAT_EX = [{
  exerciseId: "squat",
  targets: ["quads"],
  lastWeight: 100,
  sets: 4,
  reps: 5,
  targetRpe: 8,
  lowerBody: true,
}];

Deno.test("10k tempo the evening before squat day lowers expected reps + quad readiness", () => {
  let s = initialState();
  s = logSession(s, tempo10k("2026-01-06T22:30:00Z")); // starts 21:45, ends 22:30
  // Run ends 22:30, lift at 05:30 -> 7.0 h gap (< 8 h rule).
  const rec = recommendNextSession(s, SQUAT_EX, "2026-01-07T05:30:00Z");
  assert(
    rec.reasons.includes(ReasonCode.RUN_BEFORE_LIFT),
    `run-before-lift fires: ${rec.reasons}`,
  );
  assert(
    rec.lifts[0].targetReps === 4,
    `expected reps -1: ${rec.lifts[0].targetReps}`,
  );

  const fresh = initialState();
  const rFresh = predictReadiness(fresh, { prs: 7, soreness: { quads: 1 } }, [
    "quads",
  ]);
  const rRun = predictReadiness(s, { prs: 7, soreness: { quads: 1 } }, [
    "quads",
  ]);
  assert(
    rRun.score < rFresh.score,
    `quad readiness lower after tempo: ${rRun.score} < ${rFresh.score}`,
  );
});

Deno.test("same run 30 h earlier does not trigger the <8 h rule", () => {
  let s = initialState();
  s = logSession(s, tempo10k("2026-01-05T23:30:00Z")); // starts 22:45, ends 23:30
  // Lift 2026-01-07T05:30 -> gap 30 h from the run's end.
  const rec = recommendNextSession(s, SQUAT_EX, "2026-01-07T05:30:00Z");
  assert(
    !rec.reasons.includes(ReasonCode.RUN_BEFORE_LIFT),
    `no run-before-lift: ${rec.reasons}`,
  );
  assert(rec.lifts[0].targetReps === 5, "reps unchanged");
});

Deno.test("run-before-lift gap is measured from the run's end, not its start", () => {
  // A 2 h run starting 21:00, ending 23:00. Lift at 06:30 next day:
  // true gap from the end is 7.5 h (< 8 h, must fire); gap from the run's
  // own start would be 9.5 h (>= 8 h) -- the bug this guards against used
  // the start as if it were the end and so missed this case.
  const longRun: RunWorkout = {
    kind: "run",
    id: "long1",
    date: "2026-01-06T21:00:00Z",
    distanceM: 16000,
    movingSec: 7200,
    elapsedSec: 7200,
    srpe: 8,
    minutes: 120,
  };
  let s = initialState();
  s = logSession(s, longRun);
  const rec = recommendNextSession(s, SQUAT_EX, "2026-01-07T06:30:00Z");
  assert(
    rec.reasons.includes(ReasonCode.RUN_BEFORE_LIFT),
    `run-before-lift fires on the true 7.5 h gap: ${rec.reasons}`,
  );
});

Deno.test("400 m-descent trail run adds to D_m; repeat within 42 d adds less (RBE)", () => {
  const trail = (date: string, id: string) => ({
    kind: "run" as const,
    id,
    date,
    distanceM: 12000,
    movingSec: 5400,
    elapsedSec: 5400,
    descentM: 400,
    srpe: 5,
    minutes: 90,
  });
  let s1 = initialState();
  s1 = logSession(s1, trail("2026-01-01T10:00:00Z", "t1"));
  const first = s1.fatigueDamage["quads"] ?? 0;
  assert(first > 0, "descent adds quad damage");

  // Fresh state, same run but with a prior 200 m+ descent run 10 d earlier.
  let s2 = initialState();
  s2 = logSession(s2, trail("2025-12-22T10:00:00Z", "t0"));
  const before = s2.fatigueDamage["quads"] ?? 0;
  s2 = logSession(s2, trail("2026-01-01T10:00:00Z", "t1"));
  // Decay the pre-existing damage over the 10 d gap to isolate the new input.
  const decayed = before * Math.exp(-10 / 5);
  const second = (s2.fatigueDamage["quads"] ?? 0) - decayed;
  assert(
    second > 0 && second < first,
    `RBE reduces repeat damage: ${second} < ${first}`,
  );
  assertClose(second / first, 1 - 0.035, 0.02, "RBE ratio ~0.965");
});
