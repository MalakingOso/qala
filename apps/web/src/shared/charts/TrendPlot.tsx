/* Monotone interpolation passes through each observation without inventing
 * peaks between samples. Actual values remain visible at the markers. */

import { useState } from "react";
import { LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { scaleLinear, scalePoint } from "@visx/scale";
import { ChartLegend, Plot } from "./Plot.tsx";

export interface TrendPoint {
  label: string;
  value: number;
  tested?: boolean;
}

export function TrendPlot(
  {
    points,
    domain,
    references = [],
    color = "var(--viz-2)",
    unit = "",
    height = 224,
    compact = false,
  }: {
    points: TrendPoint[];
    domain?: [number, number];
    references?: { label: string; value: number; color: string }[];
    color?: string;
    unit?: string;
    height?: number;
    compact?: boolean;
  },
) {
  const [active, setActive] = useState<number | null>(null);
  if (points.length === 0) {
    return <p className="kbd-hint">Log a session to start this trend.</p>;
  }
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(2, (hi - lo) * .25);
  const bounds: [number, number] = domain ?? [Math.max(0, lo - pad), hi + pad];

  return (
    <>
      <Plot height={height}>
        {(width) => {
          const left = compact ? 8 : 38;
          const right = 16;
          const bottom = compact ? 12 : 32;
          const x = scalePoint<number>({
            domain: points.map((_, i) => i),
            range: [left + 8, Math.max(left + 9, width - right)],
            padding: .25,
          });
          const y = scaleLinear<number>({
            domain: bounds,
            range: [height - bottom, 24],
            nice: !domain,
          });
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
                {!compact && y.ticks(4).map((tick) => (
                  <g key={tick}>
                    <line
                      x1={left}
                      x2={width - 4}
                      y1={y(tick)}
                      y2={y(tick)}
                      stroke="var(--grid)"
                    />
                    <text
                      x={left - 10}
                      y={y(tick) + 4}
                      textAnchor="end"
                      fontSize={11}
                      fill="var(--fg-muted)"
                    >
                      {tick}
                    </text>
                  </g>
                ))}
                {references.map((r) => (
                  <line
                    key={r.label}
                    x1={left}
                    x2={width - 4}
                    y1={y(r.value)}
                    y2={y(r.value)}
                    stroke={r.color}
                    strokeWidth={1}
                    opacity={.6}
                  />
                ))}
                <LinePath
                  data={points}
                  x={(_, i) => x(i) ?? left}
                  y={(p) => y(p.value)}
                  curve={curveMonotoneX}
                  stroke={color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {points.map((point, i) => {
                  const px = x(i) ?? left;
                  const py = y(point.value);
                  const last = i === points.length - 1;
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
                              fill={color}
                              stroke="var(--bg-surface)"
                              strokeWidth={2}
                            />
                          )
                          : (
                            <circle
                              cx={px}
                              cy={py}
                              r={last ? 5 : 4}
                              fill={last
                                ? "var(--accent)"
                                : "var(--bg-surface)"}
                              stroke={last ? "var(--accent)" : color}
                              strokeWidth={2}
                            />
                          )}
                        {active === i && (
                          <circle
                            cx={px}
                            cy={py}
                            r={9}
                            fill="none"
                            stroke={color}
                            opacity={.3}
                            strokeWidth={2}
                          />
                        )}
                      </g>
                      {!compact &&
                        (i % labelStep === 0 &&
                            i < points.length - Math.ceil(labelStep / 2) ||
                          last) &&
                        (
                          <text
                            x={px}
                            y={height - 6}
                            textAnchor={last
                              ? "end"
                              : i === 0
                              ? "start"
                              : "middle"}
                            fontSize={10}
                            fill="var(--fg-muted)"
                          >
                            {point.label}
                          </text>
                        )}
                    </g>
                  );
                })}
              </svg>
              {selected && active !== null && (
                <div
                  className="plot-tooltip"
                  style={{
                    left: Math.max(
                      0,
                      Math.min(
                        width - Math.min(200, width),
                        (x(active) ?? 0) - 100,
                      ),
                    ),
                    top: Math.max(0, y(selected.value) - 60),
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
      {references.length > 0 && (
        <ChartLegend
          items={references.map((r) => ({
            label: `${r.label} ${r.value}`,
            color: r.color,
            line: true,
          }))}
        />
      )}
    </>
  );
}
