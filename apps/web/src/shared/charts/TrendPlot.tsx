/* Night line plot (Board 3, QalaCharts.kt LineChart): one baseline instead of
 * gridlines, a white monotone line over a teal fade, teal dots, and the latest
 * point as an ember dot on a drop line with its value ("now 283") above it.
 * Monotone interpolation passes through each observation without inventing
 * peaks between samples. It always sits in a night panel, so every colour is
 * a --wash-* or --chart-night-* token (text colours are classes in
 * desktop.css), never inherited from the page. */

import { useId, useState } from "react";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { scaleLinear, scalePoint } from "@visx/scale";
import { Plot } from "./Plot.tsx";

export interface TrendPoint {
  label: string;
  value: number;
  tested?: boolean;
}

type Pt = [number, number];
interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** The monotone curve (d3's monotoneX) as a polyline, so a label can keep off it. */
function curveSamples(pts: Pt[]): Pt[] {
  const n = pts.length;
  if (n < 2) return pts;
  const h = (i: number) => pts[i + 1][0] - pts[i][0];
  const s = (i: number) => (pts[i + 1][1] - pts[i][1]) / h(i);
  const sign = (v: number) => (v < 0 ? -1 : 1);
  const m: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const p = (s(i - 1) * h(i) + s(i) * h(i - 1)) / (h(i - 1) + h(i));
    m[i] = (sign(s(i - 1)) + sign(s(i))) *
        Math.min(Math.abs(s(i - 1)), Math.abs(s(i)), 0.5 * Math.abs(p)) || 0;
  }
  m[0] = n > 2 ? (3 * s(0) - m[1]) / 2 : s(0);
  m[n - 1] = n > 2 ? (3 * s(n - 2) - m[n - 2]) / 2 : s(0);
  const out: Pt[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < 12; k++) {
      const t = k / 12;
      const a = 2 * t ** 3 - 3 * t ** 2 + 1;
      const b = t ** 3 - 2 * t ** 2 + t;
      const c = -2 * t ** 3 + 3 * t ** 2;
      const d = t ** 3 - t ** 2;
      out.push([
        pts[i][0] + h(i) * t,
        a * pts[i][1] + b * h(i) * m[i] + c * pts[i + 1][1] +
        d * h(i) * m[i + 1],
      ]);
    }
  }
  out.push(pts[n - 1]);
  return out;
}

const inside = (b: Box, [x, y]: Pt, pad: number) =>
  x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad;

/** Where a reference line's label goes: from the right end, above the line and
 * then below it, sliding left to the first spot clear of the curve, the dots,
 * the "now" label and the drop line (the line crosses the data, so the end is
 * not always free). */
function referenceSpot(
  ry: number,
  chars: number,
  left: number,
  right: number,
  curve: Pt[],
  dots: Pt[],
  keepOff: Box[],
): Pt {
  const w = chars * 5.8;
  for (let xr = right; xr - w >= left + 4; xr -= 6) {
    for (const base of [ry - 5, ry + 13]) {
      const box = { x0: xr - w, x1: xr, y0: base - 9, y1: base + 2 };
      const hitsBox = keepOff.some((k) =>
        box.x1 > k.x0 - 8 && box.x0 < k.x1 + 8 && box.y1 > k.y0 - 4 &&
        box.y0 < k.y1 + 4
      );
      if (
        !hitsBox && !curve.some((p) => inside(box, p, 4)) &&
        !dots.some((p) => inside(box, p, 8))
      ) return [xr, base];
    }
  }
  return [right, ry - 5];
}

export function TrendPlot(
  {
    points,
    domain,
    references = [],
    unit = "",
    axisLabel,
    axisHint,
    height = 224,
  }: {
    points: TrendPoint[];
    domain?: [number, number];
    references?: { label: string; value: number }[];
    unit?: string;
    /** Short y-axis label drawn above the tick numbers. */
    axisLabel?: string;
    /** Plain-language meaning of the axis, shown on hover and focus. */
    axisHint?: string;
    height?: number;
  },
) {
  const [active, setActive] = useState<number | null>(null);
  const fade = `nt-fade-${useId().replace(/[^\w-]/g, "")}`;
  if (points.length === 0) {
    return <p className="kbd-hint">Log a session to start this trend.</p>;
  }
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(2, (hi - lo) * .25);
  const bounds: [number, number] = domain ?? [Math.max(0, lo - pad), hi + pad];
  const lastI = points.length - 1;

  return (
    <Plot height={height}>
      {(width) => {
        const left = axisLabel ? 58 : 38;
        const right = width - 4;
        const top = 34;
        const bottom = 32;
        const base = height - bottom;
        const x = scalePoint<number>({
          domain: points.map((_, i) => i),
          range: [left + 8, Math.max(left + 9, width - 16)],
          padding: .25,
        });
        const y = scaleLinear<number>({
          domain: bounds,
          range: [base, top],
          nice: !domain,
        });
        const dots: Pt[] = points.map((p, i) => [x(i) ?? left, y(p.value)]);
        const [lx, ly] = dots[lastI];
        const nowText = `now ${Math.round(points[lastI].value * 10) / 10}`;
        const nowW = nowText.length * 6.3;
        const nowX = Math.min(
          width - 2 - nowW / 2,
          Math.max(left + nowW / 2, lx),
        );
        const keepOff = [
          {
            x0: nowX - nowW / 2,
            x1: nowX + nowW / 2,
            y0: ly - 26,
            y1: ly - 12,
          },
          { x0: lx, x1: lx, y0: ly, y1: base },
        ];
        const curve = references.length ? curveSamples(dots) : [];
        const labelStep = Math.max(
          1,
          Math.ceil(
            points.length / Math.max(2, Math.floor((width - left) / 72)),
          ),
        );
        const selected = active === null ? null : points[active];
        return (
          <>
            <svg
              width={width}
              height={height}
              role="presentation"
              onPointerLeave={() => setActive(null)}
            >
              <defs>
                <linearGradient id={fade} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0"
                    stopColor="var(--wash-teal)"
                    stopOpacity={.36}
                  />
                  <stop
                    offset="1"
                    stopColor="var(--wash-teal)"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <line
                x1={left}
                x2={right}
                y1={base}
                y2={base}
                stroke="var(--chart-night-base)"
              />
              {y.ticks(4).map((tick) => (
                <g key={tick}>
                  <line
                    x1={left - 6}
                    x2={left}
                    y1={y(tick)}
                    y2={y(tick)}
                    stroke="var(--chart-night-grid)"
                  />
                  <text
                    x={left - 10}
                    y={y(tick) + 4}
                    textAnchor="end"
                    fontSize={10}
                  >
                    {tick}
                  </text>
                </g>
              ))}
              {axisLabel && (
                <g
                  role="img"
                  aria-label={axisHint ?? axisLabel}
                  tabIndex={axisHint ? 0 : undefined}
                  style={{ cursor: axisHint ? "help" : undefined }}
                  transform={`translate(14 ${(top + base) / 2}) rotate(-90)`}
                >
                  {axisHint && <title>{axisHint}</title>}
                  <rect
                    x={-22}
                    y={-14}
                    width={44}
                    height={26}
                    fill="transparent"
                  />
                  <text
                    className="nt-strong"
                    textAnchor="middle"
                    fontSize={17}
                    fontWeight={700}
                    textDecoration={axisHint ? "underline dotted" : undefined}
                  >
                    {axisLabel}
                  </text>
                </g>
              )}
              {references.map((r) => {
                const ry = y(r.value);
                const text = `${r.label} ${r.value}`;
                const [rx, rty] = referenceSpot(
                  ry,
                  text.length,
                  left,
                  right,
                  curve,
                  dots,
                  keepOff,
                );
                return (
                  <g key={r.label}>
                    <line
                      x1={left}
                      x2={right}
                      y1={ry}
                      y2={ry}
                      stroke="var(--chart-night-ref)"
                      strokeDasharray="4 4"
                    />
                    <text x={rx} y={rty} textAnchor="end" fontSize={9.5}>
                      {text}
                    </text>
                  </g>
                );
              })}
              <AreaClosed
                data={points}
                x={(_, i) => dots[i][0]}
                y={(p) => y(p.value)}
                yScale={y}
                curve={curveMonotoneX}
                fill={`url(#${fade})`}
              />
              <LinePath
                data={points}
                x={(_, i) => dots[i][0]}
                y={(p) => y(p.value)}
                curve={curveMonotoneX}
                stroke="var(--wash-text)"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <line
                x1={lx}
                x2={lx}
                y1={ly - 12}
                y2={base}
                stroke="var(--wash-text)"
                strokeOpacity={.45}
              />
              {points.map((point, i) => {
                const [px, py] = dots[i];
                const last = i === lastI;
                return (
                  <g key={i}>
                    <g
                      className="plot-point"
                      role="img"
                      tabIndex={0}
                      aria-label={`${point.label}: ${point.value}${unit}${
                        point.tested ? ", tested" : ""
                      }`}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive(null)}
                      onPointerEnter={() => setActive(i)}
                      onPointerDown={() => setActive(i)}
                    >
                      <circle cx={px} cy={py} r={14} fill="transparent" />
                      {point.tested
                        ? (
                          <rect
                            x={px - 5}
                            y={py - 5}
                            width={10}
                            height={10}
                            transform={`rotate(45 ${px} ${py})`}
                            fill={last
                              ? "var(--wash-chart-ember)"
                              : "var(--wash-text)"}
                            stroke={last
                              ? "var(--wash-text)"
                              : "var(--wash-teal)"}
                            strokeWidth={2}
                          />
                        )
                        : last
                        ? (
                          <circle
                            cx={px}
                            cy={py}
                            r={6.5}
                            fill="var(--wash-chart-ember)"
                            stroke="var(--wash-text)"
                            strokeWidth={2}
                          />
                        )
                        : (
                          <circle
                            cx={px}
                            cy={py}
                            r={4}
                            fill="var(--wash-teal)"
                          />
                        )}
                      {active === i && (
                        <circle
                          cx={px}
                          cy={py}
                          r={10}
                          fill="none"
                          stroke="var(--wash-text)"
                          strokeOpacity={.4}
                          strokeWidth={2}
                        />
                      )}
                    </g>
                    {(i % labelStep === 0 &&
                        i < points.length - Math.ceil(labelStep / 2) ||
                      last) &&
                      (
                        <text
                          className={last ? "nt-strong" : undefined}
                          x={px}
                          y={height - 8}
                          textAnchor={last
                            ? "end"
                            : i === 0
                            ? "start"
                            : "middle"}
                          fontSize={10}
                        >
                          {point.label}
                        </text>
                      )}
                  </g>
                );
              })}
              <text
                className="nt-strong"
                x={nowX}
                y={ly - 15}
                textAnchor="middle"
                fontSize={10.5}
                fontWeight={500}
              >
                {nowText}
              </text>
            </svg>
            {selected && active !== null && (
              <div
                className="plot-tooltip"
                style={{
                  left: Math.max(
                    0,
                    Math.min(
                      width - Math.min(200, width),
                      dots[active][0] - 100,
                    ),
                  ),
                  top: Math.max(0, dots[active][1] - 60),
                  maxWidth: Math.min(200, width),
                }}
              >
                <strong>{selected.label}</strong>
                <br />
                {selected.value}
                {unit}
                {selected.tested ? " · tested" : ""}
              </div>
            )}
          </>
        );
      }}
    </Plot>
  );
}
