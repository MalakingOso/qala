/* Main-lift e1RM, recent: 2px line with markers, today's point in ember,
 * tested 1RMs as diamonds. Full history uses DenseSeries (uPlot). */

import { useMemo } from "react";
import { LinePath } from "@visx/shape";
import { scaleLinear, scalePoint } from "@visx/scale";
import { AxisLeft } from "@visx/axis";
import { ChartShell, Hit } from "./ChartShell.tsx";

const W = 560;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 12, left: 44 };

export interface E1rmPoint {
  label: string;
  e1rm: number;
  tested?: boolean;
}

export function E1rmLine(
  { lift, points }: { lift: string; points: E1rmPoint[] },
) {
  const { x, y } = useMemo(() => {
    const vs = points.map((p) => p.e1rm);
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    const pad = Math.max(2.5, (hi - lo) * 0.2);
    return {
      x: scalePoint<string>({
        domain: points.map((p) => p.label),
        range: [PAD.left, W - PAD.right],
        padding: 0.5,
      }),
      y: scaleLinear<number>({
        domain: [lo - pad, hi + pad],
        range: [H - PAD.bottom, PAD.top],
        nice: true,
      }),
    };
  }, [points]);
  const rows = points.map((
    p,
  ) => [p.label, String(p.e1rm), p.tested ? "tested" : "estimate"]);
  return (
    <ChartShell
      title={`${lift} e1RM, recent`}
      head={["Session", "e1RM", "Kind"]}
      rows={rows}
      label={`${lift} e1RM trend, latest ${points[points.length - 1]?.e1rm}.`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="presentation">
        <LinePath
          data={points}
          x={(d) => x(d.label) ?? 0}
          y={(d) => y(d.e1rm)}
          stroke="var(--viz-2)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => {
          const cx = x(p.label) ?? 0;
          const cy = y(p.e1rm);
          const last = i === points.length - 1;
          return (
            <Hit
              key={i}
              x={cx}
              y={cy}
              label={`${p.label}: ${p.e1rm}${p.tested ? " tested" : ""}`}
            >
              {p.tested
                ? (
                  <rect
                    x={-6}
                    y={-6}
                    width={12}
                    height={12}
                    transform="rotate(45)"
                    fill="var(--viz-2)"
                    stroke="var(--bg-surface)"
                    strokeWidth={2}
                  />
                )
                : (
                  <circle
                    r={5}
                    fill={last ? "var(--accent)" : "var(--bg-surface)"}
                    stroke={last ? "var(--accent)" : "var(--viz-2)"}
                    strokeWidth={2}
                  />
                )}
            </Hit>
          );
        })}
        <AxisLeft
          left={PAD.left}
          scale={y}
          numTicks={4}
          tickLabelProps={{
            fontSize: 10,
            fill: "var(--fg-muted)",
            textAnchor: "end",
          }}
          hideAxisLine
          hideTicks
        />
      </svg>
    </ChartShell>
  );
}
