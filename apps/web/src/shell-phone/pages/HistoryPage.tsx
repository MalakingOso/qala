/* History: every session, newest first, grouped by week. It starts cold;
 * each session lands here and replays into the engine. */

import { Group } from "../../shared/ui.tsx";
import { SessionRow } from "../SessionRow.tsx";

export function HistoryPage() {
  return (
    <div>
      <div className="page-head">
        <div>
          <p className="group-label page-eyebrow">Strength block 2</p>
          <h1 className="page-title title">History</h1>
        </div>
      </div>
      <Group
        label="Week 3 · Sep 7-13"
        action={<span className="kbd-hint">Thu run skipped</span>}
      >
        <SessionRow
          kind="lift"
          day="Sun"
          title="Lower A"
          detail="20.4k lb · 58 min"
          badge="1 PR"
        />
        <SessionRow
          kind="run"
          day="Sat"
          title="Long run"
          detail="7.0 mi · 1:04"
          badge="rTSS 84"
        />
        <SessionRow
          kind="lift"
          day="Fri"
          title="Upper B"
          detail="14.1k lb · 52 min"
        />
        <SessionRow
          kind="lift"
          day="Wed"
          title="Lower B"
          detail="18.9k lb · 61 min"
        />
        <SessionRow
          kind="run"
          day="Tue"
          title="Easy run"
          detail="4.0 mi · 37 min"
        />
        <SessionRow
          kind="lift"
          day="Mon"
          title="Upper A"
          detail="15.2k lb · 66 min"
        />
      </Group>
      <p className="kbd-hint footnote">
        History starts cold. Every session lands here and replays into the
        engine.
      </p>
    </div>
  );
}
