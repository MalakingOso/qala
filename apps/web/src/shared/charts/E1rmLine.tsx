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
          { label: "Estimate · lb", color: "var(--viz-2)", line: true },
          {
            label: `Latest ${latest?.e1rm ?? "not recorded"}`,
            color: "var(--accent)",
          },
          ...(points.some((p) => p.tested)
            ? [{ label: "◆ Tested 1RM", color: "var(--viz-2)" }]
            : []),
        ]}
      />
    </ChartShell>
  );
}
