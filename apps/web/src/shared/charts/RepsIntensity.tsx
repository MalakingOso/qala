/* Reps by intensity: one stacked bar on the ordinal ramp, NL85 headline.
 * Reps at 85%+ vs block target: bullet bars with an ember target tick. */

import { useMemo } from "react";
import { scaleLinear } from "@visx/scale";
import { ChartShell } from "./ChartShell.tsx";
import { ORDINAL } from "./tokens.ts";

const W = 560;

export function RepsIntensity({
  zones,
  nl85,
}: {
  zones: { label: string; reps: number }[];
  nl85: number;
}) {
  const total = Math.max(1, zones.reduce((a, z) => a + z.reps, 0));
  const x = useMemo(
    () => scaleLinear<number>({ domain: [0, total], range: [8, W - 8] }),
    [total],
  );
  let acc = 0;
  const rows = zones.map((z) => [z.label, String(z.reps)]);
  return (
    <ChartShell
      title="Reps by intensity"
      head={["Zone", "Reps"]}
      rows={[...rows, ["NL85", String(nl85)]]}
      label={`NL85 ${nl85} of ${total} reps.`}
    >
      <div className="figure" style={{ fontSize: 28 }}>
        NL85 {nl85}
      </div>
      <svg viewBox={`0 0 ${W} 64`} width="100%" role="presentation">
        {zones.map((z, i) => {
          const x0 = x(acc);
          const x1 = x(acc + z.reps) - 2;
          acc += z.reps;
          return (
            <g
              key={z.label}
              tabIndex={0}
              role="img"
              aria-label={`${z.label}: ${z.reps} reps`}
            >
              <title>{`${z.label}: ${z.reps}`}</title>
              <rect
                x={x0}
                y={8}
                width={Math.max(0, x1 - x0)}
                height={22}
                fill={ORDINAL[i % ORDINAL.length]}
              />
              <text x={x0 + 4} y={48} fontSize={11} fill="var(--fg)">
                {z.label}
              </text>
            </g>
          );
        })}
      </svg>
    </ChartShell>
  );
}

export function BulletNl85({
  lifts,
}: {
  lifts: { lift: string; actual: number; target: number }[];
}) {
  const max = Math.max(1, ...lifts.map((l) => Math.max(l.actual, l.target)));
  const H = lifts.length * 44 + 8;
  const x = useMemo(
    () => scaleLinear<number>({ domain: [0, max], range: [120, W - 12] }),
    [max],
  );
  const rows = lifts.map((l) => [l.lift, String(l.actual), String(l.target)]);
  return (
    <ChartShell
      title="Reps at 85%+ vs block target"
      head={["Lift", "Actual", "Target"]}
      rows={rows}
      label={lifts.map((l) => `${l.lift} ${l.actual} of ${l.target}`).join(
        ", ",
      )}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="presentation">
        {lifts.map((l, i) => {
          const yy = 10 + i * 44;
          return (
            <g
              key={l.lift}
              tabIndex={0}
              role="img"
              aria-label={`${l.lift}: ${l.actual} of target ${l.target}`}
            >
              <title>{`${l.lift}: ${l.actual} / ${l.target}`}</title>
              <text
                x={112}
                y={yy + 18}
                fontSize={12}
                textAnchor="end"
                fill="var(--fg)"
              >
                {l.lift}
              </text>
              <rect
                x={120}
                y={yy}
                width={Math.max(0, x(l.actual) - 120)}
                height={22}
                fill="var(--viz-2)"
                rx={2}
              />
              <line
                x1={x(l.target)}
                x2={x(l.target)}
                y1={yy - 4}
                y2={yy + 26}
                stroke="var(--accent)"
                strokeWidth={3}
              />
            </g>
          );
        })}
      </svg>
    </ChartShell>
  );
}
