/* Readiness ring (DESIGN 6.4): an open ring, bordered, with a gap at the top
 * so 0 and 100 are two different places. The value arc is faded up to the
 * low line and solid above it, so the solid stretch is the headroom. A short
 * band outside the track marks the usual range (average plus and minus one
 * SD), with a tick on each end; hovering, focusing or tapping it shows a
 * "Usual Range" tooltip. Under the number, the margin to the low line in
 * points. Geometry math lives in logic/.
 *
 * Sized with Plot so the ring and its 46px number are drawn in real pixels
 * for whatever width the caller gives it. */

import { useId, useRef, useState } from "react";
import { Arc } from "@visx/shape";
import { Group } from "@visx/group";
import { readinessRing } from "../../logic/readinessRing.ts";
import { ChartShell } from "./ChartShell.tsx";
import { Plot } from "./Plot.tsx";

const HEIGHT = 210;
const MIN_S = 150;
const BAND_GAP = 8;
const TICK_HALF = 5;
const BORDER = 2;
/** Half the gap at the top of the ring, in radians (about 8 degrees). */
const GAP_HALF = 0.14;
const SWEEP = Math.PI * 2 - GAP_HALF * 2;
const TIP_W = 96;

/** Angle from 12 o'clock, clockwise, for a 0-1 fraction of the open ring. */
const angle = (frac: number) => GAP_HALF + frac * SWEEP;

function polar(
  cx: number,
  cy: number,
  r: number,
  frac: number,
): [number, number] {
  const a = -Math.PI / 2 + angle(frac);
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function marginText(margin: number): string {
  return margin >= 0 ? `${margin} above low` : `${-margin} below low`;
}

function RingInner({
  width,
  readiness,
  avg,
  lowLine,
  checkins,
  prs,
}: {
  width: number;
  readiness: number;
  avg: number | null;
  lowLine: number;
  checkins: number;
  prs?: number;
}) {
  const m = readinessRing(readiness, avg, lowLine, checkins, prs);
  const host = useRef<HTMLDivElement>(null);
  const clipId = useId();
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const S = Math.max(MIN_S, Math.min(width, HEIGHT));
  const TRACK = Math.max(11, S * 0.07);
  // Leave room outside the track for the usual-range band and its ticks.
  const R = S / 2 - TRACK / 2 - BAND_GAP - TICK_HALF - 4;
  const bandR = R + TRACK / 2 + BAND_GAP;
  const cx = width / 2;
  const cy = S / 2;
  // The value arc sits inside the track's border, flush with it.
  const inset = BORDER / 2;
  const innerR = R - TRACK / 2 + inset;
  const outerR = R + TRACK / 2 - inset;
  const capR = (outerR - innerR) / 2;
  const startAngle = angle(0) + inset / R;
  const valueAngle = Math.max(startAngle + 0.02, angle(m.valueFrac));
  const lowAngle = Math.min(angle(m.lowFrac), valueAngle);
  const marginColor = m.margin < 0
    ? "var(--danger)"
    : m.margin < 5
    ? "var(--accent)"
    : "var(--fg-muted)";
  const numSize = Math.max(34, S * 0.22);
  const hasUsual = m.usualLoFrac !== null && m.usualHiFrac !== null;

  const showTip = (e: React.PointerEvent) => {
    const box = host.current?.getBoundingClientRect();
    if (box) setTip({ x: e.clientX - box.left, y: e.clientY - box.top });
  };
  const showTipAtBand = () => {
    if (!hasUsual) return;
    const [x, y] = polar(
      cx,
      cy,
      bandR,
      (m.usualLoFrac! + m.usualHiFrac!) / 2,
    );
    setTip({ x, y });
  };
  // Sit to the left of the pointer, clear of the number in the middle. A
  // narrow card has no room there, so the tip goes above the pointer instead.
  const roomLeft = tip ? tip.x - TIP_W - 12 >= 4 : true;
  const tipLeft = tip
    ? Math.min(Math.max(4, tip.x - TIP_W - 12), width - TIP_W - 4)
    : 0;
  const tipTop = tip ? Math.max(0, tip.y - (roomLeft ? 20 : 64)) : 0;

  return (
    <div ref={host} className="ring-host" style={{ width, height: S }}>
      <svg
        width={width}
        height={S}
        viewBox={`0 0 ${width} ${S}`}
        role="presentation"
      >
        <Group top={cy} left={cx}>
          <Arc
            innerRadius={R - TRACK / 2}
            outerRadius={R + TRACK / 2}
            startAngle={angle(0)}
            endAngle={angle(1)}
            cornerRadius={TRACK / 2}
            fill="var(--bg-active)"
            stroke="var(--fg-secondary)"
            strokeWidth={BORDER}
            strokeLinejoin="round"
          />
          {m.low
            ? (
              <Arc
                innerRadius={innerR}
                outerRadius={outerR}
                startAngle={startAngle}
                endAngle={valueAngle}
                cornerRadius={capR}
                fill="var(--danger)"
              />
            )
            : (
              <>
                {/* flat segments clipped to one rounded shape, so only the
                    two ends of the value arc are round, not the low-line seam */}
                <clipPath id={clipId}>
                  <Arc
                    innerRadius={innerR}
                    outerRadius={outerR}
                    startAngle={startAngle}
                    endAngle={valueAngle}
                    cornerRadius={capR}
                  />
                </clipPath>
                <g clipPath={`url(#${clipId})`}>
                  <Arc
                    innerRadius={innerR}
                    outerRadius={outerR}
                    startAngle={startAngle}
                    endAngle={lowAngle}
                    fill="var(--progress-fill)"
                    fillOpacity={0.3}
                  />
                  <Arc
                    innerRadius={innerR}
                    outerRadius={outerR}
                    startAngle={lowAngle}
                    endAngle={valueAngle}
                    fill="var(--progress-fill)"
                  />
                </g>
              </>
            )}
        </Group>
        {hasUsual
          ? (
            <g
              tabIndex={0}
              role="img"
              aria-label={`Usual Range: ${m.legendUsual}`}
              className="ring-usual"
              onPointerEnter={showTip}
              onPointerMove={showTip}
              onPointerLeave={() => setTip(null)}
              onFocus={showTipAtBand}
              onBlur={() => setTip(null)}
            >
              <Group top={cy} left={cx}>
                {/* wide invisible stroke so the thin band is easy to hit */}
                <Arc
                  innerRadius={bandR - 11}
                  outerRadius={bandR + 11}
                  startAngle={angle(m.usualLoFrac!)}
                  endAngle={angle(m.usualHiFrac!)}
                  fill="transparent"
                />
                <Arc
                  innerRadius={bandR - 2.5}
                  outerRadius={bandR + 2.5}
                  startAngle={angle(m.usualLoFrac!)}
                  endAngle={angle(m.usualHiFrac!)}
                  fill="var(--fg-secondary)"
                />
              </Group>
              {[m.usualLoFrac!, m.usualHiFrac!].map((f) => {
                const [x0, y0] = polar(cx, cy, bandR - TICK_HALF, f);
                const [x1, y1] = polar(cx, cy, bandR + TICK_HALF, f);
                return (
                  <line
                    key={f}
                    x1={x0}
                    y1={y0}
                    x2={x1}
                    y2={y1}
                    stroke="var(--fg-secondary)"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                );
              })}
            </g>
          )
          : null}
        <text
          x={cx}
          y={cy + numSize * 0.2}
          textAnchor="middle"
          fontSize={numSize}
          fill="var(--fg)"
          className="figure"
        >
          {m.value}
        </text>
        <text
          x={cx}
          y={cy + numSize * 0.2 + 22}
          textAnchor="middle"
          fontSize={13}
          fill={marginColor}
        >
          {marginText(m.margin)}
        </text>
      </svg>
      {tip
        ? (
          <div
            className="ring-tip"
            role="tooltip"
            style={{ left: tipLeft, top: tipTop, width: TIP_W }}
          >
            <strong>Usual Range</strong>
            <span>{m.legendUsual}</span>
          </div>
        )
        : null}
    </div>
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
        ["usual range", m.legendUsual],
        ["low line", m.legendLow],
        ["margin", marginText(m.margin)],
      ]}
      label={`Readiness ${m.value} of 100, ${marginText(m.margin)}${
        m.low ? ", low" : ""
      }. ${m.legendAvg}. Usual range ${m.legendUsual}. ${m.legendLow}.`}
      flat={flat}
    >
      <Plot height={HEIGHT}>
        {(width) => (
          <RingInner
            width={width}
            readiness={readiness}
            avg={avg}
            lowLine={lowLine}
            checkins={checkins}
            prs={prs}
          />
        )}
      </Plot>
    </ChartShell>
  );
}
