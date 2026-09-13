/* Desktop run detail: synced pace / heart-rate / elevation (uPlot). Reads
 * one run session by id (from the Running index or History) instead of the
 * single hard-coded run this page used to always show. */

import { useQala } from "../store/qalaStore.tsx";
import { Card, StatTiles } from "../shared/ui.tsx";
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
        <div>
          <h1 className="page-title title">{run.label}</h1>
          <p className="page-subtitle">
            {run.date} · {run.run.distanceMi.toFixed(1)} miles
          </p>
        </div>
      </div>
      <StatTiles
        tiles={[
          { value: run.run.distanceMi.toFixed(1), label: "distance · mi" },
          { value: String(run.sRPE), label: "session RPE" },
          { value: String(run.run.rtss), label: "running load · rTSS" },
        ]}
      />
      <p className="kbd-hint">
        Drag to zoom. Pace, heart rate, and elevation share the same time
        window.
      </p>
      {[
        {
          title: "Pace",
          label: "sec/mi",
          color: "var(--run)",
          values: run.run.pace,
        },
        {
          title: "Heart rate",
          label: "bpm",
          color: "var(--zone-5)",
          values: run.run.hr,
        },
        {
          title: "Elevation",
          label: "m",
          color: "var(--viz-3)",
          values: run.run.elev,
        },
      ].map((metric) => (
        <DenseSeries
          key={metric.title}
          title={metric.title}
          x={t}
          xLabel="sec"
          series={[{
            label: metric.label,
            color: metric.color,
            values: metric.values,
          }]}
          height={180}
          syncKey={`run-${run.id}`}
          head={["Sec", metric.label]}
          rows={t.map((sec, i) => [String(sec), metric.values[i].toFixed(0)])}
          label={`${metric.title} over the run, in ${metric.label}.`}
        />
      ))}
      <div className="card-grid">
        <SplitsTable splits={run.run.splits} />
        <Card title="Load">
          <p>
            rTSS {run.run.rtss} · sRPE-load {run.run.sRpeLoad}{" "}
            · TRIMP (Banister) {run.run.hrStrap
              ? "computed from HR strap data."
              : "hidden: no HR strap on this run."}
          </p>
          {run.notes ? <p className="kbd-hint">{run.notes}</p> : null}
        </Card>
      </div>
    </div>
  );
}
