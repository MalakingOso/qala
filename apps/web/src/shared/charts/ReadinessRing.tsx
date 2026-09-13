/* Readiness ring (DESIGN 6.4): value arc out of 100, low zone tint, average
 * and low ticks, two-line legend. Geometry math lives in logic/. */

import { Arc } from "@visx/shape";
import { Group } from "@visx/group";
import { readinessRing } from "../../logic/readinessRing.ts";
import { ChartShell } from "./ChartShell.tsx";

const S = 200;
const R = 84;
const TRACK = 14;
const ARC_W = 9;

function polar(
  cx: number,
  cy: number,
  r: number,
  frac: number,
): [number, number] {
  const a = -Math.PI / 2 + frac * Math.PI * 2;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

export function ReadinessRing({
  readiness,
  avg,
  lowLine,
  checkins,
  prs,
}: {
  readiness: number;
  avg: number | null;
  lowLine: number;
  checkins: number;
  prs?: number;
}) {
  const m = readinessRing(readiness, avg, lowLine, checkins, prs);
  const cx = S / 2;
  const cy = S / 2;
  const full = Math.PI * 2;
  const valueColor = m.low ? "var(--danger)" : "var(--progress-fill)";
  const [ax, ay] = m.avgFrac !== null ? polar(cx, cy, R, m.avgFrac) : [0, 0];
  const [lx, ly] = polar(cx, cy, R, m.lowFrac);
  return (
    <ChartShell
      title="Readiness"
      head={["Figure", "Value"]}
      rows={[
        ["readiness", `${m.value}`],
        ["average", m.legendAvg],
        ["low line", m.legendLow],
      ]}
      label={`Readiness ${m.value} of 100${
        m.low ? ", low" : ""
      }. ${m.legendAvg}. ${m.legendLow}.`}
    >
      <svg viewBox={`0 0 ${S} ${S + 34}`} width="100%" role="presentation">
        <Group>
          <Arc
            innerRadius={R - TRACK / 2}
            outerRadius={R + TRACK / 2}
            startAngle={0}
            endAngle={full}
            fill="var(--bg-active)"
          />
          <Arc
            innerRadius={R - TRACK / 2}
            outerRadius={R + TRACK / 2}
            startAngle={0}
            endAngle={m.lowFrac * full}
            fill="var(--low-zone)"
          />
          <Arc
            innerRadius={R - ARC_W / 2}
            outerRadius={R + ARC_W / 2}
            startAngle={0}
            endAngle={Math.max(0.02, m.valueFrac * full)}
            fill={valueColor}
            cornerRadius={ARC_W / 2}
          />
          {m.avgFrac !== null
            ? <circle cx={ax} cy={ay} r={4} fill="var(--fg)" />
            : null}
          <circle cx={lx} cy={ly} r={4} fill="var(--danger)" />
          <text
            x={cx}
            y={cy + 12}
            textAnchor="middle"
            fontSize={40}
            fill="var(--fg)"
            className="figure"
          >
            {m.value}
          </text>
          {m.low
            ? (
              <text
                x={cx}
                y={cy + 32}
                textAnchor="middle"
                fontSize={12}
                fill="var(--danger)"
              >
                low
              </text>
            )
            : null}
        </Group>
        <text
          x={cx}
          y={S + 14}
          textAnchor="middle"
          fontSize={11}
          fill="var(--fg)"
        >
          {m.legendAvg} · {m.legendLow}
        </text>
      </svg>
    </ChartShell>
  );
}
