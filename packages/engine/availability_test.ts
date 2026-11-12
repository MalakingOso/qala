// Availability: skipped days and training status. Vacation and sick shift
// the plan; break and injured rest in place; an injured muscle blocks its
// direct work and halves synergist work.

import { test } from "bun:test";
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
import { assert, assertEqual } from "./testutil.ts";

test("a clear day trains", () => {
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

test("a one-day skip wins over the persistent status", () => {
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

test("status spans cover since through until, inclusive", () => {
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

test("vacation and sick shift the plan, the rest rest in place", () => {
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

test("injured muscle resolves from skip first, then status", () => {
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

test("guard blocks direct targets and halves synergists", () => {
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

test("injured muscles check in at soreness 4", () => {
  const out = applyInjuryToCheckin(
    { prs: 7, soreness: { quads: 2, glutes: 3 } },
    ["quads"],
  );
  assertEqual(out.soreness, { quads: 4, glutes: 3 }, "injured pinned to 4");
  assert(out.prs === 7, "prs untouched");
  const same = applyInjuryToCheckin({ prs: 7, soreness: { quads: 2 } }, []);
  assertEqual(same.soreness, { quads: 2 }, "no injuries, no change");
});

test("date keys add across month boundaries", () => {
  assertEqual(addDaysKey("2026-09-13", 0), "2026-09-13", "plus zero");
  assertEqual(addDaysKey("2026-09-30", 1), "2026-10-01", "month roll");
  assertEqual(addDaysKey("2026-09-13", 7), "2026-09-20", "plus week");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(todayKey()), "today is a key");
});
