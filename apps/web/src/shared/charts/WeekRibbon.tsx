/* Week ribbon (DESIGN 6.3, DECISIONS U20): three weeks side by side with one
 * in focus, so a week reads against the one before it and the one coming.
 * Each bar is the same one as the single-week strip (U13): height is the
 * day's load, the fill is the part done, a glyph and a letter sit under it.
 * What is new is time. Everything behind today sits on a gray wash, today
 * sits on an ember wash with an ember day letter, and the week still to come
 * is drawn dashed because it is a plan, not a record. The focused week keeps
 * full strength; the other two go quiet. The ruler above names the weeks and
 * the numbers live under the chart: an inspector headline always names one
 * day (today unless another is hovered or pinned) with the focused week's
 * totals beneath it. Bars share one baseline per week group. Plain HTML,
 * like the strip. */

import { useState } from "react";
import { dayTime, weekSummary } from "../../logic/weekRibbon.ts";
import type { WeekLoad } from "../../store/types.ts";
import { ChartShell } from "./ChartShell.tsx";
import {
  dayLabel,
  describe,
  Glyph,
  n,
  type DayView,
} from "./WeeklyLoad.tsx";

interface Pick {
  week: number;
  day: number;
}

/** Inspector figure: the day's load, or done-of-planned while in progress. */
function dayFigure(v: DayView) {
  if (v.state === "rest") return "Rest";
  if (v.done === 0) return n(v.planned);
  if (v.done >= v.planned) return n(v.done);
  return (
    <>
      {n(v.done)} <small>of {n(v.planned)}</small>
    </>
  );
}

/** "Today", the day name in the focus week, else "Week 2 · Monday". */
function dayContext(
  week: WeekLoad,
  v: DayView,
  weekIndex: number,
  focusIndex: number,
) {
  if (v.today) return "Today";
  return weekIndex === focusIndex ? v.name : `${week.name} · ${v.name}`;
}

export function WeekRibbon(
  { weeks, focusId, onFocus, title = "Weekly load", flat }: {
    weeks: WeekLoad[];
    focusId: string;
    onFocus: (id: string) => void;
    title?: string;
    flat?: boolean;
  },
) {
  const views = weeks.map((week) => ({ week, days: describe(week.days) }));
  const max = Math.max(1, ...views.flatMap((v) => v.days.map((d) => d.size)));
  const [pinned, setPinned] = useState<Pick | null>(null);
  const [hover, setHover] = useState<Pick | null>(null);

  const focusIndex = Math.max(0, weeks.findIndex((w) => w.id === focusId));
  const focusWeek = views[focusIndex];
  const focusDays = focusWeek?.days ?? [];
  const todayInFocus = focusDays.findIndex((d) => d.today);
  // A week without today still inspects a real day: the most recent day of a
  // past week, the first day of a week still to come.
  const defaultDay = todayInFocus >= 0
    ? todayInFocus
    : focusWeek?.week.relation === "past"
    ? focusDays.length - 1
    : 0;
  const shown: Pick | null = hover ?? pinned ??
    (focusWeek && defaultDay >= 0 && defaultDay < focusDays.length
      ? { week: focusIndex, day: defaultDay }
      : null);
  const shownDay = shown ? views[shown.week].days[shown.day] : null;
  const shownWeek = shown ? views[shown.week].week : null;

  const rows = views.flatMap(({ week, days }) =>
    days.map((v) => [
      `${week.name}${v.today ? " (today)" : ""}`,
      v.name,
      v.session,
      n(v.done),
      n(v.planned),
    ])
  );
  const label = `Weekly load across ${weeks.length} weeks, ${
    focusWeek?.week.name ?? ""
  } in focus. ${weeks.map((w) => `${w.name}: ${weekSummary(w)}`).join(". ")}.`;

  return (
    <ChartShell
      title={title}
      head={["Week", "Day", "Session", "Done", "Planned"]}
      rows={rows}
      label={label}
      flat={flat}
    >
      <div className="ribbon" onMouseLeave={() => setHover(null)}>
        <div className="ribbon-ruler">
          {views.map(({ week }, wi) => (
            <button
              key={week.id}
              type="button"
              className={`ribbon-label ${week.relation}${
                wi === focusIndex ? " focus" : ""
              }`}
              aria-pressed={wi === focusIndex}
              onClick={() => onFocus(week.id)}
            >
              <span className="ribbon-name">
                {week.name}
                <span className="ribbon-range">{week.range}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="ribbon-strip">
          {views.map(({ week, days }, wi) => (
            <div
              key={week.id}
              className={`ribbon-week${wi === focusIndex ? " focus" : ""}`}
              data-relation={week.relation}
            >
              {days.map((v, di) => {
                const barH = v.size > 0 ? Math.max(8, (v.size / max) * 100) : 0;
                const fillH = v.size > 0 ? (v.done / v.size) * 100 : 0;
                const here = { week: wi, day: di };
                const pinnedHere = pinned?.week === wi && pinned.day === di;
                return (
                  <button
                    key={di}
                    type="button"
                    className={`week-day ${v.state} t-${dayTime(week, di)}`}
                    aria-label={`${week.name}, ${dayLabel(v)}`}
                    aria-pressed={pinnedHere}
                    onClick={() => setPinned(pinnedHere ? null : here)}
                    onMouseEnter={() => setHover(here)}
                    onFocus={() => setHover(here)}
                    onBlur={() => setHover(null)}
                  >
                    <span className="week-track" aria-hidden="true">
                      {v.state === "rest"
                        ? <span className="week-rest" />
                        : (
                          <span
                            className="week-bar"
                            style={{ height: `${barH}%` }}
                          >
                            <span
                              className="week-fill"
                              style={{ height: `${fillH}%` }}
                            />
                          </span>
                        )}
                    </span>
                    <span className="week-glyph" aria-hidden="true">
                      <Glyph kind={v.kind} />
                    </span>
                    <span className="week-letter" aria-hidden="true">
                      {v.letter}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="day-focus" aria-live="polite">
        {shownDay && shownWeek && shown
          ? (
            <>
              <span className="figure">{dayFigure(shownDay)}</span>
              <span className="day-focus-label">
                {shownDay.state === "rest"
                  ? dayContext(shownWeek, shownDay, shown.week, focusIndex)
                  : (
                    <>
                      <strong
                        className={shownDay.today
                          ? "day-focus-today"
                          : undefined}
                      >
                        {dayContext(
                          shownWeek,
                          shownDay,
                          shown.week,
                          focusIndex,
                        )}
                      </strong>
                      {" · "}
                      {shownDay.session}
                      {shownDay.done === 0
                        ? " · planned"
                        : shownDay.done >= shownDay.planned
                        ? " · done"
                        : null}
                    </>
                  )}
              </span>
            </>
          )
          : (
            <span className="day-focus-label">
              {focusWeek?.week.name} · {focusWeek?.week.range}
            </span>
          )}
      </div>
      <p className="week-total kbd-hint">
        {focusWeek?.week.name}: {focusWeek ? weekSummary(focusWeek.week) : ""}
      </p>
    </ChartShell>
  );
}
