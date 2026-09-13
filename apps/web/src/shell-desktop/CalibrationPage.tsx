/* Calibration view: per-lift p0/k1/theta, observation counts, residuals. */

import { Card, DataTable } from "../shared/ui.tsx";
import { DenseSeries } from "../shared/charts/index.ts";

const LIFTS = [
  { lift: "squat", p0: "248.1", k1: "0.62", theta: "4.0 (prior)", obs: "34" },
  { lift: "bench", p0: "211.4", k1: "0.55", theta: "4.0 (prior)", obs: "31" },
  { lift: "deadlift", p0: "302.7", k1: "0.71", theta: "4.0 (prior)", obs: "22" },
  { lift: "press", p0: "141.2", k1: "0.48", theta: "4.0 (prior)", obs: "18" },
];

export function CalibrationPage() {
  return (
    <div>
      <div className="page-head">
        <h2 className="title" style={{ margin: 0 }}>Calibration</h2>
      </div>
      <Card>
        <p className="kbd-hint">Population defaults for ~6 weeks, then calibrate. Theta frees at 20 observations per lift.</p>
        <DataTable
          head={["Lift", "p0", "k1", "theta", "Obs"]}
          rows={LIFTS.map((l) => [l.lift, l.p0, l.k1, l.theta, l.obs])}
        />
      </Card>
      <DenseSeries
        title="Squat residuals"
        x={Array.from({ length: 34 }, (_, i) => i + 1)}
        xLabel="observation"
        series={[
          { label: "residual", color: "var(--viz-3)", values: Array.from({ length: 34 }, (_, i) => 4 * Math.sin(i / 3) * Math.exp(-i / 30)) },
        ]}
        head={["Obs", "Residual"]}
        rows={[["34", "0.2"]]}
        label="Squat Kalman residuals."
      />
      <Card title="Run">
        <p>VDOT observations: 9 of 20. Threshold pace still from recent race (Riegel) until CS exists.</p>
      </Card>
    </div>
  );
}
