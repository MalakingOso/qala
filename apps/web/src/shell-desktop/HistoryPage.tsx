/* Desktop history (DECISIONS U21): every logged session in one dense table,
 * filterable, with the coach's flag and your note under the row they belong
 * to. Rows link into SessionDetailPage (lifts) and RunDetailPage (runs). */

import { useState } from "react";
import { useQala } from "../store/qalaStore.tsx";
import { FilterChips, PageHeader } from "./parts.tsx";
import { SessionsTable } from "./SessionsTable.tsx";
import {
  filterSessions,
  SESSION_FILTERS,
  type SessionFilter,
} from "./sessions.ts";

export function DesktopHistoryPage() {
  const { sessions } = useQala();
  const [filter, setFilter] = useState<SessionFilter>("all");
  const shown = filterSessions(sessions, filter);
  const prs = sessions.reduce((n, s) => n + s.prCount, 0);
  const first = sessions[sessions.length - 1];
  const last = sessions[0];
  return (
    <div>
      <PageHeader
        kicker={`${first?.date ?? ""} to ${
          last?.date ?? ""
        } · ${sessions.length} sessions · ${prs} ${prs === 1 ? "PR" : "PRs"}`}
        title="History"
      >
        <FilterChips
          label="Filter sessions"
          options={SESSION_FILTERS}
          value={filter}
          onPick={setFilter}
          aside={`${shown.length} of ${sessions.length} sessions`}
        />
        <SessionsTable sessions={shown} detail />
      </PageHeader>
    </div>
  );
}
