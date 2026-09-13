/* Readiness, last 7 days: line with markers, average and low hairlines. */

import { useMemo } from "react";
import { LinePath } from "@visx/shape";
import { scaleLinear, scalePoint } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { ChartShell, Hit } from "./ChartShell.tsx";

const W = 560;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 28, left: 34 };

export function ReadinessLine({
  values,
  avg,
  low,
}: {
  values: number[];
  avg: number;
  low: number;
}) {
  const { x, y } = useMemo(
    () => ({
      x: scalePoint<string>({
        domain: values.map((_, i) => String(i)),
        range: [PAD.left, W - PAD.right],
        padding: 0.5,
      }),
      y: scaleLinear<number>({
        domain: [0, 100],
        range: [H - PAD.bottom, PAD.top],
        nice: true,
      }),
    }),
    [values],
  );
  const rows = values.map((v, i) => [`day ${i + 1}`, String(v)]);
  return (
    <ChartShell
      title="Readiness, last 7 days"
      head={["Day", "Readiness"]}
      rows={rows}
      label={`Readiness last 7 days, latest ${values[values.length - 1]}.`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="presentation">
        {[avg, low].map((v, k) => (
          <line
            key={k}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(v)}
            y2={y(v)}
            stroke={k === 0 ? "var(--fg)" : "var(--danger)"}
            strokeWidth={1}
          />
        ))}
        <LinePath
          data={values}
          x={(_, i) => x(String(i)) ?? 0}
          y={(d) => y(d)}
          stroke="var(--viz-2)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {values.map((v, i) => (
          <Hit
            key={i}
            x={x(String(i)) ?? 0}
            y={y(v)}
            label={`day ${i + 1}: ${v}`}
          >
            <circle
              r={5}
              fill="var(--bg-surface)"
              stroke="var(--viz-2)"
              strokeWidth={2}
            />
          </Hit>
        ))}
        <AxisBottom
          top={H - PAD.bottom}
          scale={x}
          tickFormat={(i) => `d${Number(i) + 1}`}
          tickLabelProps={{
            fontSize: 10,
            fill: "var(--fg-muted)",
            textAnchor: "middle",
          }}
          hideAxisLine
          hideTicks
        />
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
