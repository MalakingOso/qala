/* Week ribbon logic (DESIGN 6.3, DECISIONS U20): three weeks side by side with
 * one in focus. Past weeks read as done, the future week as planned, and the
 * line between them sits at today. Pure rollups so the component only draws. */

import type { WeekLoad } from "../store/types.ts";
import { weekTotals } from "./weeklyLoad.ts";

function n(v: number) {
  return v.toLocaleString("en-US");
}

/** "2,590 of 2,670 done", "2,240 done of 2,780 planned", "2,860 planned". */
export function weekSummary(week: WeekLoad): string {
  const t = weekTotals(week.days);
  if (week.relation === "future") return `${n(t.planned)} planned`;
  if (week.relation === "past") {
    return t.done >= t.planned
      ? `${n(t.done)} done`
      : `${n(t.done)} of ${n(t.planned)} done`;
  }
  return `${n(t.done)} done of ${n(t.planned)} planned`;
}

export type DayTime = "past" | "today" | "future";

/** Whether a day is behind us, now, or still to come, for the whole ribbon. */
export function dayTime(week: WeekLoad, dayIndex: number): DayTime {
  if (week.relation === "past") return "past";
  if (week.relation === "future") return "future";
  const today = week.days.findIndex((d) => d.today);
  if (today < 0) return "future";
  return dayIndex < today ? "past" : dayIndex === today ? "today" : "future";
}
