/* Desktop history: every logged session, linking into its full detail
 * (lift sessions to SessionDetailPage, runs to RunDetailPage). Previously a
 * flat table of unlinked sample text. */

import { useQala } from "../store/qalaStore.tsx";
import { Card, DataTable } from "../shared/ui.tsx";

export function DesktopHistoryPage() {
  const { sessions } = useQala();
  const rows = sessions.map((s) => [
    s.date,
    `${s.label}${
      s.type === "run" ? ` · ${s.run!.distanceMi.toFixed(1)} mi` : ""
    }`,
    s.type === "lift" ? `${((s.loadLb ?? 0) / 1000).toFixed(1)}k lb` : "—",
    String(s.sRPE),
    s.prCount > 0 ? `${s.prCount} PR` : (s.notes ? "note" : ""),
  ]);
  const rowHrefs = sessions.map((s) =>
    s.type === "run" ? `#/desktop/running/${s.id}` : `#/desktop/history/${s.id}`
  );
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">History</h1>
      </div>
      <Card>
        <DataTable
          head={["Date", "Session", "Load", "sRPE", "Notes"]}
          rows={rows}
          rowHrefs={rowHrefs}
        />
      </Card>
    </div>
  );
}
