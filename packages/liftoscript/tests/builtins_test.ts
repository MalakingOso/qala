// All 60 builtin programs parse and evaluate without error (PLAN section 5).

import { assert, assertEquals } from "@std/assert";
import { forceEvaluateText, qalaSettingsToLiftoscript } from "../mod.ts";
import type { ISettings } from "../src/types.ts";
import { builtinProgramNames, loadBuiltinProgram } from "./helpers.ts";

function testSettings(): ISettings {
  return qalaSettingsToLiftoscript(
    { units: { weight: "lb", distance: "mi" } } as never,
  );
}

Deno.test("builtins: all 60 programs parse and evaluate without error", () => {
  const settings = testSettings();
  const names = builtinProgramNames();
  assertEquals(
    names.length,
    60,
    `expected 60 builtin programs, found ${names.length}`,
  );
  for (const name of names) {
    const programText = loadBuiltinProgram(name);
    const prog = forceEvaluateText(programText, name, settings);
    assertEquals(
      prog.errors.map((e) =>
        `${e.dayData.week}/${e.dayData.dayInWeek}: ${String(e.error)}`
      ),
      [],
      `${name} evaluates without errors`,
    );
    const exerciseCount = prog.weeks.reduce(
      (memo, week) =>
        memo + week.days.reduce((m, day) => m + day.exercises.length, 0),
      0,
    );
    assert(exerciseCount > 0, `${name} evaluates to at least one exercise`);
  }
});
