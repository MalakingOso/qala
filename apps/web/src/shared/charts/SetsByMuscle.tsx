/* Fixed-size labels and 18px bars, with 10/20-set guides above the plot. */

import { scaleLinear } from "@visx/scale";
import { ChartShell } from "./ChartShell.tsx";
import { ChartLegend, Plot, roundedBar } from "./Plot.tsx";

export function SetsByMuscle(
  { title = "Sets by muscle", muscles, onSelectMuscle }: {
    title?: string;
    muscles: { muscle: string; earlier: number; today: number }[];
    onSelectMuscle?: (muscle: string) => void;
  },
) {
  const height = muscles.length * 38 + 28;
  const max = Math.max(22, ...muscles.map((m) => m.earlier + m.today));
  return (
    <ChartShell
      title={title}
      head={["Muscle", "Earlier", "Today"]}
      rows={muscles.map((m) => [m.muscle, String(m.earlier), String(m.today)])}
      label={`${title}: ${
        muscles.map((m) => `${m.muscle} ${m.earlier + m.today}`).join(", ")
      }.`}
    >
      <Plot height={height}>
        {(width) => {
          const left = 88;
          const x = scaleLinear<number>({
            domain: [0, max],
            range: [left, Math.max(left + 1, width - 12)],
          });
          return (
            <svg width={width} height={height} role="presentation">
              {[10, 20].map((v) => (
                <g key={v}>
                  <line
                    x1={x(v)}
                    x2={x(v)}
                    y1={24}
                    y2={height}
                    stroke="var(--grid)"
                  />
                  <text
                    x={x(v)}
                    y={12}
                    textAnchor="middle"
                    fontSize={10}
                    fill="var(--fg-muted)"
                  >
                    {v}
                  </text>
                </g>
              ))}
              {muscles.map((m, i) => {
                const yy = 28 + i * 38;
                const end = x(m.earlier + m.today);
                const split = x(m.earlier);
                return (
                  <g
                    key={m.muscle}
                    className="bar-row"
                    role={onSelectMuscle ? "button" : "img"}
                    tabIndex={0}
                    aria-label={`${m.muscle}: ${m.earlier} earlier, ${m.today} today${
                      onSelectMuscle ? ". Open muscle details" : ""
                    }`}
                    onClick={() => onSelectMuscle?.(m.muscle)}
                    onKeyDown={(e) => {
                      if (
                        onSelectMuscle && (e.key === "Enter" || e.key === " ")
                      ) {
                        e.preventDefault();
                        onSelectMuscle(m.muscle);
                      }
                    }}
                    style={{ cursor: onSelectMuscle ? "pointer" : undefined }}
                  >
                    <title>
                      {`${m.muscle}: ${m.earlier} earlier + ${m.today} today`}
                    </title>
                    <rect
                      x={0}
                      y={yy - 8}
                      width={width}
                      height={34}
                      fill="transparent"
                    />
                    <text
                      x={left - 10}
                      y={yy + 13}
                      textAnchor="end"
                      fontSize={11}
                      fill="var(--fg-secondary)"
                    >
                      {m.muscle}
                    </text>
                    <path
                      d={roundedBar(left, yy, end - left, 18)}
                      fill="var(--mark-gray)"
                    />
                    {m.today > 0 && (
                      <path
                        d={roundedBar(
                          split + (m.earlier > 0 ? 2 : 0),
                          yy,
                          Math.max(0, end - split - (m.earlier > 0 ? 2 : 0)),
                          18,
                        )}
                        fill="var(--accent)"
                      />
                    )}
                  </g>
                );
              })}
            </svg>
          );
        }}
      </Plot>
      <ChartLegend
        items={[{ label: "Earlier this week", color: "var(--mark-gray)" }, {
          label: "Today",
          color: "var(--accent)",
        }]}
      />
    </ChartShell>
  );
}
