/* Lift detail: full e1RM history with the Kalman line (uPlot, zoomable),
 * NL85 vs the block target, and the calibration numbers and residuals that
 * used to live only in the separate Calibration author page. */

import { Card, DataTable } from "../shared/ui.tsx";
import { BulletNl85, DenseSeries } from "../shared/charts/index.ts";
import { sampleLifts } from "../store/sample.ts";

export function LiftDetailPage({ id }: { id: string }) {
  const lift = sampleLifts.find((l) => l.id === id);
  if (!lift) {
    return (
      <div>
        <p className="breadcrumb">
          <a href="#/desktop/lifts">Lifts</a> <span>/</span> <span>{id}</span>
        </p>
        <p>No stats for "{id}" yet.</p>
      </div>
    );
  }
  const x = lift.fullHistory.map((h) => h.session);
  return (
    <div>
      <p className="breadcrumb">
        <a href="#/desktop/lifts">Lifts</a> <span>/</span>{" "}
        <span>{lift.name}</span>
      </p>
      <div className="page-head">
        <h1 className="page-title title">{lift.name}</h1>
        <span className="kbd-hint">
          e1RM {lift.e1rm} · Kalman {lift.kalman} ·{" "}
          {lift.weekDeltaPct >= 0 ? "+" : ""}
          {lift.weekDeltaPct}% this block
        </span>
      </div>
      <DenseSeries
        title={`${lift.name} e1RM, full history`}
        x={x}
        xLabel="session"
        series={[
          {
            label: "daily best",
            color: "var(--viz-2)",
            values: lift.fullHistory.map((h) => h.dailyBest),
          },
          {
            label: "Kalman",
            color: "var(--accent)",
            values: lift.fullHistory.map((h) => h.kalman),
          },
        ]}
        head={["Session", "Daily best", "Kalman"]}
        rows={x.slice(-5).map((n, i) => {
          const h = lift.fullHistory[lift.fullHistory.length - 5 + i];
          return [String(n), h.dailyBest.toFixed(1), h.kalman.toFixed(1)];
        })}
        label={`${lift.name} e1RM full history with Kalman line, zoom and drag.`}
      />
      <div className="card-grid">
        <BulletNl85
          lifts={[{
            lift: lift.name,
            actual: lift.nl85.actual,
            target: lift.nl85.target,
          }]}
        />
        <Card title="Calibration">
          <DataTable
            head={["p0", "k1", "theta", "Obs"]}
            rows={[[
              String(lift.calibration.p0),
              String(lift.calibration.k1),
              lift.calibration.theta,
              String(lift.calibration.obs),
            ]]}
          />
        </Card>
      </div>
      <DenseSeries
        title={`${lift.name} calibration residuals`}
        x={lift.residuals.map((_, i) => i + 1)}
        xLabel="observation"
        series={[{
          label: "residual",
          color: "var(--viz-3)",
          values: lift.residuals,
        }]}
        head={["Obs", "Residual"]}
        rows={[[
          String(lift.residuals.length),
          lift.residuals[lift.residuals.length - 1].toFixed(2),
        ]]}
        label={`${lift.name} Kalman residuals decaying toward zero.`}
      />
    </div>
  );
}
