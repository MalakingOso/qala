/* Sets by muscle: horizontal bars, earlier this week in gray with today in
 * ember, hairlines at 10 and 20 (the owner's band). */

import { useMemo } from "react";
import { Bar } from "@visx/shape";
import { scaleBand, scaleLinear } from "@visx/scale";
import { ChartShell, Hit } from "./ChartShell.tsx";

const W = 560;
const ROW_H = 34;
const PAD = { top: 8, right: 12, bottom: 8, left: 96 };

export function SetsByMuscle({
  title = "Sets by muscle",
  muscles,
  onSelectMuscle,
}: {
  title?: string;
  muscles: { muscle: string; earlier: number; today: number }[];
  /** When given, each row becomes a button into that muscle's detail. */
  onSelectMuscle?: (muscle: string) => void;
}) {
  const H = muscles.length * ROW_H + PAD.top + PAD.bottom;
  const { x, y } = useMemo(() => {
    const max = Math.max(22, ...muscles.map((m) => m.earlier + m.today));
    return {
      x: scaleLinear<number>({
        domain: [0, max],
        range: [PAD.left, W - PAD.right],
      }),
      y: scaleBand<string>({
        domain: muscles.map((m) => m.muscle),
        range: [PAD.top, H - PAD.bottom],
        padding: 0.35,
      }),
    };
  }, [muscles, H]);
  const rows = muscles.map((
    m,
  ) => [m.muscle, String(m.earlier), String(m.today)]);
  return (
    <ChartShell
      title={title}
      head={["Muscle", "Earlier", "Today"]}
      rows={rows}
      label={`${title}: ${
        muscles.map((m) => `${m.muscle} ${m.earlier + m.today}`).join(", ")
      }.`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="presentation">
        {[10, 20].map((v) => (
          <line
            key={v}
            x1={x(v)}
            x2={x(v)}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke="var(--border-strong)"
            strokeWidth={1}
          />
        ))}
        {muscles.map((m) => {
          const yy = y(m.muscle) ?? 0;
          const bh = y.bandwidth();
          const e1 = x(m.earlier);
          const t1 = x(m.earlier + m.today);
          return (
            <g
              key={m.muscle}
              role={onSelectMuscle ? "button" : undefined}
              tabIndex={onSelectMuscle ? 0 : undefined}
              style={onSelectMuscle ? { cursor: "pointer" } : undefined}
              onClick={onSelectMuscle
                ? () => onSelectMuscle(m.muscle)
                : undefined}
              onKeyDown={onSelectMuscle
                ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectMuscle(m.muscle);
                  }
                }
                : undefined}
            >
              <text
                x={PAD.left - 8}
                y={yy + bh / 2 + 4}
                fontSize={11}
                textAnchor="end"
                fill={onSelectMuscle ? "var(--accent)" : "var(--fg)"}
                textDecoration={onSelectMuscle ? "underline" : undefined}
              >
                {m.muscle}
              </text>
              <Bar
                x={PAD.left}
                y={yy}
                width={Math.max(0, e1 - PAD.left)}
                height={bh}
                fill="var(--mark-gray)"
                rx={0}
              />
              <Bar
                x={e1}
                y={yy}
                width={Math.max(0, t1 - e1)}
                height={bh}
                fill="var(--accent)"
                rx={0}
              />
              <Hit
                x={t1 + 14}
                y={yy + bh / 2}
                label={`${m.muscle}: ${m.earlier} earlier, ${m.today} today`}
              >
                <circle r={0} fill="none" />
              </Hit>
            </g>
          );
        })}
      </svg>
    </ChartShell>
  );
}
