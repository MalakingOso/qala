/* Desktop home (DESIGN 7.15, DECISIONS U20, U21, U27). A lede card where the
 * chart takes over: the load zoom runs the card's full width, its picker sits
 * on the title row and the title names the view (Today, This week, Weeks 2 to
 * 4, the block). Where the block stands lives in the kicker. Below it the
 * sessions and the estimated 1RMs. Replaces the stat-tile dashboard. */

import { useMemo, useState } from "react";
import {
  blockModel,
  type Level,
  parseZ,
  snapLevel,
  zoomTitle,
} from "../logic/loadZoom.ts";
import { useQala } from "../store/qalaStore.tsx";
import { LoadZoom, ZoomPicker } from "../shared/charts/index.ts";
import { sampleBlock, sampleLifts, sampleReadiness } from "../store/sample.ts";
import { SessionsTable } from "./SessionsTable.tsx";
import { FilterChips, PageHeader, Panel, Pill } from "./parts.tsx";
import {
  filterSessions,
  SESSION_FILTERS,
  type SessionFilter,
} from "./sessions.ts";
import { useWeekFocus } from "./weekFocus.tsx";

/** The Overview opens at three weeks; `?z=` in a dev build opens it where a
 * screenshot needs. */
function openingLevel(): Level {
  const forced = import.meta.env.DEV && typeof location !== "undefined"
    ? parseZ(location.search)
    : null;
  return forced === null ? 2 : snapLevel(forced);
}

export function OverviewPage() {
  const { sessions } = useQala();
  const { weeks, anchor, setAnchor } = useWeekFocus();
  const [filter, setFilter] = useState<SessionFilter>("all");
  const [zoom, setZoom] = useState<Level>(openingLevel);
  const model = useMemo(() => blockModel(weeks), [weeks]);

  const readiness = sampleReadiness.values[sampleReadiness.values.length - 1];
  const shown = filterSessions(sessions, filter).slice(0, 5);

  return (
    <div>
      <PageHeader
        kicker={`${sampleBlock.today} · ${sampleBlock.name} · week ${sampleBlock.week} of ${sampleBlock.of} · deload in week ${sampleBlock.deloadWeek}`}
        title={zoomTitle(model, zoom, anchor, sampleBlock.name)}
        action={<ZoomPicker level={zoom} onLevel={setZoom} />}
      >
        <LoadZoom
          flat
          height={120}
          weeks={weeks}
          level={zoom}
          onLevel={setZoom}
          anchor={anchor}
          onAnchor={setAnchor}
        />
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
