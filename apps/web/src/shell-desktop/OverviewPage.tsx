/* Desktop home (DESIGN 7.15, DECISIONS U20, U21, U27). A lede card where the
 * chart takes over: the load zoom fills the card, its picker sits on the title
 * row and the title names the view (Today, This week, the month, the
 * block). The day and date lead the kicker and where the block stands sits
 * quietly at its right. The estimated 1RMs sit beside the card (readiness
 * lives on the phone and the body page), the sessions below. Replaces the stat-tile dashboard. */

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
import { sampleBlock, sampleLifts } from "../store/sample.ts";
import { SessionsTable } from "./SessionsTable.tsx";
import { FilterChips, PageHeader, Panel, Pill } from "./parts.tsx";
import {
  filterSessions,
  SESSION_FILTERS,
  type SessionFilter,
} from "./sessions.ts";
import { useWeekFocus } from "./weekFocus.tsx";

/** The Overview opens at Month; `?z=` in a dev build opens it where a
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

  const shown = filterSessions(sessions, filter).slice(0, 5);

  const e1rms = (
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
    </Panel>
  );

  return (
    <div>
      <div className="overview-top">
        <PageHeader
          kicker={
            <span className="kicker-split">
              <span>{sampleBlock.today}</span>
              <span className="kicker-meta">
                {zoom === 3 ? "" : `${sampleBlock.name} · `}
                Week {sampleBlock.week} of {sampleBlock.of}
              </span>
            </span>
          }
          title={zoomTitle(model, zoom, anchor, sampleBlock.name)}
          action={<ZoomPicker level={zoom} onLevel={setZoom} />}
        >
          <LoadZoom
            flat
            height={96}
            weeks={weeks}
            level={zoom}
            onLevel={setZoom}
            anchor={anchor}
            onAnchor={setAnchor}
          />
        </PageHeader>
        {e1rms}
      </div>
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
    </div>
  );
}
