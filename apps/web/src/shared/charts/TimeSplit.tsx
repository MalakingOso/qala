/* Labels wrap below the stacked bar, independent of each segment's width. */

import { ChartShell } from "./ChartShell.tsx";
import { ChartLegend, Plot, roundedBar } from "./Plot.tsx";
import { CATEGORICAL } from "./tokens.ts";

export function TimeSplit(
  { parts }: { parts: { label: string; minutes: number }[] },
) {
  const total = Math.max(1, parts.reduce((a, p) => a + p.minutes, 0));
  return (
    <ChartShell
      title="Where the time went"
      head={["Block", "Minutes"]}
      rows={parts.map((p) => [p.label, `${p.minutes} min`])}
      label={`${total} minutes: ${
        parts.map((p) => `${p.label} ${p.minutes}`).join(", ")
      }.`}
    >
      <Plot height={40}>
        {(width) => {
          let acc = 0;
          return (
            <svg width={width} height={40} role="presentation">
              {parts.map((p, i) => {
                const x = acc / total * width;
                const w = p.minutes / total * width;
                acc += p.minutes;
                return (
                  <g
                    key={p.label}
                    tabIndex={0}
                    role="img"
                    aria-label={`${p.label}: ${p.minutes} minutes`}
                  >
                    <title>{`${p.label}: ${p.minutes} min`}</title>
                    <path
                      d={roundedBar(x, 8, Math.max(0, w - 2), 22)}
                      fill={CATEGORICAL[i % 3]}
                    />
                  </g>
                );
              })}
            </svg>
          );
        }}
      </Plot>
      <ChartLegend
        items={parts.map((p, i) => ({
          label: `${p.label} · ${p.minutes} min`,
          color: CATEGORICAL[i % 3],
        }))}
      />
    </ChartShell>
  );
}
