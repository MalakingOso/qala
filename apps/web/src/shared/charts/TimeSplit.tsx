/* Where the time went: one stacked horizontal bar, categorical
 * (warm-up, lifting, rest). */

import { useMemo } from "react";
import { scaleLinear } from "@visx/scale";
import { ChartShell } from "./ChartShell.tsx";
import { CATEGORICAL } from "./tokens.ts";

const W = 560;
const H = 96;

export function TimeSplit({
  parts,
}: {
  parts: { label: string; minutes: number }[];
}) {
  const total = Math.max(1, parts.reduce((a, p) => a + p.minutes, 0));
  const x = useMemo(
    () => scaleLinear<number>({ domain: [0, total], range: [8, W - 8] }),
    [total],
  );
  let acc = 0;
  const rows = parts.map((p) => [p.label, `${p.minutes} min`]);
  return (
    <ChartShell
      title="Where the time went"
      head={["Block", "Minutes"]}
      rows={rows}
      label={`${total} minutes: ${parts.map((p) => `${p.label} ${p.minutes}`).join(", ")}.`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="presentation">
        {parts.map((p, i) => {
          const x0 = x(acc);
          const x1 = x(acc + p.minutes) - 2; // 2px surface gap
          acc += p.minutes;
          return (
            <g key={p.label} tabIndex={0} role="img" aria-label={`${p.label}: ${p.minutes} minutes`}>
              <title>{`${p.label}: ${p.minutes} min`}</title>
              <rect x={x0} y={18} width={Math.max(0, x1 - x0)} height={24} fill={CATEGORICAL[i % 3]} rx={0} />
              <text x={x0 + 4} y={58} fontSize={11} fill="var(--fg)">
                {p.label}
              </text>
              <text x={x0 + 4} y={72} fontSize={11} fill="var(--fg-muted)">
                {p.minutes} min
              </text>
            </g>
          );
        })}
      </svg>
    </ChartShell>
  );
}
