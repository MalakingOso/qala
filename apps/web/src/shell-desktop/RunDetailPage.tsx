/* Desktop run detail: synced pace / heart-rate / elevation (uPlot). */

import { Card } from "../shared/ui.tsx";
import { DenseSeries, SplitsTable } from "../shared/charts/index.ts";
import { sampleSplits } from "../store/sample.ts";

const T = Array.from({ length: 120 }, (_, i) => i * 15);

export function RunDetailPage() {
  return (
    <div>
      <div className="page-head">
        <h2 className="title" style={{ margin: 0 }}>Sat · Long run · 7.0 mi</h2>
      </div>
      <DenseSeries
        title="Pace, heart rate, elevation"
        x={T}
        xLabel="sec"
        series={[
          { label: "pace (sec/mi)", color: "var(--run)", values: T.map((t) => 545 + 20 * Math.sin(t / 300)) },
          { label: "HR", color: "var(--zone-5)", values: T.map((t) => 138 + 8 * Math.sin(t / 420)) },
          { label: "elev (m)", color: "var(--viz-3)", values: T.map((t) => 300 + 12 * Math.sin(t / 500)) },
        ]}
        head={["Sec", "Pace", "HR", "Elev"]}
        rows={[["0", "9:05", "138", "300"], ["900", "9:08", "142", "306"], ["1800", "9:02", "145", "298"]]}
        label="Synced pace, heart rate and elevation."
      />
      <SplitsTable splits={sampleSplits} />
      <Card title="Load">
        <p>rTSS 84 · sRPE-load 49 · TRIMP (Banister) hidden: no HR strap on this run.</p>
      </Card>
    </div>
  );
}
