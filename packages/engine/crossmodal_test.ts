// PLAN 6.5 bullet 4: cross-modal table boundaries + set-eq exclusion.
import {
  checkHeavyLiftBeforeRun,
  checkLiftBeforeHardRun,
  checkPostRace,
  checkRunBeforeLift,
  checkRunFatigueHold,
  checkSameDayOrder,
} from "./running.ts";
import { countSets, ReasonCode } from "./volume.ts";
import { assert } from "./testutil.ts";

const RUN = {
  minutes: 45,
  endedAtIso: "2026-01-06T22:00:00Z",
  distanceM: 10000,
  z: 1 as const,
};

Deno.test("row 1 run-before-lift fires on boundary, not below", () => {
  assert(
    checkRunBeforeLift(RUN, "2026-01-07T05:59:00Z", ["squat"]) !== null,
    "7:59 fires",
  );
  assert(
    checkRunBeforeLift(RUN, "2026-01-07T06:00:00Z", ["squat"]) === null,
    "8:00 does not",
  );
  assert(
    checkRunBeforeLift({ ...RUN, minutes: 30 }, "2026-01-07T05:00:00Z", [
      "deadlift",
    ]) !== null,
    "30 min fires",
  );
  assert(
    checkRunBeforeLift({ ...RUN, minutes: 29 }, "2026-01-07T05:00:00Z", [
      "deadlift",
    ]) === null,
    "29 min does not",
  );
  assert(
    checkRunBeforeLift(RUN, "2026-01-07T05:00:00Z", ["bench"]) === null,
    "upper body exempt",
  );
  assert(
    checkRunBeforeLift(RUN, "2026-01-07T05:00:00Z", ["lunge"]) !== null,
    "lunge covered",
  );
  assert(
    checkRunBeforeLift(RUN, "2026-01-07T05:00:00Z", ["leg-press"]) !== null,
    "leg press covered",
  );
});

Deno.test("row 2 lift-before-hard-run boundaries", () => {
  assert(checkLiftBeforeHardRun(8, 1.5, 30) !== null, "8 + z1.5 fires");
  assert(checkLiftBeforeHardRun(7.9, 1.5, 30) === null, "7.9 does not");
  assert(checkLiftBeforeHardRun(8, 1.0, 91) !== null, ">90 min fires");
  assert(checkLiftBeforeHardRun(8, 1.0, 90) === null, "90 min does not");
  assert(checkLiftBeforeHardRun(8, 1.0, 60) === null, "easy short does not");
});

Deno.test("row 3 same-day order boundaries", () => {
  const lift = "2026-01-07T08:00:00Z";
  assert(
    checkSameDayOrder(lift, "2026-01-07T14:00:00Z", true, false) === null,
    "6 h gap ok",
  );
  assert(
    checkSameDayOrder(lift, "2026-01-07T13:59:00Z", true, false) !== null,
    "<6 h warns",
  );
  assert(
    checkSameDayOrder(lift, "2026-01-08T07:00:00Z", true, true) !== null,
    "23 h warns for strength",
  );
  assert(
    checkSameDayOrder(lift, "2026-01-08T08:00:00Z", true, true) === null,
    "24 h ok for strength",
  );
  assert(
    checkSameDayOrder(
      "2026-01-07T18:00:00Z",
      "2026-01-07T08:00:00Z",
      true,
      false,
    ) !== null,
    "run-first warns",
  );
  assert(
    checkSameDayOrder(lift, "2026-01-07T14:00:00Z", false, false) === null,
    "different days silent",
  );
});

Deno.test("row 4 run-fatigue hold above one typical session", () => {
  assert(checkRunFatigueHold(8.01, 0) !== null, "above holds");
  assert(checkRunFatigueHold(0, 8.01) !== null, "calf above holds");
  assert(checkRunFatigueHold(8, 8) === null, "at threshold no hold");
});

Deno.test("rows 5-6 post-race boundaries", () => {
  assert(
    checkPostRace(21000, 1)?.code === ReasonCode.POST_RACE_48H,
    "half at z1",
  );
  assert(checkPostRace(20900, 1) === null, "20.9 km silent");
  assert(checkPostRace(21000, 0.5) === null, "half easy silent");
  assert(
    checkPostRace(42000, 0.5)?.code === ReasonCode.POST_RACE_5D,
    "marathon any pace",
  );
  assert(
    checkPostRace(41900, 1.5)?.code === ReasonCode.POST_RACE_48H,
    "41.9k hard still 48h",
  );
  assert(checkPostRace(41900, 0.5) === null, "41.9 km easy silent");
});

Deno.test("row 7 heavy lift before run", () => {
  assert(checkHeavyLiftBeforeRun(true) !== null, "heavy flags");
  assert(checkHeavyLiftBeforeRun(false) === null, "no heavy silent");
});

Deno.test("running set-equivalents never change weekly set counts", () => {
  const sets = [
    { muscle: "quads", direct: true, hard: true },
    { muscle: "quads", direct: true, hard: true, runningEquivalent: true },
    { muscle: "quads", direct: false, hard: true, runningEquivalent: true },
  ];
  const c = countSets(sets);
  assert(
    c.direct === 1 && c.frac === 1,
    `run eq excluded: ${JSON.stringify(c)}`,
  );
});
