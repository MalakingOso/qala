/* Week ribbon (DESIGN 6.3, DECISIONS U20, U25): three weeks side by side with
 * one in focus, flat on the lede card, so a week reads against the one
 * before it and the one coming. Each bar stacks the day's lift load under
 * its run load (teal lift, the --run token — the same colors as every other
 * lift/run chart); fill is the part done,
 * the week still to come is hatched because it is a plan, not a record, and
 * rest days are a dash. No glyphs, no wash columns, no inspector: today
 * reads through a frosted chip above its bar and its letter reversed out of
 * an ember square, and hovering a day lifts its bar and shows a frosted
 * tooltip naming the type with labeled numbers; clicking a day does nothing. The
 * focused week keeps full strength; the other two go quiet. Plain HTML,
 * like the strip. */

import { weekSummary } from "../../logic/weekRibbon.ts";
import type { WeekLoad } from "../../store/types.ts";
import { ChartShell } from "./ChartShell.tsx";
import { dayLabel, type DayView, describe, n } from "./WeeklyLoad.tsx";

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

/** The tooltip is the only place type is named; there is no legend. */
function tipNumbers(v: DayView): string {
  if (v.kind === "rest") return "no session";
  const type = v.kind === "both" ? "lift + run" : v.kind;
  if (v.done === 0) return `${type} · ${n(v.planned)} planned load`;
  if (v.done >= v.planned) return `${type} · ${n(v.done)} load`;
  return `${type} · ${n(v.done)} of ${n(v.planned)} load`;
}

/** One stacked bar: run above lift, each segment filled to its own share
 * done. Segments always sum to the bar's full height; the bar's height is
 * the day's size against the ribbon max, as before. */
function StackedBar({ v, future }: { v: DayView; future: boolean }) {
  const planned = v.liftPlanned + v.runPlanned;
  const liftShare = planned > 0 ? v.liftPlanned : v.liftDone;
  const runShare = planned > 0 ? v.runPlanned : v.runDone;
  const total = liftShare + runShare;
  const seg = (
    share: number,
    done: number,
    cls: string,
    key: string,
  ) =>
    share > 0 && total > 0
      ? (
        <span
          key={key}
          className={`ribbon-seg ${cls}${future ? " future" : ""}`}
          style={{ height: `${(share / total) * 100}%` }}
        >
          <span
            className="week-fill"
            style={{
              height: `${Math.min(100, (done / share) * 100)}%`,
            }}
          />
        </span>
      )
      : null;
  return (
    <>
      {seg(runShare, v.runDone, "run", "run")}
      {seg(liftShare, v.liftDone, "lift", "lift")}
    </>
  );
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
  const focusIndex = Math.max(0, weeks.findIndex((w) => w.id === focusId));

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
    views[focusIndex]?.week.name ?? ""
  } in focus. ${weeks.map((w) => `${w.name}: ${weekSummary(w)}`).join(". ")}.`;

  return (
    <ChartShell
      title={title}
      head={["Week", "Day", "Session", "Done", "Planned"]}
      rows={rows}
      label={label}
      flat={flat}
    >
      <div className="ribbon">
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
                const barH = v.size > 0 ? Math.max(6, (v.size / max) * 100) : 0;
                const tipTitle = v.kind === "rest"
                  ? `${dayContext(week, v, wi, focusIndex)} · Rest`
                  : `${dayContext(week, v, wi, focusIndex)} · ${v.session}`;
                return (
                  <span
                    key={di}
                    className={`week-day ${v.state}`}
                    role="img"
                    tabIndex={0}
                    aria-label={dayLabel(v)}
                  >
                    {v.today && (
                      <span
                        className="today-chip"
                        data-chip
                        aria-hidden="true"
                      >
                        <i aria-hidden="true" />
                        Today <small>· {v.session}</small>
                      </span>
                    )}
                    <span className="tip" aria-hidden="true">
                      <b>{tipTitle}</b>
                      <span>{tipNumbers(v)}</span>
                    </span>
                    <span className="week-track" aria-hidden="true">
                      {v.size === 0 ? <span className="week-rest" /> : (
                        <span
                          className="week-bar stack"
                          style={{ height: `${barH}%` }}
                        >
                          <StackedBar
                            v={v}
                            future={week.relation === "future"}
                          />
                        </span>
                      )}
                    </span>
                    <span className="week-letter" aria-hidden="true">
                      {v.letter}
                    </span>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </ChartShell>
  );
}
