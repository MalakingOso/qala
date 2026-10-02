/* Desktop home: the week in review (DESIGN 7.15, DECISIONS U20, U21). A lede
 * card says where the block stands and shows three weeks of load with one in
 * focus; below it the sessions and the estimated 1RMs. Replaces the stat-tile
 * dashboard. */

import { useState } from "react";
import { useQala } from "../store/qalaStore.tsx";
import { WeekRibbon } from "../shared/charts/index.ts";
import {
  sampleBlock,
  sampleLifts,
  sampleReadiness,
  sampleVdot,
} from "../store/sample.ts";
import { SessionsTable } from "./SessionsTable.tsx";
import {
  BlockBar,
  Bunch,
  FilterChips,
  PageHeader,
  Panel,
  Pill,
} from "./parts.tsx";
import {
  filterSessions,
  SESSION_FILTERS,
  type SessionFilter,
} from "./sessions.ts";
import { useWeekFocus } from "./weekFocus.tsx";

export function OverviewPage() {
  const { sessions } = useQala();
  const { weeks, focusId, setFocusId } = useWeekFocus();
  const [filter, setFilter] = useState<SessionFilter>("all");

  const lifts = sessions.filter((s) => s.type === "lift").length;
  const runs = sessions.filter((s) => s.type === "run").length;
  const miles = sessions.reduce((n, s) => n + (s.run?.distanceMi ?? 0), 0);
  const readiness = sampleReadiness.values[sampleReadiness.values.length - 1];
  const vdot = sampleVdot[sampleVdot.length - 1];
  const vdotDelta = vdot - sampleVdot[0];
  const latest = sessions[0];
  const doneToday = latest && latest.date === sampleBlock.todayDate;
  const shown = filterSessions(sessions, filter).slice(0, 5);

  return (
    <div>
      <PageHeader
        kicker={`${sampleBlock.today}${
          doneToday ? ` · ${latest.label} complete` : ""
        }`}
        title="Week in review"
      >
        <div className="lede-grid">
          <div className="lede-left">
            <div className="bigweek figure">
              Week {sampleBlock.week} <small>of {sampleBlock.of}</small>
            </div>
            <div className="block-line">
              {sampleBlock.name}
              <span>
                {` · ${sampleBlock.focus} · deload in week ${sampleBlock.deloadWeek}`}
              </span>
            </div>
            <BlockBar
              week={sampleBlock.week}
              of={sampleBlock.of}
              deloadWeek={sampleBlock.deloadWeek}
            />
            <Bunch
              items={[
                {
                  value: String(sessions.length),
                  label: `${lifts} lifts · ${runs} runs`,
                },
                {
                  value: String(readiness),
                  label: "readiness",
                  delta: `+${readiness - sampleReadiness.low} clear`,
                },
                { value: miles.toFixed(1), label: "miles" },
                {
                  value: vdot.toFixed(1),
                  label: "VDOT",
                  delta: `+${vdotDelta.toFixed(1)}`,
                },
              ]}
            />
          </div>
          <WeekRibbon
            flat
            weeks={weeks}
            focusId={focusId}
            onFocus={setFocusId}
          />
        </div>
      </PageHeader>
      <div className="two-col">
        <Panel
          title="Sessions"
          aside={<a href="#/desktop/history">full history</a>}
        >
          <FilterChips
            label="Filter sessions"
            options={SESSION_FILTERS}
            value={filter}
            onPick={setFilter}
          />
          <SessionsTable sessions={shown} />
        </Panel>
        <Panel
          title="Estimated 1RMs"
          aside={<a href="#/desktop/lifts">all lifts</a>}
        >
          <ul className="e1rm-rows">
            {sampleLifts.map((l) => (
              <li key={l.id}>
                <a className="row-name" href={`#/desktop/lifts/${l.id}`}>
                  <b>{l.name}</b>
                </a>
                <span className="num">{l.e1rm} lb</span>
                <Pill tone={l.weekDeltaPct >= 3 ? "warn" : "mute"}>
                  {`${l.weekDeltaPct >= 0 ? "+" : ""}${l.weekDeltaPct}%`}
                </Pill>
              </li>
            ))}
          </ul>
          <p className="coach-note">
            Readiness {readiness} / 100.{" "}
            {readiness >= sampleReadiness.avg
              ? "At or above"
              : "A little under"} your average, so squat holds.
          </p>
        </Panel>
      </div>
    </div>
  );
}
