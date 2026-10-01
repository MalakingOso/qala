/* Readiness over the last week, by weekday. Average and low lines are
 * hairlines, labeled in the legend below so they never cross the trend. */

import { ChartShell } from "./ChartShell.tsx";
import { TrendPlot } from "./TrendPlot.tsx";

export function ReadinessLine(
  { values, avg, low, days }: {
    values: number[];
    avg: number;
    low: number;
    /** One label per value, oldest first; the last one is today. */
    days?: string[];
  },
) {
  const labels = days ?? values.map((_, i) => `Day ${i + 1}`);
  const latest = values[values.length - 1];
  return (
    <ChartShell
      title="Readiness, last 7 days"
      head={["Day", "Readiness"]}
      rows={values.map((v, i) => [labels[i], String(v)])}
      label={`Readiness last 7 days, today ${latest}, average ${avg}.`}
    >
      <div className="chart-headline">
        <span className="figure">{latest}</span>
        <span className="kbd-hint">
          today · {latest >= avg ? "at or above" : "under"} your {avg} average
        </span>
      </div>
      <TrendPlot
        points={values.map((v, i) => ({ label: labels[i], value: v }))}
        domain={[Math.min(40, Math.min(...values, low) - 5), 100]}
        references={[{
          label: "Your avg",
          value: avg,
          color: "var(--fg-muted)",
        }, { label: "Low under", value: low, color: "var(--danger)" }]}
      />
    </ChartShell>
  );
}
