/* Fatigue by muscle: paired bars, lifting vs running set-equivalents.
 * Running fitness: sparkline. Splits: table with inline bars. */

import { useMemo } from "react";
import { Bar, LinePath } from "@visx/shape";
import { scaleBand, scaleLinear, scalePoint } from "@visx/scale";
import { ChartShell } from "./ChartShell.tsx";
import { CATEGORICAL } from "./tokens.ts";
import { formatPace } from "../../logic/pace.ts";

const W = 560;

export function FatigueByMuscle({
  muscles,
}: {
  muscles: {
    muscle: string;
    lifting: number;
    running: number;
    ready: string;
  }[];
}) {
  const H = muscles.length * 40 + 30;
  const { x, y } = useMemo(() => {
    const max = Math.max(1, ...muscles.map((m) => m.lifting + m.running));
    // Leave room right of the longest bar for the "ready" label (W-12); the
    // longest bar's total always equals `max`, so without this gap its bar
    // and label collide.
    return {
      x: scaleLinear<number>({ domain: [0, max], range: [120, W - 56] }),
      y: scaleBand<string>({
        domain: muscles.map((m) => m.muscle),
        range: [8, H - 22],
        padding: 0.4,
      }),
    };
  }, [muscles, H]);
  const rows = muscles.map((
    m,
  ) => [m.muscle, m.lifting.toFixed(1), m.running.toFixed(1), m.ready]);
  return (
    <ChartShell
      title="Fatigue by muscle"
      head={["Muscle", "Lifting", "Running", "Ready"]}
      rows={rows}
      label="Fatigue split lifting and running per muscle."
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="presentation">
        {muscles.map((m) => {
          const yy = y(m.muscle) ?? 0;
          const bh = y.bandwidth() / 2;
          const lw = Math.max(0, x(m.lifting) - 120);
          const rw = Math.max(0, x(m.lifting + m.running) - x(m.lifting));
          return (
            <g
              key={m.muscle}
              tabIndex={0}
              role="img"
              aria-label={`${m.muscle}: lifting ${m.lifting}, running ${m.running}, ready ${m.ready}`}
            >
              <title>{`${m.muscle}: ready ${m.ready}`}</title>
              <text
                x={112}
                y={yy + bh + 2}
                fontSize={11}
                textAnchor="end"
                fill="var(--fg)"
              >
                {m.muscle}
              </text>
              <Bar
                x={120}
                y={yy}
                width={lw}
                height={bh}
                fill={CATEGORICAL[0]}
                rx={0}
              />
              <Bar
                x={120 + lw}
                y={yy}
                width={rw}
                height={bh}
                fill={CATEGORICAL[1]}
                rx={0}
              />
              <text
                x={W - 12}
                y={yy + bh + 2}
                fontSize={10}
                textAnchor="end"
                fill="var(--fg-muted)"
              >
                {m.ready}
              </text>
            </g>
          );
        })}
        <g fontSize={11} fill="var(--fg)">
          <rect
            x={120}
            y={H - 16}
            width={10}
            height={10}
            fill={CATEGORICAL[0]}
          />
          <text x={134} y={H - 7}>lifting</text>
          <rect
            x={190}
            y={H - 16}
            width={10}
            height={10}
            fill={CATEGORICAL[1]}
          />
          <text x={204} y={H - 7}>running</text>
        </g>
      </svg>
    </ChartShell>
  );
}

export function RunSpark(
  { points, label }: { points: number[]; label: string },
) {
  const H = 64;
  const x = useMemo(
    () =>
      scalePoint<number>({
        domain: points.map((_, i) => i),
        range: [4, W - 4],
        padding: 0.5,
      }),
    [points],
  );
  const y = useMemo(() => {
    const lo = Math.min(...points);
    const hi = Math.max(...points);
    const pad = Math.max(0.5, (hi - lo) * 0.2);
    return scaleLinear<number>({
      domain: [lo - pad, hi + pad],
      range: [H - 6, 6],
    });
  }, [points]);
  return (
    <ChartShell
      title="Running fitness"
      head={["Week", "VDOT"]}
      rows={points.map((p, i) => [`w${i + 1}`, p.toFixed(1)])}
      label={label}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="presentation">
        <LinePath
          data={points}
          x={(_, i) => x(i) ?? 0}
          y={(d) => y(d)}
          stroke="var(--run)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </ChartShell>
  );
}

export function SplitsTable({
  splits,
}: {
  splits: { mile: number; sec: number }[];
}) {
  const slowest = Math.max(1, ...splits.map((s) => s.sec));
  const rows = splits.map((s) => [`Mile ${s.mile}`, formatPace(s.sec)]);
  return (
    <ChartShell
      title="Splits"
      head={["Split", "Pace"]}
      rows={rows}
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
                    height: 14,
                    width: `${Math.round((s.sec / slowest) * 100)}%`,
                    background: "var(--run)",
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
