/* Calibration view: per-lift p0/k1/theta, observation counts, residuals.
 * Reads the same `sampleLifts` the Lifts stats pages use, so this and
 * LiftDetailPage's calibration card never drift apart. */

import { Card, DataTable } from "../shared/ui.tsx";
import { DenseSeries } from "../shared/charts/index.ts";
import { sampleLifts } from "../store/sample.ts";

export function CalibrationPage() {
  const squat = sampleLifts.find((l) => l.id === "squat")!;
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">Calibration</h1>
      </div>
      <Card>
        <p className="kbd-hint">
          Population defaults for ~6 weeks, then calibrate. Theta frees at 20
          observations per lift.
        </p>
        <DataTable
          head={["Lift", "p0", "k1", "theta", "Obs"]}
          rows={sampleLifts.map((l) => [
            l.name,
            String(l.calibration.p0),
            String(l.calibration.k1),
            l.calibration.theta,
            String(l.calibration.obs),
          ])}
          rowHrefs={sampleLifts.map((l) => `#/desktop/lifts/${l.id}`)}
        />
      </Card>
      <DenseSeries
        title={`${squat.name} residuals`}
        x={squat.residuals.map((_, i) => i + 1)}
        xLabel="observation"
        series={[{
          label: "residual",
          color: "var(--viz-3)",
          values: squat.residuals,
        }]}
        head={["Obs", "Residual"]}
        rows={[[
          String(squat.residuals.length),
          squat.residuals[squat.residuals.length - 1].toFixed(2),
        ]]}
        label={`${squat.name} Kalman residuals.`}
      />
      <Card title="Run">
        <p>
          VDOT observations: 9 of 20. Threshold pace still from recent race
          (Riegel) until CS exists.
        </p>
      </Card>
    </div>
  );
}
