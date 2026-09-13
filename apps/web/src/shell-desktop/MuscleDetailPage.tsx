/* Muscle detail: weekly volume trend against the band (PLAN 6.3's
 * fractional-set MEV/MRV caps), the lifting/running fatigue split, and when
 * the muscle is expected ready. Reached by clicking a muscle in the
 * sets-by-muscle chart. */

import { Card, DataTable } from "../shared/ui.tsx";
import { DenseSeries } from "../shared/charts/index.ts";
import { sampleMuscles } from "../store/sample.ts";

export function MuscleDetailPage({ muscle }: { muscle: string }) {
  const m = sampleMuscles.find((s) => s.muscle === muscle);
  if (!m) {
    return (
      <div>
        <p className="breadcrumb">
          <a href="#/desktop/body">Body</a> <span>/</span> <span>{muscle}</span>
        </p>
        <p>No stats for "{muscle}" yet.</p>
      </div>
    );
  }
  const total = m.earlier + m.today;
  const max = Math.max(m.band[1] + 4, total + 2);
  const pct = (v: number) => `${(v / max) * 100}%`;
  return (
    <div>
      <p className="breadcrumb">
        <a href="#/desktop/body">Body</a> <span>/</span> <span>{m.muscle}</span>
      </p>
      <div className="page-head">
        <h1
          className="page-title title"
          style={{ textTransform: "capitalize" }}
        >
          {m.muscle}
        </h1>
        <span className="kbd-hint">ready {m.readyDay}</span>
      </div>
      <Card title="This week vs band">
        <p className="kbd-hint">
          {total} sets this week · band {m.band[0]}-{m.band[1]}
        </p>
        <div className="band-bar" aria-hidden="true">
          <div
            className="band"
            style={{
              left: pct(m.band[0]),
              width: `calc(${pct(m.band[1])} - ${pct(m.band[0])})`,
            }}
          />
          <div className="fill" style={{ width: pct(total) }} />
        </div>
        <DataTable
          head={["Fatigue", "Lifting", "Running"]}
          rows={[[
            "set-equivalents",
            m.lifting.toFixed(1),
            m.running.toFixed(1),
          ]]}
        />
      </Card>
      <DenseSeries
        title={`${m.muscle} weekly sets, recent`}
        x={m.weeklyHistory.map((_, i) => i + 1)}
        xLabel="week"
        series={[{
          label: "sets",
          color: "var(--viz-1)",
          values: m.weeklyHistory,
        }]}
        head={["Week", "Sets"]}
        rows={m.weeklyHistory.map((v, i) => [String(i + 1), String(v)])}
        label={`${m.muscle} weekly sets trend.`}
      />
    </div>
  );
}
