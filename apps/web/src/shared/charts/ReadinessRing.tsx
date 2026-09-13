/* Readiness ring (DESIGN 6.4): value arc out of 100, low zone tint, average
 * and low ticks, two-line legend. Geometry math lives in logic/.
 *
 * Sized with ParentSize so the ring, its ticks and its 40px number are drawn
 * in real pixels for whatever width the caller gives it, instead of a fixed
 * 200-unit viewBox getting crushed inside a narrow card column. */

import { ParentSize } from "@visx/responsive";
import { Arc } from "@visx/shape";
import { Group } from "@visx/group";
import { readinessRing } from "../../logic/readinessRing.ts";
import { ChartShell } from "./ChartShell.tsx";

const MIN_S = 140;
const LEGEND_H = 40;

function polar(
  cx: number,
  cy: number,
  r: number,
  frac: number,
): [number, number] {
  const a = -Math.PI / 2 + frac * Math.PI * 2;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function RingInner({
  width,
  height,
  readiness,
  avg,
  lowLine,
  checkins,
  prs,
}: {
  width: number;
  height: number;
  readiness: number;
  avg: number | null;
  lowLine: number;
  checkins: number;
  prs?: number;
}) {
  const m = readinessRing(readiness, avg, lowLine, checkins, prs);
  const S = Math.max(MIN_S, Math.min(width, height - LEGEND_H));
  const R = S * 0.36;
  const TRACK = Math.max(10, S * 0.07);
  const ARC_W = Math.max(7, S * 0.045);
  const TICK_LEN = Math.max(7, S * 0.055);
  const cx = width / 2;
  const cy = S / 2 + 4;
  const full = Math.PI * 2;
  const valueColor = m.low ? "var(--danger)" : "var(--progress-fill)";
  return (
    <svg
      width={width}
      height={S + LEGEND_H}
      viewBox={`0 0 ${width} ${S + LEGEND_H}`}
      role="presentation"
    >
      <Group>
        <Group top={cy} left={cx}>
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
        </Group>
        {m.avgFrac !== null
          ? (() => {
            const [x0, y0] = polar(cx, cy, R - TRACK / 2 - 2, m.avgFrac);
            const [x1, y1] = polar(cx, cy, R + TRACK / 2 + TICK_LEN, m.avgFrac);
            return (
              <line
                x1={x0}
                y1={y0}
                x2={x1}
                y2={y1}
                stroke="var(--fg)"
                strokeWidth={3}
                strokeLinecap="round"
              />
            );
          })()
          : null}
        {(() => {
          const [x0, y0] = polar(cx, cy, R - TRACK / 2 - 2, m.lowFrac);
          const [x1, y1] = polar(cx, cy, R + TRACK / 2 + TICK_LEN, m.lowFrac);
          return (
            <line
              x1={x0}
              y1={y0}
              x2={x1}
              y2={y1}
              stroke="var(--danger)"
              strokeWidth={3}
              strokeLinecap="round"
            />
          );
        })()}
        <text
          x={cx}
          y={cy + S * 0.08}
          textAnchor="middle"
          fontSize={Math.max(28, S * 0.22)}
          fill="var(--fg)"
          className="figure"
        >
          {m.value}
        </text>
        {m.low
          ? (
            <text
              x={cx}
              y={cy + S * 0.08 + Math.max(28, S * 0.22) * 0.55}
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
        fill="var(--fg-muted)"
      >
        {m.legendAvg}
      </text>
      <text
        x={cx}
        y={S + 28}
        textAnchor="middle"
        fontSize={11}
        fill="var(--fg-muted)"
      >
        {m.legendLow}
      </text>
    </svg>
  );
}

export function ReadinessRing({
  readiness,
  avg,
  lowLine,
  checkins,
  prs,
  flat,
}: {
  readiness: number;
  avg: number | null;
  lowLine: number;
  checkins: number;
  prs?: number;
  flat?: boolean;
}) {
  const m = readinessRing(readiness, avg, lowLine, checkins, prs);
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
      flat={flat}
    >
      <div style={{ width: "100%", minWidth: MIN_S, height: 234 }}>
        <ParentSize debounceTime={10}>
          {({ width, height }) =>
            width > 0
              ? (
                <RingInner
                  width={width}
                  height={height}
                  readiness={readiness}
                  avg={avg}
                  lowLine={lowLine}
                  checkins={checkins}
                  prs={prs}
                />
              )
              : null}
        </ParentSize>
      </div>
    </ChartShell>
  );
}
