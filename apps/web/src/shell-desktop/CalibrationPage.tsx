/* Calibration view (DECISIONS U21): how many observations each lift has
 * against the 20 that free theta, the per-lift parameters, and the squat's
 * residuals. Reads the same `sampleLifts` the Lifts pages use, so this and
 * LiftDetailPage's calibration card never drift apart. */

import { DenseSeries } from "../shared/charts/index.ts";
import { DataTable } from "../shared/ui.tsx";
import { sampleLifts } from "../store/sample.ts";
import { PageHeader, Panel } from "./parts.tsx";

const FREE_AT = 20;
const BAR_MAX = 40;
/** VDOT observations so far (the running side of calibration). */
const VDOT_OBS = 9;

export function CalibrationPage() {
  const squat = sampleLifts.find((l) => l.id === "squat")!;
  const total = sampleLifts.reduce((n, l) => n + l.calibration.obs, 0);
  const rows = [
    ...sampleLifts.map((l) => ({ name: l.name, obs: l.calibration.obs })),
    { name: "VDOT", obs: VDOT_OBS },
  ];
  return (
    <div>
      <PageHeader
        kicker="Population defaults for about six weeks, then calibrate"
        title="Calibration"
      >
        <div className="lede-grid even">
          <div className="lede-left">
            <div className="bigweek figure">
              {total} <small>observations</small>
            </div>
            <div className="block-line">
              Theta frees at {FREE_AT} per lift
              <span>{` · across ${sampleLifts.length} lifts`}</span>
            </div>
          </div>
          <div
            className="obs-rows"
            role="img"
            aria-label={`Observations toward ${FREE_AT}: ${
              rows.map((r) => `${r.name} ${r.obs}`).join(", ")
            }`}
          >
            {rows.map((r) => (
              <div className="obs-row" key={r.name}>
                <b>{r.name}</b>
                <span className="obs-track">
                  <i
                    className={r.obs >= FREE_AT ? "free" : undefined}
                    style={{
                      width: `${Math.min(100, (r.obs / BAR_MAX) * 100)}%`,
                    }}
                  />
                  <u style={{ left: `${(FREE_AT / BAR_MAX) * 100}%` }} />
                </span>
                <span className="num">{r.obs}</span>
              </div>
            ))}
            <div className="obs-axis" aria-hidden="true">
              <span>0</span>
              <span style={{ left: `${(FREE_AT / BAR_MAX) * 100}%` }}>
                {FREE_AT}
              </span>
              <span>{BAR_MAX}</span>
            </div>
          </div>
        </div>
      </PageHeader>
      <div className="two-col wide-left">
        <Panel title="Fatigue parameters">
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
          <p className="note-line">
            <b>Run</b> · VDOT observations: {VDOT_OBS} of{" "}
            {FREE_AT}. Threshold pace still from a recent race (Riegel) until CS
            exists.
          </p>
        </Panel>
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
      </div>
    </div>
  );
}
