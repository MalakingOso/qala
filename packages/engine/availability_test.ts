// Availability: skipped days and training status. Vacation and sick shift
// the plan; break and injured rest in place; an injured muscle blocks its
// direct work and halves synergist work.
import {
  addDaysKey,
  applyInjuryToCheckin,
  classifyDay,
  coversDay,
  guardExercise,
  injuredOn,
  reasonOn,
  shiftsPlan,
  todayKey,
} from "./availability.ts";
import { recommendNextSession } from "./mod.ts";
import { initialState } from "./state.ts";
import { ReasonCode } from "./volume.ts";
import { assert, assertEqual } from "./testutil.ts";

Deno.test("a clear day trains", () => {
  assert(
    reasonOn("2026-09-13", { status: "active" }, []) === null,
    "active, no skips",
  );
  assertEqual(
    classifyDay("2026-09-13", { status: "active" }, []),
    "train",
    "classifies train",
  );
});

Deno.test("a one-day skip wins over the persistent status", () => {
  const avail = { status: "sick" as const, since: "2026-09-10" };
  assertEqual(
    reasonOn("2026-09-13", avail, [
      { date: "2026-09-13", reason: "break" as const },
    ]),
    "break",
    "skip wins",
  );
  assertEqual(
    reasonOn("2026-09-13", avail, [
      { date: "2026-09-12", reason: "break" as const },
    ]),
    "sick",
    "other-day skip ignored",
  );
});

Deno.test("status spans cover since through until, inclusive", () => {
  const avail = {
    status: "vacation" as const,
    since: "2026-09-10",
    until: "2026-09-12",
  };
  assert(!coversDay(avail, "2026-09-09"), "before since");
  assert(coversDay(avail, "2026-09-10"), "since");
  assert(coversDay(avail, "2026-09-12"), "until");
  assert(!coversDay(avail, "2026-09-13"), "after until");
  assert(!coversDay({ status: "active" }, "2026-09-11"), "active never");
  assert(
    coversDay({ status: "sick", since: "2026-09-10" }, "2027-01-01"),
    "no until stays on",
  );
});

Deno.test("vacation and sick shift the plan, the rest rest in place", () => {
  assert(shiftsPlan("vacation") && shiftsPlan("sick"), "shift");
  assert(
    !shiftsPlan("break") && !shiftsPlan("injured") && !shiftsPlan("scheduling"),
    "rest in place",
  );
  const skips = (
    reason: "break" | "vacation" | "sick" | "injured" | "scheduling",
  ) => [{ date: "2026-09-13", reason }];
  assertEqual(
    classifyDay("2026-09-13", { status: "active" }, skips("vacation")),
    "shift",
    "vacation shifts",
  );
  assertEqual(
    classifyDay("2026-09-13", { status: "active" }, skips("sick")),
    "shift",
    "sick shifts",
  );
  assertEqual(
    classifyDay("2026-09-13", { status: "active" }, skips("break")),
    "rest",
    "break rests",
  );
  assertEqual(
    classifyDay("2026-09-13", { status: "active" }, skips("injured")),
    "rest",
    "injured rests",
  );
  assertEqual(
    classifyDay("2026-09-13", { status: "active" }, skips("scheduling")),
    "rest",
    "scheduling rests",
  );
});

Deno.test("injured muscle resolves from skip first, then status", () => {
  assertEqual(
    injuredOn("2026-09-13", { status: "active" }, [
      { date: "2026-09-13", reason: "injured", muscle: "quads" },
    ]),
    ["quads"],
    "skip muscle",
  );
  assertEqual(
    injuredOn("2026-09-13", { status: "active" }, [
      { date: "2026-09-13", reason: "sick" },
    ]),
    [],
    "non-injured skip",
  );
  assertEqual(
    injuredOn("2026-09-13", {
      status: "injured",
      since: "2026-09-10",
      muscle: "calves",
    }, []),
    ["calves"],
    "status muscle",
  );
  assertEqual(
    injuredOn("2026-09-13", {
      status: "injured",
      since: "2026-09-10",
      until: "2026-09-12",
      muscle: "calves",
    }, []),
    [],
    "lapsed status",
  );
});

Deno.test("guard blocks direct targets and halves synergists", () => {
  assertEqual(
    guardExercise(["quads"], ["glutes"], ["quads"]),
    "skip",
    "direct target",
  );
  assertEqual(
    guardExercise(["chest"], ["triceps"], ["triceps"]),
    "halve",
    "synergist only",
  );
  assertEqual(
    guardExercise(["chest"], ["triceps"], ["quads"]),
    "train",
    "clear",
  );
  assertEqual(
    guardExercise(["chest"], undefined, ["triceps"]),
    "train",
    "no syn",
  );
  assertEqual(
    guardExercise(["chest"], ["triceps"], []),
    "train",
    "nobody hurt",
  );
  assertEqual(
    guardExercise(["quads"], [], ["Quadriceps"]),
    "skip",
    "body-map alias and case",
  );
});

Deno.test("injured muscles check in at soreness 4", () => {
  const out = applyInjuryToCheckin(
    { prs: 7, soreness: { quads: 2, glutes: 3 } },
    ["quads"],
  );
  assertEqual(out.soreness, { quads: 4, glutes: 3 }, "injured pinned to 4");
  assert(out.prs === 7, "prs untouched");
  const same = applyInjuryToCheckin({ prs: 7, soreness: { quads: 2 } }, []);
  assertEqual(same.soreness, { quads: 2 }, "no injuries, no change");
});

Deno.test("date keys add across month boundaries", () => {
  assertEqual(addDaysKey("2026-09-13", 0), "2026-09-13", "plus zero");
  assertEqual(addDaysKey("2026-09-30", 1), "2026-10-01", "month roll");
  assertEqual(addDaysKey("2026-09-13", 7), "2026-09-20", "plus week");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(todayKey()), "today is a key");
});

Deno.test("recommendations guard injured muscles without touching the rest", () => {
  const s = initialState();
  const ex = {
    exerciseId: "squat",
    targets: ["quads"],
    lastWeight: 245,
    sets: 4,
    reps: 5,
    targetRpe: 8,
    lowerBody: true,
  };
  const skip = recommendNextSession(s, [ex], "2026-09-13T18:00:00Z", {
    injuredMuscles: ["quads"],
  });
  assert(skip.lifts[0].targetSets === 0, "direct work off");
  assert(
    skip.reasons.includes(ReasonCode.INJURED_SKIP),
    "skip reason kept",
  );
  const halve = recommendNextSession(
    s,
    [{
      ...ex,
      exerciseId: "bench",
      targets: ["chest"],
      synergists: ["triceps"],
    }],
    "2026-09-13T18:00:00Z",
    { injuredMuscles: ["triceps"] },
  );
  assert(halve.lifts[0].targetSets === 2, "synergist work halved");
  assert(
    halve.reasons.includes(ReasonCode.INJURED_HALVE),
    "halve reason kept",
  );
  const clear = recommendNextSession(s, [ex], "2026-09-13T18:00:00Z", {
    injuredMuscles: ["triceps"],
  });
  assert(clear.lifts[0].targetSets === 4, "unrelated injury changes nothing");
  assert(
    !clear.reasons.includes(ReasonCode.INJURED_SKIP),
    "no stray reason",
  );
});
