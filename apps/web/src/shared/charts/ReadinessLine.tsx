/* Average and low labels live below the plot to avoid crossing the trend. */

import { ChartShell } from "./ChartShell.tsx";
import { TrendPlot } from "./TrendPlot.tsx";

export function ReadinessLine(
  { values, avg, low }: { values: number[]; avg: number; low: number },
) {
  return (
    <ChartShell
      title="Readiness, last 7 days"
      head={["Day", "Readiness"]}
      rows={values.map((v, i) => [`day ${i + 1}`, String(v)])}
      label={`Readiness last 7 days, latest ${values[values.length - 1]}.`}
    >
      <TrendPlot
        points={values.map((v, i) => ({ label: `Day ${i + 1}`, value: v }))}
        domain={[0, 100]}
        references={[{
          label: "Your avg",
          value: avg,
          color: "var(--fg-muted)",
        }, { label: "Low under", value: low, color: "var(--danger)" }]}
      />
    </ChartShell>
  );
}
