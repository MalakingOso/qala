/* Desktop run detail: synced pace / heart-rate / elevation (uPlot). Reads
 * one run session by id (from the Running index or History) instead of the
 * single hard-coded run this page used to always show. */

import { useQala } from "../store/qalaStore.tsx";
import { Card } from "../shared/ui.tsx";
import { DenseSeries, SplitsTable } from "../shared/charts/index.ts";

export function RunDetailPage({ id }: { id?: string }) {
  const { sessions } = useQala();
  const runs = sessions.filter((s) => s.type === "run");
  const run = (id ? runs.find((s) => s.id === id) : runs[0]) ?? runs[0];
  if (!run || !run.run) {
    return (
      <div>
        <p className="breadcrumb">
          <a href="#/desktop/running">Running</a>
        </p>
        <p>No run logged yet.</p>
      </div>
    );
  }
  const t = run.run.pace.map((_, i) => i * 15);
  return (
    <div>
      <p className="breadcrumb">
        <a href="#/desktop/running">Running</a> <span>/</span>{" "}
        <span>{run.date}</span>
      </p>
      <div className="page-head">
        <h1 className="page-title title">
          {run.date} · {run.label} · {run.run.distanceMi.toFixed(1)} mi
        </h1>
      </div>
      <DenseSeries
        title="Pace, heart rate, elevation"
        x={t}
        xLabel="sec"
        series={[
          { label: "pace (sec/mi)", color: "var(--run)", values: run.run.pace },
          { label: "HR", color: "var(--zone-5)", values: run.run.hr },
          { label: "elev (m)", color: "var(--viz-3)", values: run.run.elev },
        ]}
        head={["Sec", "Pace", "HR", "Elev"]}
        rows={[0, Math.floor(t.length / 2), t.length - 1].map((i) => [
          String(t[i]),
          run.run!.pace[i].toFixed(0),
          run.run!.hr[i].toFixed(0),
          run.run!.elev[i].toFixed(0),
        ])}
        label="Synced pace, heart rate and elevation."
      />
      <SplitsTable splits={run.run.splits} />
      <Card title="Load">
        <p>
          rTSS {run.run.rtss} · sRPE-load {run.run.sRpeLoad} · TRIMP (Banister)
          {" "}
          {run.run.hrStrap
            ? "computed from HR strap data."
            : "hidden: no HR strap on this run."}
        </p>
        {run.notes ? <p className="kbd-hint">{run.notes}</p> : null}
      </Card>
    </div>
  );
}
