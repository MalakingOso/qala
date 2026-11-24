/* Fixed-size labels and 16px bars on a night panel. The 10-20 weekly sets band
 * (DECISIONS T2, fractional sets) is a teal-tinted lane, no outline, behind
 * the bars: a bar is teal once it reaches the band and dim before it, and
 * today's part is the ember "now" end. Each bar ends with its total in mono. */

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
  const height = muscles.length * 36 + 30;
  const max = Math.max(22, ...muscles.map((m) => m.earlier + m.today));
  return (
    <ChartShell
      title={title}
      surface="night"
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
            range: [left, Math.max(left + 1, width - 30)],
          });
          return (
            <svg width={width} height={height} role="presentation">
              <rect
                x={x(10)}
                y={4}
                width={x(20) - x(10)}
                height={height - 28}
                rx={8}
                fill="var(--wash-teal)"
                fillOpacity={.14}
              />
              <line
                x1={left}
                x2={left}
                y1={4}
                y2={height - 24}
                stroke="var(--chart-night-base)"
              />
              {[10, 20].map((v) => (
                <text
                  key={v}
                  x={x(v)}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize={10}
                >
                  {v}
                </text>
              ))}
              <text
                x={(x(10) + x(20)) / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize={10}
              >
                target
              </text>
              {muscles.map((m, i) => {
                const yy = 12 + i * 36;
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
                      className="nt-name"
                      x={left - 10}
                      y={yy + 12}
                      textAnchor="end"
                      fontSize={12}
                    >
                      {m.muscle}
                    </text>
                    <path
                      className={m.earlier + m.today < 10
                        ? "nt-bar low"
                        : "nt-bar"}
                      d={roundedBar(left, yy, end - left, 16)}
                    />
                    {m.today > 0 && (
                      <path
                        className="nt-bar today"
                        d={roundedBar(
                          split + (m.earlier > 0 ? 2 : 0),
                          yy,
                          Math.max(0, end - split - (m.earlier > 0 ? 2 : 0)),
                          16,
                        )}
                      />
                    )}
                    <text
                      className="nt-strong nt-value"
                      x={end + 6}
                      y={yy + 12}
                      fontSize={12}
                    >
                      {m.earlier + m.today}
                    </text>
                  </g>
                );
              })}
            </svg>
          );
        }}
      </Plot>
      <ChartLegend
        items={[
          { label: "Earlier this week", color: "var(--wash-teal)" },
          { label: "Today", color: "var(--wash-chart-ember)" },
        ]}
      />
    </ChartShell>
  );
}
