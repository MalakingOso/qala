/* Today (DESIGN 7.1): timeline rail on the left edge, one hero card per
 * stage. The rail flicks between stages to preview or look back, snaps back
 * to "now" after 10 s idle (DECISIONS U9), and advances when a stage
 * completes. Rest days show check-in / recover / wind down (U10). */

import { useEffect, useRef, useState } from "react";
import {
  reasonOn,
  shiftsPlan,
} from "../../../../../packages/engine/availability.ts";
import { useQala } from "../../store/qalaStore.tsx";
import { sampleWeekLoad } from "../../store/sample.ts";
import { isRestDay } from "../../store/types.ts";
import type { DayStageId } from "../../store/types.ts";
import { Card, PrimaryButton, SecondaryButton } from "../../shared/ui.tsx";
import {
  reasonWord,
  StatusIcon,
  statusLine,
} from "../../shared/skipStatus.tsx";
import { ReadinessRing, WeeklyLoad } from "../../shared/charts/index.ts";
import {
  ChevronDown,
  CircleCheck,
  Clock,
  Dumbbell,
  Flame,
  Hourglass,
  Moon,
  SportShoe,
  Undo2,
} from "../../shared/icons.ts";

const STAGE_ICON: Record<DayStageId, typeof Dumbbell> = {
  checkin: CircleCheck,
  warmup: Flame,
  lift: Dumbbell,
  recover: Hourglass,
  run: SportShoe,
  winddown: Moon,
};

const SNAP_BACK_MS = 10_000;

export function TodayPage() {
  const {
    stages,
    setStageStatus,
    todayKey,
    skips,
    availability,
    clearSkip,
    clearAvailability,
  } = useQala();
  const todayReason = reasonOn(todayKey, availability, skips);
  const status = statusLine(availability, skips, todayKey);
  const undoToday = () => {
    if (skips.some((s) => s.date === todayKey)) clearSkip(todayKey);
    else clearAvailability();
  };
  const now = stages.find((s) => s.status === "now") ?? stages[0];
  const [viewing, setViewing] = useState<DayStageId>(now.id);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Snap back to "now" after 10 s idle.
  useEffect(() => {
    if (viewing === now.id) return;
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => setViewing(now.id), SNAP_BACK_MS);
    return () => {
      if (idle.current) clearTimeout(idle.current);
    };
  }, [viewing, now.id]);

  const restDay = isRestDay(stages);
  const viewed = stages.find((s) => s.id === viewing) ?? now;
  const ViewIcon = STAGE_ICON[viewed.id];

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="group-label page-eyebrow">
            Sunday · Strength block 2 / week 3
          </p>
          <h1 className="page-title title">Today</h1>
        </div>
      </div>
      {status
        ? (
          <div className="status-banner" role="status">
            <StatusIcon reason={status.reason} />
            <p>
              {status.text} {status.reason === "injured"
                ? "Direct work for it is off."
                : shiftsPlan(status.reason)
                ? "The plan shifts out."
                : status.reason === "scheduling"
                ? "It did not fit today. The plan holds."
                : "Rest up, the plan holds."}
            </p>
            <button
              type="button"
              className="link-btn"
              onClick={undoToday}
            >
              <Undo2 size={16} aria-hidden="true" /> Undo
            </button>
          </div>
        )
        : null}
      <div className="rail">
        <div className="rail-nodes" role="tablist" aria-label="Day stages">
          {stages.map((s, i) => {
            const Icon = STAGE_ICON[s.id];
            return (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={s.id === viewing}
                  aria-label={`${s.label}, ${s.status}`}
                  className={`rail-node ${
                    s.status === "done"
                      ? "done"
                      : s.status === "now"
                      ? "now"
                      : ""
                  }`}
                  onClick={() => setViewing(s.id)}
                >
                  <Icon size={20} />
                </button>
                <span className="rail-time">
                  {s.label}
                  <br />
                  {s.time}
                </span>
                {i < stages.length - 1
                  ? <span className="rail-link" aria-hidden="true" />
                  : null}
              </div>
            );
          })}
        </div>
        <div className="rail-body">
          <Card hero>
            <div className="today-stage">
              <span className="group-label">
                {viewed.id === now.id ? "Now" : "Preview"} · {viewed.label}
              </span>
              {viewed.id !== now.id
                ? (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setViewing(now.id)}
                  >
                    Back to now
                  </button>
                )
                : null}
            </div>
            {viewed.id === "lift" || viewed.id === "warmup"
              ? (
                <>
                  <h2 className="title today-title">
                    Lower A
                  </h2>
                  <p className="today-exercise">Squat day</p>
                  <div className="today-topset">
                    <span className="group-label">Your top set</span>
                    <p className="figure">
                      245 <span className="figure-unit">lb</span> × 4
                    </p>
                    <p className="kbd-hint">
                      Readiness 72 / 100. A little under your average, so squat
                      holds.
                    </p>
                  </div>
                  <div className="today-timing">
                    <Clock size={16} />
                    <span>10 min warm-up · 15 min lift</span>
                  </div>
                  {todayReason
                    ? (
                      <>
                        <p className="today-line">
                          Lower A is skipped ({reasonWord(todayReason)}).
                        </p>
                        <PrimaryButton large href="#/phone/plan">
                          See plan
                        </PrimaryButton>
                        <div className="today-actions">
                          <SecondaryButton onClick={undoToday}>
                            <Undo2 size={18} /> Undo skip
                          </SecondaryButton>
                        </div>
                      </>
                    )
                    : (
                      <>
                        <PrimaryButton
                          large
                          href={viewed.id === "warmup"
                            ? "#/phone/checkin"
                            : "#/phone/warmup"}
                        >
                          <Flame size={22} /> Start warm-up
                        </PrimaryButton>
                        <div className="today-actions">
                          <SecondaryButton href="#/phone/skip?day=today&ret=today">
                            Skip today
                          </SecondaryButton>
                        </div>
                      </>
                    )}
                  <div className="today-next">
                    <SportShoe size={18} />
                    <p>
                      <span className="group-label">Then · 6 pm</span>
                      <br />Easy run · 3.0 mi
                    </p>
                  </div>
                  <details className="today-context">
                    <summary>
                      <span>Readiness and this week</span>
                      <ChevronDown size={18} aria-hidden="true" />
                    </summary>
                    <ReadinessRing
                      readiness={0.72}
                      avg={76}
                      lowLine={64}
                      checkins={20}
                      prs={7}
                      flat
                    />
                    <WeeklyLoad days={sampleWeekLoad} flat />
                  </details>
                </>
              )
              : viewed.id === "recover"
              ? (
                <>
                  <h2 className="title today-title">Lift done</h2>
                  <dl className="today-figures">
                    {[
                      { v: "58", l: "min" },
                      { v: "20.4k", l: "lb, +6%" },
                      { v: "1", l: "PR" },
                    ].map((s) => (
                      <div key={s.l}>
                        <dt>{s.l}</dt>
                        <dd className="figure">{s.v}</dd>
                      </div>
                    ))}
                  </dl>
                  <WeeklyLoad days={sampleWeekLoad} flat />
                  <p className="today-line">
                    Quads will be ready Wednesday. The easy run stays easy.
                  </p>
                  <div className="today-actions">
                    <PrimaryButton large href="#/phone/complete">
                      See session
                    </PrimaryButton>
                    <SecondaryButton href="#/phone/run/start">
                      Run earlier instead
                    </SecondaryButton>
                  </div>
                  <div className="today-next">
                    <SportShoe size={18} />
                    <p>
                      <span className="group-label">Next · in 9 h 40 m</span>
                      <br />Easy run · 3.0 mi
                    </p>
                  </div>
                </>
              )
              : viewed.id === "run"
              ? (
                <>
                  <h2 className="title today-title">Easy run</h2>
                  <p className="today-exercise">3.0 mi · 6 pm</p>
                  {todayReason
                    ? (
                      <>
                        <p className="today-line">
                          This run is skipped ({reasonWord(todayReason)}).
                        </p>
                        <PrimaryButton large href="#/phone/plan">
                          See plan
                        </PrimaryButton>
                        <div className="today-actions">
                          <SecondaryButton onClick={undoToday}>
                            <Undo2 size={18} /> Undo skip
                          </SecondaryButton>
                        </div>
                      </>
                    )
                    : (
                      <>
                        <p className="today-line">
                          Conversational pace. Audio cue every half mile.
                        </p>
                        <PrimaryButton large href="#/phone/run/start">
                          <SportShoe size={22} /> Start run
                        </PrimaryButton>
                        <div className="today-actions">
                          <SecondaryButton href="#/phone/skip?day=today&ret=today">
                            Skip today
                          </SecondaryButton>
                        </div>
                      </>
                    )}
                </>
              )
              : viewed.id === "winddown"
              ? (
                <>
                  <h2 className="title today-title">Day complete</h2>
                  <dl className="today-figures">
                    {[
                      { v: "58", l: "min lifting" },
                      { v: "3.0", l: "mi run" },
                      { v: "11:00", l: "pm, sleep" },
                    ].map((s) => (
                      <div key={s.l}>
                        <dt>{s.l}</dt>
                        <dd className="figure">{s.v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="today-line">
                    Tomorrow is Upper A, bench day. Load this week 2,600.
                  </p>
                  <PrimaryButton large href="#/phone/complete">
                    See day summary
                  </PrimaryButton>
                </>
              )
              : (
                <>
                  <h2 className="title today-title">How are you walking in?</h2>
                  <p className="today-line">
                    {restDay
                      ? "Rest day. Check in, then recover."
                      : "Check in to set today's loads."}
                  </p>
                  <PrimaryButton large href="#/phone/checkin">
                    <ViewIcon size={22} /> Check in
                  </PrimaryButton>
                </>
              )}
          </Card>
          {now.id === "lift" && viewed.id === "lift"
            ? (
              <SecondaryButton href="#/phone/run/start">
                <SportShoe size={18} /> Run first instead
              </SecondaryButton>
            )
            : null}
          <p className="today-demo">
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                const idx = stages.findIndex((s) => s.id === now.id);
                const next = stages[idx + 1];
                setStageStatus(now.id, "done");
                if (next) {
                  setStageStatus(next.id, "now");
                  setViewing(next.id);
                }
              }}
            >
              Mark {now.label} done (demo)
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
