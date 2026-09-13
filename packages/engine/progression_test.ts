// PLAN 6.5 bullet 6: RP table, deload triggers, Helms cap, envelope, plates.
import { clampSets, clampWeightPct, recommendNextSession } from "./mod.ts";
import { initialState } from "./state.ts";
import {
  bandTarget,
  blockStartFrac,
  countSets,
  doubleProgression,
  helmsAdjust,
  isHardSet,
  isWorkSet,
  mondayKey,
  rampWeek,
  ReasonCode,
  roundWeight,
  rpProgression,
  rpRow,
  wholeBodyDeload,
} from "./volume.ts";
import { assert, assertClose, assertEqual } from "./testutil.ts";

Deno.test("RP rule table", () => {
  assertEqual(
    rpProgression(1, 1, 7),
    { sets: 2, code: ReasonCode.RP_ADD_2 },
    "1/1 -> +2",
  );
  assertEqual(
    rpProgression(2, 2, 7),
    { sets: 1, code: ReasonCode.RP_ADD_1 },
    "2/2 -> +1",
  );
  assertEqual(
    rpProgression(1, 2, 7),
    { sets: 1, code: ReasonCode.RP_ADD_1 },
    "1/2 -> +1",
  );
  assert(rpProgression(3, 2, 7).code === ReasonCode.RP_HOLD, "any 3 holds");
  assert(rpProgression(2, 3, 7).code === ReasonCode.RP_HOLD, "perf 3 holds");
  assert(rpProgression(1, 2, 7).sets === 1, "+1 set");
  const d = rpProgression(2, 4, 7);
  assert(
    d.code === ReasonCode.MUSCLE_DELOAD && "deload" in d,
    "perf 4 deloads",
  );
  const d2 = rpProgression(2, 2, 4);
  assert(d2.code === ReasonCode.MUSCLE_DELOAD, "prs<=4 deloads");
  assert(
    rpProgression(4, 2, 7).code === ReasonCode.RP_HOLD,
    "soreness 4 holds",
  );
  assert(
    rpProgression(2, 2, 5).code === ReasonCode.RP_ADD_1,
    "prs 5 progresses",
  );
});

Deno.test("whole-body deload trigger: two lifts below median twice", () => {
  const yes = wholeBodyDeload(
    { squat: [180, 182], bench: [120, 122] },
    { squat: 190, bench: 130 },
  );
  assert(
    yes.deload && yes.setsFactor === 0.6 && yes.loadFactor === 0.9 &&
      yes.days === 7,
    "deload 5-7d",
  );
  const one = wholeBodyDeload({ squat: [180, 182], bench: [120, 135] }, {
    squat: 190,
    bench: 130,
  });
  assert(!one.deload, "one lift recovering: no deload");
  const once = wholeBodyDeload({ squat: [180, 192], bench: [120, 122] }, {
    squat: 190,
    bench: 130,
  });
  assert(!once.deload, "one session only: no deload");
});

Deno.test("Helms in-session cap +/-6%", () => {
  assertClose(helmsAdjust(8, 8).factor, 1, 1e-12, "on target");
  assertClose(helmsAdjust(8.5, 8).pct, -2, 1e-9, "0.5 high -> -2%");
  assertClose(helmsAdjust(7, 8).pct, 4, 1e-9, "1 low -> +4%");
  assertClose(helmsAdjust(11, 8).pct, -6, 1e-9, "caps at -6");
  assertClose(helmsAdjust(5, 8).pct, 6, 1e-9, "caps at +6");
});

Deno.test("envelope clamping", () => {
  assert(clampWeightPct(5) === 2.5, "weight +5 -> +2.5");
  assert(clampWeightPct(-15) === -10, "weight -15 -> -10");
  assert(clampWeightPct(2) === 2, "inside untouched");
  assert(clampSets(3) === 1, "sets +3 -> +1");
  assert(clampSets(-3) === -2, "sets -3 -> -2");
});

Deno.test("plate rounding to 5 lb", () => {
  assert(roundWeight(203) === 205, "203->205");
  assert(roundWeight(202) === 200, "202->200");
  assert(roundWeight(102.5) === 105, "102.5->105");
});

Deno.test("recommendation clamps double progression into envelope", () => {
  const s = initialState();
  const rec = recommendNextSession(s, [{
    exerciseId: "squat",
    targets: ["quads"],
    lastWeight: 100,
    sets: 4,
    reps: 5,
    targetRpe: 8,
    lowerBody: true,
    lastTwoHits: [true, true],
  }], "2026-01-07T18:00:00Z");
  // Lower-body double progression wants +5%; envelope caps at +2.5.
  assert(
    rec.lifts[0].recWeightPct === 2.5,
    `clamped: ${rec.lifts[0].recWeightPct}`,
  );
  assert(rec.reasons.includes(ReasonCode.DOUBLE_PROGRESSION), "reason kept");
});

Deno.test("double progression needs two consecutive hits", () => {
  const dp = doubleProgression(100, false, [true, false]);
  assert(!dp.increase, "one hit: no increase");
  const up = doubleProgression(100, false, [true, true]);
  assert(up.increase && up.factor === 1.025, "upper +2.5%");
  const lo = doubleProgression(100, true, [true, true]);
  assert(lo.increase && lo.factor === 1.05, "lower +5%");
});

Deno.test("volume counting: work/hard/direct/frac + RP rows + bands", () => {
  assert(!isWorkSet({ completed: false }), "incomplete not work");
  assert(!isWorkSet({ completed: true, warmup: true }), "warmup not work");
  assert(
    !isWorkSet({ completed: true, load: 40, referenceRm: 100, isMain: true }),
    "main <50% not work",
  );
  assert(
    isWorkSet({ completed: true, load: 50, referenceRm: 100, isMain: true }),
    "main 50% is work",
  );
  assert(isHardSet(7) && !isHardSet(6.5), "logged rpe gate");
  assert(
    isHardSet(undefined, 7) && !isHardSet(undefined, 6.5),
    "target rpe gate",
  );
  const c = countSets([
    { muscle: "chest", direct: true, hard: true },
    { muscle: "chest", direct: false, hard: true },
    { muscle: "chest", direct: true, hard: false },
  ]);
  assert(c.direct === 1 && c.frac === 1.5, `direct/frac: ${JSON.stringify(c)}`);
  assertEqual(rpRow("chest").mev, [4, 6], "chest mev");
  assertEqual(rpRow("forearms").mev, [4, 6], "no-row uses chest");
  assertEqual(rpRow("back").mev, [12, 14], "back mev");
  const grow = bandTarget("chest", "grow");
  assert(grow.fracMin === 10 && grow.fracMax === 20, "grow band");
  const emph = bandTarget("chest", "emphasise");
  assert(emph.fracMin === 14 && emph.fracMax === 20, "emphasise band");
  const maint = bandTarget("chest", "maintain");
  assert(
    maint.fracMin === null && maint.directMin === 4 && maint.directMax === 6,
    "maintain MV..MEV",
  );
  assert(blockStartFrac("chest", "grow", 2) === 10, "chest start");
  assert(blockStartFrac("back", "grow", 0) === 14, "back starts at 14");
  assert(
    rampWeek(10, 1) === 10 && rampWeek(10, 5) === 18 && rampWeek(14, 5) === 20,
    "ramp +2 capped",
  );
  assert(mondayKey("2026-01-07T18:00:00Z") === "2026-01-05", "wed -> monday");
  assert(
    mondayKey("2026-01-04T18:00:00Z") === "2025-12-29",
    "sunday -> prior monday",
  );
});
