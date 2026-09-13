/* This week's load: stacked columns per day, lifting under running, done
 * filled, planned outlined, today highlighted and named (DESIGN 6.3). */

import { useMemo } from "react";
import { Bar } from "@visx/shape";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Group } from "@visx/group";
import { AxisBottom } from "@visx/axis";
import type { WeekLoadDay } from "../../store/types.ts";
import { ChartShell, Hit } from "./ChartShell.tsx";
import { CATEGORICAL } from "./tokens.ts";

const W = 560;
const H = 220;
const PAD = { top: 14, right: 8, bottom: 28, left: 8 };

export function WeeklyLoad({ days }: { days: WeekLoadDay[] }) {
  const { x, y } = useMemo(() => {
    const max = Math.max(
      1,
      ...days.map((d) => d.liftDone + d.runDone + d.liftPlanned + d.runPlanned),
    );
    return {
      x: scaleBand<string>({
        domain: days.map((_, i) => String(i)),
        range: [PAD.left, W - PAD.right],
        padding: 0.3,
      }),
      y: scaleLinear<number>({
        domain: [0, max],
        range: [H - PAD.bottom, PAD.top],
      }),
    };
  }, [days]);

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
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="presentation">
        {days.map((d, i) => {
          const bx = x(String(i)) ?? 0;
          const bw = x.bandwidth();
          const liftDoneH = y(0) - y(d.liftDone);
          const runDoneH = y(d.liftDone) - y(d.liftDone + d.runDone);
          const liftPlanH = y(0) - y(d.liftPlanned);
          const runPlanH = y(d.liftPlanned) - y(d.liftPlanned + d.runPlanned);
          return (
            <Group key={i}>
              {d.today
                ? (
                  <rect
                    x={bx - 6}
                    y={PAD.top - 6}
                    width={bw + 12}
                    height={H - PAD.top - PAD.bottom + 12}
                    fill="var(--accent-subtle)"
                    stroke="var(--accent)"
                    strokeWidth={2}
                  />
                )
                : null}
              {/* done: filled, lifting under running */}
              <Bar
                x={bx}
                y={y(0) - liftDoneH}
                width={bw}
                height={Math.max(0, liftDoneH)}
                fill={CATEGORICAL[0]}
                rx={0}
              />
              <Bar
                x={bx}
                y={y(0) - liftDoneH - runDoneH}
                width={bw}
                height={Math.max(0, runDoneH)}
                fill={CATEGORICAL[1]}
                rx={3}
              />
              {/* planned: 2px outline in the same series color */}
              <rect
                x={bx}
                y={y(d.liftDone + d.runDone + d.liftPlanned + d.runPlanned)}
                width={bw}
                height={Math.max(0, liftPlanH + runPlanH)}
                fill="none"
                stroke={CATEGORICAL[0]}
                strokeWidth={2}
                strokeDasharray={undefined}
              />
              <Hit
                x={bx + bw / 2}
                y={H - PAD.bottom - 4}
                label={`${d.day}: done ${d.liftDone + d.runDone}, planned ${
                  d.liftPlanned + d.runPlanned
                }`}
              >
                <circle r={0} fill="none" />
              </Hit>
              {d.today
                ? (
                  <text
                    x={bx + bw / 2}
                    y={PAD.top - 8}
                    fontSize={10}
                    textAnchor="middle"
                    fill="var(--accent)"
                  >
                    today{d.label ? ` · ${d.label}` : ""}
                  </text>
                )
                : null}
            </Group>
          );
        })}
        <AxisBottom
          top={H - PAD.bottom}
          scale={x}
          tickFormat={(i) => days[Number(i)]?.day ?? ""}
          tickLabelProps={{
            fontSize: 11,
            fill: "var(--fg)",
            textAnchor: "middle",
          }}
          hideAxisLine
          hideTicks
        />
        <g fontSize={11} fill="var(--fg)">
          <rect
            x={PAD.left}
            y={2}
            width={10}
            height={10}
            fill={CATEGORICAL[0]}
          />
          <text x={PAD.left + 14} y={11}>lifting</text>
          <rect
            x={PAD.left + 70}
            y={2}
            width={10}
            height={10}
            fill={CATEGORICAL[1]}
          />
          <text x={PAD.left + 84} y={11}>running</text>
        </g>
      </svg>
    </ChartShell>
  );
}
