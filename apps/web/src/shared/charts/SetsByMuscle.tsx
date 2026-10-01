/* Fixed-size labels and 16px bars. The 10-20 weekly sets band (DECISIONS
 * T2, fractional sets) is a green-tinted lane, no outline, behind the bars, so a bar
 * reads as under, in, or over the target at a glance; each bar ends with
 * its total. */

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
                fill="color-mix(in srgb, var(--progress-fill) 12%, transparent)"
              />
              {[10, 20].map((v) => (
                <text
                  key={v}
                  x={x(v)}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--fg-muted)"
                >
                  {v}
                </text>
              ))}
              <text
                x={(x(10) + x(20)) / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize={10}
                fill="var(--fg-muted)"
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
                      x={left - 10}
                      y={yy + 12}
                      textAnchor="end"
                      fontSize={12}
                      fill="var(--fg-secondary)"
                    >
                      {m.muscle}
                    </text>
                    <path
                      d={roundedBar(left, yy, end - left, 16)}
                      fill="color-mix(in srgb, var(--accent) 35%, transparent)"
                    />
                    {m.today > 0 && (
                      <path
                        d={roundedBar(
                          split + (m.earlier > 0 ? 2 : 0),
                          yy,
                          Math.max(0, end - split - (m.earlier > 0 ? 2 : 0)),
                          16,
                        )}
                        fill="var(--accent)"
                      />
                    )}
                    <text
                      x={end + 6}
                      y={yy + 12}
                      fontSize={12}
                      fontWeight={600}
                      fill="var(--fg)"
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
        items={[{ label: "Earlier this week", color: "color-mix(in srgb, var(--accent) 35%, transparent)" }, {
          label: "Today",
          color: "var(--accent)",
        }]}
      />
    </ChartShell>
  );
}
