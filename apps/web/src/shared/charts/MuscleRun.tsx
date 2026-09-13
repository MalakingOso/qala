/* Fatigue labels have dedicated left/right gutters. Running fitness shares
 * the same smooth, pixel-sized trend drawing as the strength charts. */

import { scaleLinear } from "@visx/scale";
import { ChartShell } from "./ChartShell.tsx";
import { ChartLegend, Plot, roundedBar } from "./Plot.tsx";
import { TrendPlot } from "./TrendPlot.tsx";
import { CATEGORICAL } from "./tokens.ts";
import { formatPace } from "../../logic/pace.ts";

export function FatigueByMuscle({ muscles }: {
  muscles: {
    muscle: string;
    lifting: number;
    running: number;
    ready: string;
  }[];
}) {
  const height = muscles.length * 40 + 24;
  const max = Math.max(1, ...muscles.map((m) => m.lifting + m.running));
  return (
    <ChartShell
      title="Fatigue by muscle"
      head={["Muscle", "Lifting", "Running", "Ready"]}
      rows={muscles.map((
        m,
      ) => [m.muscle, m.lifting.toFixed(1), m.running.toFixed(1), m.ready])}
      label="Fatigue split lifting and running per muscle."
    >
      <Plot height={height}>
        {(width) => {
          const left = 88;
          const x = scaleLinear<number>({
            domain: [0, max],
            range: [left, Math.max(left + 1, width - 56)],
          });
          return (
            <svg width={width} height={height} role="presentation">
              <text
                x={width - 2}
                y={12}
                textAnchor="end"
                fontSize={10}
                fill="var(--fg-muted)"
              >
                Ready
              </text>
              {muscles.map((m, i) => {
                const yy = 26 + i * 40;
                const split = x(m.lifting);
                const end = x(m.lifting + m.running);
                return (
                  <g
                    className="bar-row"
                    key={m.muscle}
                    tabIndex={0}
                    role="img"
                    aria-label={`${m.muscle}: lifting ${m.lifting}, running ${m.running}, ready ${m.ready}`}
                  >
                    <title>
                      {`${m.muscle}: lifting ${m.lifting}, running ${m.running}, ready ${m.ready}`}
                    </title>
                    <rect
                      x={0}
                      y={yy - 8}
                      width={width}
                      height={36}
                      fill="transparent"
                    />
                    <text
                      x={left - 10}
                      y={yy + 13}
                      fontSize={11}
                      textAnchor="end"
                      fill="var(--fg-secondary)"
                    >
                      {m.muscle}
                    </text>
                    <path
                      d={roundedBar(left, yy, end - left, 18)}
                      fill={CATEGORICAL[0]}
                    />
                    {m.running > 0 && (
                      <path
                        d={roundedBar(
                          split + 2,
                          yy,
                          Math.max(0, end - split - 2),
                          18,
                        )}
                        fill={CATEGORICAL[1]}
                      />
                    )}
                    <text
                      x={width - 2}
                      y={yy + 13}
                      fontSize={10}
                      textAnchor="end"
                      fill="var(--fg-muted)"
                    >
                      {m.ready}
                    </text>
                  </g>
                );
              })}
            </svg>
          );
        }}
      </Plot>
      <ChartLegend
        items={[{ label: "Lifting", color: CATEGORICAL[0] }, {
          label: "Running",
          color: CATEGORICAL[1],
        }]}
      />
    </ChartShell>
  );
}

export function RunSpark(
  { points, label }: { points: number[]; label: string },
) {
  return (
    <ChartShell
      title="Running fitness"
      head={["Week", "VDOT"]}
      rows={points.map((p, i) => [`w${i + 1}`, p.toFixed(1)])}
      label={label}
    >
      <TrendPlot
        points={points.map((p, i) => ({ label: `W${i + 1}`, value: p }))}
        height={160}
        color="var(--run)"
      />
    </ChartShell>
  );
}

export function SplitsTable(
  { splits }: { splits: { mile: number; sec: number }[] },
) {
  const slowest = Math.max(1, ...splits.map((s) => s.sec));
  return (
    <ChartShell
      title="Splits"
      head={["Split", "Pace"]}
      rows={splits.map((s) => [`Mile ${s.mile}`, formatPace(s.sec)])}
      label={splits.map((s) => `mile ${s.mile} ${formatPace(s.sec)}`).join(
        ", ",
      )}
    >
      <table className="data">
        <tbody>
          {splits.map((s) => (
            <tr key={s.mile}>
              <td>Mile {s.mile}</td>
              <td style={{ width: "50%" }}>
                <div
                  style={{
                    height: 10,
                    width: `${Math.round((s.sec / slowest) * 100)}%`,
                    background: "var(--run)",
                    borderRadius: "0 4px 4px 0",
                  }}
                  role="img"
                  aria-label={`${formatPace(s.sec)} pace`}
                />
              </td>
              <td className="ticking">{formatPace(s.sec)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartShell>
  );
}
