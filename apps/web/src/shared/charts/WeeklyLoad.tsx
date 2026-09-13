/* This week's load: stacked columns per day, lifting under running, done
 * filled, planned outlined, today highlighted and named (DESIGN 6.3).
 *
 * Sized with ParentSize so bars, gridlines and axis text are drawn in real
 * pixels for whatever width the card gives it, instead of a fixed 560-unit
 * viewBox getting crushed down to a handful of px inside a mobile card. */

import { useMemo } from "react";
import type { MouseEvent, TouchEvent } from "react";
import { scaleBand, scaleLinear } from "@visx/scale";
import { AxisBottom } from "@visx/axis";
import { ParentSize } from "@visx/responsive";
import { localPoint } from "@visx/event";
import { useTooltip, TooltipWithBounds } from "@visx/tooltip";
import type { WeekLoadDay } from "../../store/types.ts";
import { ChartShell } from "./ChartShell.tsx";
import { CATEGORICAL } from "./tokens.ts";

const H = 200;
const PAD = { top: 16, right: 4, bottom: 22, left: 4 };
const MAX_BAR_W = 24;
const GAP = 2; // surface gap between touching segments (DESIGN 6.2)

/** A rect with only its top corners rounded (DESIGN 6.2's "4px rounded data
 * end and a square baseline"). */
function roundedTopPath(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0 || w <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${
    x + w
  },${y} ${x + w},${y + rr} V${y + h} Z`;
}

interface TipDatum {
  day: string;
  done: number;
  planned: number;
}

function ChartInner({
  width,
  days,
}: {
  width: number;
  days: WeekLoadDay[];
}) {
  const {
    tooltipData,
    tooltipLeft,
    tooltipTop,
    tooltipOpen,
    showTooltip,
    hideTooltip,
  } = useTooltip<TipDatum>();

  const { x, y } = useMemo(() => {
    const max = Math.max(
      1,
      ...days.map((d) => d.liftDone + d.runDone + d.liftPlanned + d.runPlanned),
    );
    return {
      x: scaleBand<string>({
        domain: days.map((_, i) => String(i)),
        range: [PAD.left, width - PAD.right],
        padding: 0.3,
      }),
      y: scaleLinear<number>({
        domain: [0, max],
        range: [H - PAD.bottom, PAD.top],
        nice: true,
      }),
    };
  }, [days, width]);

  const gridTicks = y.ticks(3);

  return (
    <div style={{ position: "relative" }}>
      <svg width={width} height={H} role="presentation">
        {gridTicks.map((t) => (
          <line
            key={t}
            x1={PAD.left}
            x2={width - PAD.right}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--grid)"
            strokeWidth={1}
          />
        ))}
        {days.map((d, i) => {
          const bandX = x(String(i)) ?? 0;
          const bandW = x.bandwidth();
          const bw = Math.min(MAX_BAR_W, bandW);
          const bx = bandX + (bandW - bw) / 2;

          const doneTotal = d.liftDone + d.runDone;
          const grandTotal = doneTotal + d.liftPlanned + d.runPlanned;
          const hasRunDone = d.runDone > 0;
          const hasRunPlanned = d.runPlanned > 0;

          // done stack: lifting under running, 2px gap between them
          const liftDoneTop = y(d.liftDone);
          const runDoneTop = y(d.liftDone + d.runDone);
          const liftDoneBottom = hasRunDone ? liftDoneTop + GAP : y(0);
          // planned stack continues above the done total, 2px gap between its own segments
          const liftPlannedTop = y(doneTotal + d.liftPlanned);
          const plannedTotalTop = y(grandTotal);
          const liftPlannedBottom = hasRunPlanned
            ? liftPlannedTop + GAP
            : y(doneTotal);

          // topmost non-zero segment gets the rounded data end
          const topKey = d.runPlanned > 0
            ? "runPlanned"
            : d.liftPlanned > 0
            ? "liftPlanned"
            : d.runDone > 0
            ? "runDone"
            : "liftDone";

          const tip: TipDatum = {
            day: d.today && d.label ? `${d.day} (${d.label})` : d.day,
            done: doneTotal,
            planned: d.liftPlanned + d.runPlanned,
          };
          const onPoint = (
            e: TouchEvent<SVGRectElement> | MouseEvent<SVGRectElement>,
          ) => {
            const p = localPoint(e);
            showTooltip({
              tooltipData: tip,
              tooltipLeft: p?.x,
              tooltipTop: p?.y,
            });
          };
          const onFocusPoint = () => {
            showTooltip({
              tooltipData: tip,
              tooltipLeft: bandX + bandW / 2,
              tooltipTop: PAD.top,
            });
          };

          return (
            <g key={i}>
              {d.today
                ? (
                  <rect
                    x={bandX - 4}
                    y={y(grandTotal) - 6}
                    width={bandW + 8}
                    height={y(0) - y(grandTotal) + 6}
                    fill="var(--accent-subtle)"
                    stroke="var(--accent)"
                    strokeWidth={2}
                  />
                )
                : null}
              {/* done: filled, lifting under running */}
              <path
                d={roundedTopPath(
                  bx,
                  liftDoneTop,
                  bw,
                  y(0) - liftDoneTop,
                  topKey === "liftDone" ? 4 : 0,
                )}
                fill={CATEGORICAL[0]}
              />
              {hasRunDone
                ? (
                  <path
                    d={roundedTopPath(
                      bx,
                      runDoneTop,
                      bw,
                      liftDoneBottom - runDoneTop,
                      topKey === "runDone" ? 4 : 0,
                    )}
                    fill={CATEGORICAL[1]}
                  />
                )
                : null}
              {/* planned: 2px outline in the same series color, stacked above done */}
              {d.liftPlanned > 0
                ? (
                  <path
                    d={roundedTopPath(
                      bx + 1,
                      liftPlannedTop + 1,
                      bw - 2,
                      y(doneTotal) - liftPlannedTop - 2,
                      topKey === "liftPlanned" ? 4 : 0,
                    )}
                    fill="none"
                    stroke={CATEGORICAL[0]}
                    strokeWidth={2}
                  />
                )
                : null}
              {hasRunPlanned
                ? (
                  <path
                    d={roundedTopPath(
                      bx + 1,
                      plannedTotalTop + 1,
                      bw - 2,
                      liftPlannedBottom - plannedTotalTop - 2,
                      topKey === "runPlanned" ? 4 : 0,
                    )}
                    fill="none"
                    stroke={CATEGORICAL[1]}
                    strokeWidth={2}
                  />
                )
                : null}
              {d.today
                ? (() => {
                  // Anchor the label so it never overflows the chart's
                  // left/right edge for a first- or last-day "today".
                  const anchor = i === 0
                    ? "start"
                    : i === days.length - 1
                    ? "end"
                    : "middle";
                  const tx = anchor === "start"
                    ? bandX
                    : anchor === "end"
                    ? bandX + bandW
                    : bandX + bandW / 2;
                  return (
                    <text
                      x={tx}
                      y={y(grandTotal) - 12}
                      fontSize={10}
                      textAnchor={anchor}
                      fill="var(--accent)"
                    >
                      today{d.label ? ` · ${d.label}` : ""}
                    </text>
                  );
                })()
                : null}
              {/* tap/hover hit area, full band width x plotting height */}
              <rect
                x={bandX}
                y={PAD.top}
                width={bandW}
                height={H - PAD.top - PAD.bottom}
                fill="transparent"
                tabIndex={0}
                role="img"
                aria-label={`${tip.day}: done ${tip.done}, planned ${tip.planned}`}
                onMouseMove={onPoint}
                onMouseLeave={hideTooltip}
                onTouchStart={onPoint}
                onTouchEnd={hideTooltip}
                onFocus={onFocusPoint}
                onBlur={hideTooltip}
              >
                <title>{`${tip.day}: done ${tip.done}, planned ${tip.planned}`}</title>
              </rect>
            </g>
          );
        })}
        <AxisBottom
          top={H - PAD.bottom}
          scale={x}
          tickFormat={(i) => days[Number(i)]?.day ?? ""}
          tickLabelProps={{
            fontSize: 11,
            fill: "var(--fg-muted)",
            textAnchor: "middle",
          }}
          hideAxisLine
          hideTicks
        />
      </svg>
      {tooltipOpen && tooltipData
        ? (
          <TooltipWithBounds left={tooltipLeft} top={tooltipTop}>
            <strong>{tooltipData.day}</strong>: done {tooltipData.done}, planned
            {" "}
            {tooltipData.planned}
          </TooltipWithBounds>
        )
        : null}
    </div>
  );
}

export function WeeklyLoad(
  { days, flat }: { days: WeekLoadDay[]; flat?: boolean },
) {
  const rows = days.map((d) => [
    d.today && d.label ? `${d.day} (${d.label})` : d.day,
    String(d.liftDone + d.runDone),
    String(d.liftPlanned + d.runPlanned),
  ]);
  const label = `Weekly load. Today ${days.find((d) => d.today)?.label ?? ""}.`;

  return (
    <ChartShell
      title="This week's load"
      head={["Day", "Done", "Planned"]}
      rows={rows}
      label={label}
      flat={flat}
    >
      <div style={{ width: "100%", height: H }}>
        <ParentSize debounceTime={10}>
          {({ width }) => (width > 0 ? <ChartInner width={width} days={days} /> : null)}
        </ParentSize>
      </div>
      <div
        style={{
          display: "flex",
          gap: 16,
          marginTop: 6,
          fontSize: 11,
          color: "var(--fg)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: CATEGORICAL[0],
            }}
          />
          lifting
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: CATEGORICAL[1],
            }}
          />
          running
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              border: "2px solid var(--fg-muted)",
              boxSizing: "border-box",
            }}
          />
          planned
        </span>
      </div>
    </ChartShell>
  );
}
