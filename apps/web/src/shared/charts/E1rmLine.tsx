/* Recent e1RM: smooth trend with measured points and tested 1RM diamonds. */

import { ChartShell } from "./ChartShell.tsx";
import { ChartLegend } from "./Plot.tsx";
import { TrendPlot } from "./TrendPlot.tsx";

export interface E1rmPoint {
  label: string;
  e1rm: number;
  tested?: boolean;
}

export function E1rmLine(
  { lift, points, flat }: { lift: string; points: E1rmPoint[]; flat?: boolean },
) {
  const latest = points[points.length - 1];
  const first = points[0];
  const change = latest && first ? latest.e1rm - first.e1rm : 0;
  return (
    <ChartShell
      title={flat ? "Recent trend" : `${lift} e1RM, recent`}
      flat={flat}
      head={["Session", "e1RM", "Kind"]}
      rows={points.map((
        p,
      ) => [p.label, String(p.e1rm), p.tested ? "tested" : "estimate"])}
      label={`${lift} e1RM trend, latest ${latest?.e1rm ?? "not recorded"}.`}
    >
      {latest && !flat
        ? (
          <div className="chart-headline">
            <span className="figure">
              {latest.e1rm} <span className="figure-unit">lb</span>
            </span>
            <span className="kbd-hint">
              {change >= 0 ? "+" : "−"}
              {Math.abs(change)} lb since {first.label}
            </span>
          </div>
        )
        : null}
      <TrendPlot
        points={points.map((p) => ({
          label: p.label,
          value: p.e1rm,
          tested: p.tested,
        }))}
        unit=" lb"
      />
      <ChartLegend
        items={[
          { label: "Estimated 1RM", color: "var(--viz-2)", line: true },
          { label: `${latest?.label ?? "Latest"}`, color: "var(--accent)" },
          ...(points.some((p) => p.tested)
            ? [{ label: "Tested 1RM", color: "var(--viz-2)", diamond: true }]
            : []),
        ]}
      />
    </ChartShell>
  );
}
