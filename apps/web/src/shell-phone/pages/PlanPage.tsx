/* Plan (DESIGN 7.2, Volt structure): week arrows over the block's weeks,
 * day tabs with date and glyph, then the selected day: Start (today) or
 * "do this today instead", and Overview (exercise grid) / Details (every
 * set, warm-up and run). The sample week's days and statuses match the
 * Today week strip (`sampleWeekLoad`): lifts Mon/Wed/Fri/Sun, runs
 * Tue/Thu/Sat/Sun. Other weeks of the block reuse the same days, all done
 * before week 3 and all ahead after it. */

import { useState } from "react";
import {
  Card,
  Group,
  GroupRow,
  PrimaryButton,
  SecondaryButton,
  SegmentedControl,
} from "../../shared/ui.tsx";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  SportShoe,
  StickyNote,
} from "../../shared/icons.ts";

type Status = "done" | "missed" | "today" | "later";

interface PlanExercise {
  name: string;
  scheme: string;
  load?: string;
  note?: boolean;
  chip?: string;
}

interface PlanDay {
  d: string;
  date: number;
  status: Status;
  title: string;
  minutes: number;
  lift?: PlanExercise[];
  run?: { title: string; steps: string[] };
}

const DAYS: PlanDay[] = [
  {
    d: "Mon",
    date: 7,
    status: "done",
    title: "Upper A · Bench day",
    minutes: 70,
    lift: [
      { name: "Bench Press", scheme: "4 × 5", load: "185" },
      { name: "Barbell Row", scheme: "4 × 8", load: "135" },
      { name: "Overhead Press", scheme: "3 × 8", load: "95" },
      { name: "Curl", scheme: "3 × 12", load: "30s" },
    ],
  },
  {
    d: "Tue",
    date: 8,
    status: "done",
    title: "Easy run · 4 mi",
    minutes: 37,
    run: { title: "Easy", steps: ["4 mi conversational"] },
  },
  {
    d: "Wed",
    date: 9,
    status: "done",
    title: "Lower B · Deadlift day",
    minutes: 75,
    lift: [
      { name: "Deadlift", scheme: "3 × 3", load: "335" },
      { name: "Front Squat", scheme: "3 × 5", load: "165" },
      { name: "Hip Thrust", scheme: "3 × 10", load: "225" },
      { name: "Hanging Leg Raise", scheme: "3 × 10" },
    ],
  },
  {
    d: "Thu",
    date: 10,
    status: "missed",
    title: "Easy run · 2 mi",
    minutes: 20,
    run: { title: "Easy", steps: ["2 mi conversational"] },
  },
  {
    d: "Fri",
    date: 11,
    status: "done",
    title: "Upper B · Press day",
    minutes: 65,
    lift: [
      { name: "Overhead Press", scheme: "3 × 5", load: "135" },
      { name: "Close-grip Bench", scheme: "3 × 6", load: "205" },
      { name: "Pull-up", scheme: "4 × 6" },
      { name: "Face Pull", scheme: "3 × 15", load: "40" },
    ],
  },
  {
    d: "Sat",
    date: 12,
    status: "done",
    title: "Long run · 7 mi",
    minutes: 64,
    run: { title: "Long", steps: ["6 mi easy", "last mile steady"] },
  },
  {
    d: "Sun",
    date: 13,
    status: "today",
    title: "Lower A · Squat day",
    minutes: 75,
    lift: [
      { name: "Back Squat", scheme: "3 × 4", load: "245", note: true },
      { name: "Romanian Deadlift", scheme: "2 × 8", load: "205" },
      { name: "Walking Lunge", scheme: "1 × 10", load: "40" },
      {
        name: "Standing Calf Raise",
        scheme: "2 × 12",
        load: "180",
        chip: "+1 set",
      },
    ],
    run: { title: "Easy run · 3.0 mi, 6 pm", steps: ["3 mi conversational"] },
  },
];

const WEEKS = 6;
const DELOAD = 6;
const THIS_WEEK = 3;

/** Dates of the block's weeks: week 3 is Sep 7-13. */
function dateIn(week: number, date: number): string {
  const d = new Date(2026, 8, date + (week - THIS_WEEK) * 7);
  return String(d.getDate());
}

function weekDays(week: number): PlanDay[] {
  if (week === THIS_WEEK) return DAYS;
  return DAYS.map((d) => ({
    ...d,
    status: week < THIS_WEEK ? "done" : "later",
  }));
}

export function PlanPage() {
  const [day, setDay] = useState(6);
  const [view, setView] = useState<"overview" | "details">("overview");
  const [week, setWeek] = useState(THIS_WEEK);
  const days = weekDays(week);
  const sel = days[day];
  const Glyph = sel.lift ? Dumbbell : SportShoe;
  return (
    <div>
      <div className="page-head">
        <div>
          <p className="group-label page-eyebrow">Linear · 6 weeks</p>
          <h1 className="page-title title">Strength block 2</h1>
        </div>
      </div>
      <Card>
        <div className="plan-week-nav">
          <button
            type="button"
            className="icon-btn bordered"
            onClick={() => setWeek((w) => Math.max(1, w - 1))}
            disabled={week === 1}
            aria-label="Previous week"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="plan-week-label">
            <span className="title">Week {week}</span>
            <span className="kbd-hint">
              of {WEEKS}
              {week === THIS_WEEK
                ? " · this week"
                : week === DELOAD
                ? " · deload"
                : ""}
            </span>
          </div>
          <button
            type="button"
            className="icon-btn bordered"
            onClick={() => setWeek((w) => Math.min(WEEKS, w + 1))}
            disabled={week === WEEKS}
            aria-label="Next week"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="block-weeks" role="group" aria-label="Block weeks">
          {Array.from({ length: WEEKS }, (_, i) => i + 1).map((w) => (
            <button
              key={w}
              type="button"
              className={`block-week ${
                w < 3 ? "done" : w === 3 ? "now" : w === DELOAD ? "deload" : ""
              }`}
              aria-pressed={w === week}
              aria-label={`Week ${w}${w === DELOAD ? ", deload" : ""}`}
              onClick={() => setWeek(w)}
            >
              <span className="block-week-bar" />
              <span>{w === DELOAD ? "D" : w}</span>
            </button>
          ))}
        </div>
      </Card>
      <div className="day-tabs" role="tablist" aria-label="Days">
        {days.map((d, i) => {
          const G = d.lift ? Dumbbell : SportShoe;
          return (
            <button
              key={d.d}
              type="button"
              role="tab"
              className={d.status}
              aria-selected={i === day}
              aria-label={`${d.d} ${
                dateIn(week, d.date)
              }, ${d.title}, ${d.status}`}
              onClick={() => setDay(i)}
            >
              <span className="day-name">{d.d}</span>
              <span className="day-date">{dateIn(week, d.date)}</span>
              <span className="day-glyph">
                {d.status === "done" ? <Check size={15} /> : <G size={15} />}
              </span>
            </button>
          );
        })}
      </div>
      <Card hero={sel.status === "today"}>
        <p className="group-label page-eyebrow plan-day-status">
          {sel.status === "today"
            ? "Today"
            : sel.status === "done"
            ? `${sel.d} · done`
            : sel.status === "missed"
            ? `${sel.d} · skipped`
            : sel.d}
        </p>
        <h2 className="title plan-day-title">
          <Glyph size={20} aria-hidden="true" /> {sel.title}
        </h2>
        <p className="kbd-hint">
          about {sel.minutes} min{sel.lift ? " with warm-up" : ""}
          {sel.lift && sel.run ? " · then a run" : ""}
        </p>
        <div className="plan-day-cta">
          {sel.status === "today"
            ? (
              <PrimaryButton
                large
                href={sel.lift ? "#/phone/checkin" : "#/phone/run/start"}
              >
                Start workout
              </PrimaryButton>
            )
            : sel.status === "done"
            ? (
              <SecondaryButton href="#/phone/history">
                See what you did
              </SecondaryButton>
            )
            : (
              <SecondaryButton
                href={sel.lift ? "#/phone/checkin" : "#/phone/run/start"}
              >
                Do this today instead
              </SecondaryButton>
            )}
        </div>
        <SegmentedControl
          label="Plan view"
          value={view}
          onPick={setView}
          options={[
            { value: "overview", label: "Overview" },
            { value: "details", label: "Details" },
          ]}
        />
        {view === "overview"
          ? (
            <div className="exercise-grid">
              {sel.lift?.map((e) => (
                <div key={e.name} className="exercise-tile">
                  <strong>{e.name}</strong>
                  <span className="exercise-scheme">
                    {e.scheme}
                    {e.load ? ` · ${e.load}` : ""}
                  </span>
                  {e.note || e.chip
                    ? (
                      <span className="exercise-flags">
                        {e.note
                          ? (
                            <span className="flag note">
                              <StickyNote size={12} /> note
                            </span>
                          )
                          : null}
                        {e.chip ? <span className="flag">{e.chip}</span> : null}
                      </span>
                    )
                    : null}
                </div>
              ))}
              {sel.run
                ? (
                  <div className="exercise-tile run">
                    <strong>
                      <SportShoe size={14} aria-hidden="true" /> {sel.run.title}
                    </strong>
                    <span className="exercise-scheme">
                      {sel.run.steps.join(", ")}
                    </span>
                  </div>
                )
                : null}
            </div>
          )
          : (
            <ol className="plan-details">
              {sel.lift
                ? (
                  <li>
                    <span>Warm-up</span>
                    <span className="kbd-hint">
                      bike, soft tissue, ramp sets · 15 min
                    </span>
                  </li>
                )
                : null}
              {sel.lift?.map((e) => (
                <li key={e.name}>
                  <span>{e.name}</span>
                  <span className="kbd-hint">
                    {e.scheme}
                    {e.load ? ` @ ${e.load}` : ""}
                    {e.chip ? ` · ${e.chip}` : ""}
                  </span>
                </li>
              ))}
              {sel.run?.steps.map((s) => (
                <li key={s}>
                  <span>Run</span>
                  <span className="kbd-hint">{s}</span>
                </li>
              ))}
            </ol>
          )}
      </Card>
      <Group label="This week">
        <GroupRow>
          <span>4 lifts · 4 runs</span>
          <span className="kbd-hint">5 done · 1 skipped · today</span>
        </GroupRow>
      </Group>
    </div>
  );
}
