/* This week: a seven-day strip (DESIGN 6.3, DECISIONS U13). One bar per
 * day, its height the day's load and its fill how much of that load is done,
 * in the timeline rail's own vocabulary: done days teal and filled, today
 * ember (outlined, filling as the day goes), later days outlined, rest days a
 * dash. A glyph under each bar says lift, run, both or rest. Tap, hover or
 * focus a day and the caption names it with its numbers; the caption shows
 * today otherwise. Plain HTML so the seven columns wrap to any card width.
 *
 * It replaces the stacked columns that put planned load on top of done load
 * (a finished 420 day drew as 840, half filled) and split lift/run inside
 * every column, which the owner found impossible to follow. */

import { useState } from "react";
import { weekTotals } from "../../logic/weeklyLoad.ts";
import type { WeekLoadDay } from "../../store/types.ts";
import { Bed, Dumbbell, SportShoe } from "../icons.ts";
import { ChartShell } from "./ChartShell.tsx";
import { ChartLegend } from "./Plot.tsx";

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

type DayKind = "lift" | "run" | "both" | "rest";
type DayState = "done" | "today" | "later" | "rest";

interface DayView {
  index: number;
  name: string;
  letter: string;
  kind: DayKind;
  state: DayState;
  done: number;
  planned: number;
  size: number;
  session: string;
  today: boolean;
  liftDone: number;
  runDone: number;
  liftPlanned: number;
  runPlanned: number;
}

function n(v: number) {
  return v.toLocaleString("en-US");
}

function describe(days: WeekLoadDay[]): DayView[] {
  return days.map((d, i) => {
    const done = d.liftDone + d.runDone;
    const planned = d.liftPlanned + d.runPlanned;
    const lifts = d.liftPlanned + d.liftDone > 0;
    const runs = d.runPlanned + d.runDone > 0;
    const kind: DayKind = lifts && runs
      ? "both"
      : lifts
      ? "lift"
      : runs
      ? "run"
      : "rest";
    const size = Math.max(done, planned);
    const state: DayState = kind === "rest"
      ? "rest"
      : d.today
      ? "today"
      : done > 0 && done >= planned
      ? "done"
      : "later";
    const session = d.label ??
      (kind === "both"
        ? "Lift + run"
        : kind === "lift"
        ? "Lift"
        : kind === "run"
        ? "Run"
        : "Rest");
    return {
      index: i,
      name: days.length === 7 ? DAY_NAMES[i] : d.day,
      letter: d.day,
      kind,
      state,
      done,
      planned,
      size,
      session,
      today: d.today === true,
      liftDone: d.liftDone,
      runDone: d.runDone,
      liftPlanned: d.liftPlanned,
      runPlanned: d.runPlanned,
    };
  });
}

function Glyph({ kind }: { kind: DayKind }) {
  if (kind === "both") {
    return (
      <>
        <Dumbbell size={13} />
        <SportShoe size={13} />
      </>
    );
  }
  if (kind === "lift") return <Dumbbell size={14} />;
  if (kind === "run") return <SportShoe size={14} />;
  return <Bed size={14} />;
}

/** "420 done", "750 planned (lift 510, run 240)" or "300 of 750 done". */
function captionNums(v: DayView) {
  if (v.done === 0) {
    const split = v.kind === "both"
      ? ` (lift ${n(v.liftPlanned)}, run ${n(v.runPlanned)})`
      : "";
    return `${n(v.planned)} planned${split}`;
  }
  if (v.done >= v.planned) {
    const split = v.kind === "both"
      ? ` (lift ${n(v.liftDone)}, run ${n(v.runDone)})`
      : "";
    return `${n(v.done)} done${split}`;
  }
  return `${n(v.done)} of ${n(v.planned)} done`;
}

function dayLabel(v: DayView) {
  const when = v.today ? ", today" : "";
  if (v.state === "rest") return `${v.name}${when}: rest`;
  return `${v.name}${when}, ${v.session}: ${n(v.done)} done of ${
    n(v.planned)
  } planned`;
}

export function WeeklyLoad(
  { days, flat }: { days: WeekLoadDay[]; flat?: boolean },
) {
  const views = describe(days);
  const todayIndex = views.findIndex((v) => v.today);
  const [pinned, setPinned] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const shownIndex = hover ?? pinned ?? (todayIndex >= 0 ? todayIndex : 0);
  const shown = views[shownIndex];
  const max = Math.max(1, ...views.map((v) => v.size));
  const totals = weekTotals(days);

  const rows = views.map((v) => [
    v.today ? `${v.name} (today)` : v.name,
    v.session,
    n(v.done),
    n(v.planned),
    v.kind === "both"
      ? `lift ${n(v.liftDone)} · run ${n(v.runDone)}`
      : v.kind === "rest"
      ? "—"
      : v.kind,
  ]);
  const label = `This week's load by day. ${
    todayIndex >= 0 ? `Today is ${views[todayIndex].name}. ` : ""
  }${n(totals.done)} done of ${n(totals.planned)} planned.`;

  return (
    <ChartShell
      title="This week"
      head={["Day", "Session", "Done", "Planned", "Split"]}
      rows={rows}
      label={label}
      flat={flat}
    >
      <div
        className="week-strip"
        onMouseLeave={() => setHover(null)}
      >
        {views.map((v) => {
          const barH = v.size > 0 ? Math.max(8, (v.size / max) * 100) : 0;
          const fillH = v.size > 0 ? (v.done / v.size) * 100 : 0;
          return (
            <button
              key={v.index}
              type="button"
              className={`week-day ${v.state}`}
              aria-label={dayLabel(v)}
              aria-pressed={pinned === v.index}
              onClick={() => setPinned((p) => (p === v.index ? null : v.index))}
              onMouseEnter={() => setHover(v.index)}
              onFocus={() => setHover(v.index)}
              onBlur={() => setHover(null)}
            >
              <span className="week-track" aria-hidden="true">
                {v.state === "rest"
                  ? <span className="week-rest" />
                  : (
                    <span className="week-bar" style={{ height: `${barH}%` }}>
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
      <p className="week-caption" aria-live="polite">
        <strong className={shown.today ? "week-caption-today" : undefined}>
          {shown.today ? "Today" : shown.name}
          {" · "}
          {shown.session}
        </strong>
        {shown.state === "rest" ? null : (
          <span className="week-caption-nums">
            {" · "}
            {captionNums(shown)}
          </span>
        )}
      </p>
      <p className="week-total kbd-hint">
        Week: {n(totals.done)} done of {n(totals.planned)} planned
      </p>
      <ChartLegend
        items={[
          { label: "Done", color: "var(--progress-fill)" },
          { label: "Today", color: "var(--accent)", outline: true },
          { label: "Later", color: "var(--fg-faint)", outline: true },
        ]}
      />
    </ChartShell>
  );
}
