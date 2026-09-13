/* Running index: VDOT trend, then every run, linking into RunDetailPage.
 * Previously a run was only reachable through one hard-coded sidebar entry
 * with no list; this is the "Running" stats bucket the desktop was missing. */

import { useQala } from "../store/qalaStore.tsx";
import { Card, DataTable } from "../shared/ui.tsx";
import { RunSpark } from "../shared/charts/index.ts";
import { sampleVdot } from "../store/sample.ts";

export function RunningPage() {
  const { sessions } = useQala();
  const runs = sessions.filter((s) => s.type === "run");
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Running</h1>
      </div>
      <RunSpark
        points={sampleVdot}
        label={`VDOT trend, latest ${sampleVdot[sampleVdot.length - 1]}.`}
      />
      <Card title="Runs">
        <DataTable
          head={["Date", "Run", "Distance", "sRPE", "rTSS"]}
          rows={runs.map((r) => [
            r.date,
            r.label,
            `${r.run!.distanceMi.toFixed(1)} mi`,
            String(r.sRPE),
            String(r.run!.rtss),
          ])}
          rowHrefs={runs.map((r) => `#/desktop/running/${r.id}`)}
        />
      </Card>
    </div>
  );
}
