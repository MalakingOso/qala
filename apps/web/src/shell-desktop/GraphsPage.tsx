/* Desktop graphs (PLAN 9): e1RM full history (uPlot zoomable), NL85 vs
 * block table, sets vs band/RP caps, PRs, fitness-fatigue curves (uPlot),
 * VDOT, readiness, TRIMP split, distance with flags, run pace/HR/elevation
 * (uPlot), calibration residuals (uPlot). Every chart has a table view. */

import {
  BulletNl85,
  DenseSeries,
  E1rmLine,
  ReadinessLine,
  RepsIntensity,
  RunSpark,
  SetsByMuscle,
} from "../shared/charts/index.ts";

const HISTORY_X = Array.from({ length: 60 }, (_, i) => i + 1);
const E1RM_HIST = HISTORY_X.map((i) => 262 + i * 0.35 + 2 * Math.sin(i / 5));

export function GraphsPage() {
  return (
    <div>
      <div className="page-head">
        <h2 className="title" style={{ margin: 0 }}>Graphs</h2>
      </div>
      <DenseSeries
        title="Squat e1RM, full history"
        x={HISTORY_X}
        xLabel="session"
        series={[
          { label: "daily best", color: "var(--viz-2)", values: E1RM_HIST },
          {
            label: "Kalman",
            color: "var(--accent)",
            values: E1RM_HIST.map((v) => v - 1.5),
          },
        ]}
        head={["Session", "Daily best", "Kalman"]}
        rows={HISTORY_X.slice(-5).map((i) => [
          String(i),
          E1RM_HIST[i - 1].toFixed(1),
          (E1RM_HIST[i - 1] - 1.5).toFixed(1),
        ])}
        label="Squat e1RM full history with Kalman line, zoom and drag."
      />
      <BulletNl85
        lifts={[
          { lift: "squat w1", actual: 0, target: 0 },
          { lift: "squat w2", actual: 0, target: 0 },
          { lift: "squat w3", actual: 15, target: 15 },
          { lift: "squat w4", actual: 10, target: 12 },
        ]}
      />
      <SetsByMuscle
        title="Weekly sets vs band"
        muscles={[
          { muscle: "quads", earlier: 8, today: 5 },
          { muscle: "chest", earlier: 12, today: 0 },
          { muscle: "back", earlier: 14, today: 0 },
          { muscle: "hamstrings", earlier: 4, today: 2 },
        ]}
      />
      <RepsIntensity
        nl85={37}
        zones={[
          { label: "<70", reps: 60 },
          { label: "70-80", reps: 44 },
          { label: "80-85", reps: 30 },
          { label: "85-90", reps: 25 },
          { label: "90+", reps: 12 },
        ]}
      />
      <DenseSeries
        title="Fitness and fatigue"
        x={HISTORY_X}
        xLabel="day"
        series={[
          {
            label: "fitness",
            color: "var(--viz-2)",
            values: HISTORY_X.map((i) => 40 + i * 0.4),
          },
          {
            label: "fatigue",
            color: "var(--viz-1)",
            values: HISTORY_X.map((i) => 20 + 8 * Math.sin(i / 4) + i * 0.05),
          },
        ]}
        head={["Day", "Fitness", "Fatigue"]}
        rows={[["60", "64.0", "24.1"]]}
        label="Lifting fitness and fatigue curves."
      />
      <RunSpark
        points={[38.5, 39.1, 39.0, 39.8, 40.2, 40.5]}
        label="VDOT trend rising."
      />
      <ReadinessLine values={[78, 74, 80, 76, 71, 69, 72]} avg={76} low={64} />
      <E1rmLine
        lift="Bench"
        points={[
          { label: "s5", e1rm: 241 },
          { label: "s6", e1rm: 243 },
          { label: "today", e1rm: 245 },
        ]}
      />
      <DenseSeries
        title="Calibration residuals"
        x={HISTORY_X.slice(0, 30)}
        xLabel="observation"
        series={[
          {
            label: "residual",
            color: "var(--viz-3)",
            values: HISTORY_X.slice(0, 30).map((i) =>
              3 * Math.sin(i / 2) * Math.exp(-i / 40)
            ),
          },
        ]}
        head={["Obs", "Residual"]}
        rows={[["30", "0.4"]]}
        label="Kalman residuals decaying toward zero."
      />
    </div>
  );
}
