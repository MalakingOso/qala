/* Week-load aggregation for the Today hero and Body charts. Pure rollup over
 * the WeekLoadDay rows the engine bindings feed the UI. */

import type { WeekLoadDay } from "../store/types.ts";

export interface WeekTotals {
  liftDone: number;
  runDone: number;
  liftPlanned: number;
  runPlanned: number;
  done: number;
  planned: number;
}

export function weekTotals(days: WeekLoadDay[]): WeekTotals {
  const t: WeekTotals = {
    liftDone: 0,
    runDone: 0,
    liftPlanned: 0,
    runPlanned: 0,
    done: 0,
    planned: 0,
  };
  for (const d of days) {
    t.liftDone += d.liftDone;
    t.runDone += d.runDone;
    t.liftPlanned += d.liftPlanned;
    t.runPlanned += d.runPlanned;
  }
  t.done = t.liftDone + t.runDone;
  t.planned = t.liftPlanned + t.runPlanned;
  return t;
}
