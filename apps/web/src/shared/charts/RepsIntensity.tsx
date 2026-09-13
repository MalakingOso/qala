/* Intensity labels live in a wrapping legend. Bullet rows reserve their own
 * label and value line so long lift names cannot collide with the bars. */

import { ChartShell } from "./ChartShell.tsx";
import { ChartLegend, Plot, roundedBar } from "./Plot.tsx";
import { ORDINAL } from "./tokens.ts";

export function RepsIntensity(
  { zones, nl85 }: { zones: { label: string; reps: number }[]; nl85: number },
) {
  const total = Math.max(1, zones.reduce((a, z) => a + z.reps, 0));
  return (
    <ChartShell
      title="Reps by intensity"
      head={["Zone", "Reps"]}
      rows={[...zones.map((z) => [z.label, String(z.reps)]), [
        "NL85",
        String(nl85),
      ]]}
      label={`NL85 ${nl85} of ${total} reps.`}
    >
      <div className="chart-headline">
        <span className="figure">{nl85}</span>
        <span className="kbd-hint">reps at 85%+</span>
      </div>
      <Plot height={40}>
        {(width) => {
          let acc = 0;
          return (
            <svg width={width} height={40} role="presentation">
              {zones.map((z, i) => {
                const x = acc / total * width;
                const w = z.reps / total * width;
                acc += z.reps;
                return (
                  <g
                    key={z.label}
                    tabIndex={0}
                    role="img"
                    aria-label={`${z.label}: ${z.reps} reps`}
                  >
                    <title>{`${z.label}: ${z.reps}`}</title>
                    <path
                      d={roundedBar(x, 8, Math.max(0, w - 2), 22)}
                      fill={ORDINAL[i % ORDINAL.length]}
                    />
                  </g>
                );
              })}
            </svg>
          );
        }}
      </Plot>
      <ChartLegend
        items={zones.map((z, i) => ({
          label: z.label,
          color: ORDINAL[i % ORDINAL.length],
        }))}
      />
    </ChartShell>
  );
}

export function BulletNl85(
  { lifts }: { lifts: { lift: string; actual: number; target: number }[] },
) {
  const max = Math.max(1, ...lifts.map((l) => Math.max(l.actual, l.target)));
  return (
    <ChartShell
      title="Reps at 85%+ vs block target"
      head={["Lift", "Actual", "Target"]}
      rows={lifts.map((l) => [l.lift, String(l.actual), String(l.target)])}
      label={lifts.map((l) => `${l.lift} ${l.actual} of ${l.target}`).join(
        ", ",
      )}
    >
      <div className="bullet-rows">
        {lifts.map((l) => (
          <div key={l.lift}>
            <div className="bullet-label">
              <span>{l.lift}</span>
              <span>{l.actual} / {l.target}</span>
            </div>
            <Plot height={30}>
              {(width) => (
                <svg
                  width={width}
                  height={30}
                  role="img"
                  aria-label={`${l.lift}: ${l.actual} of target ${l.target}`}
                  tabIndex={0}
                >
                  <title>{`${l.lift}: ${l.actual} / ${l.target}`}</title>
                  <path
                    d={roundedBar(0, 8, width - 4, 14)}
                    fill="var(--bg-recessed)"
                  />
                  <path
                    d={roundedBar(0, 8, l.actual / max * (width - 4), 14)}
                    fill="var(--viz-2)"
                  />
                  <line
                    x1={l.target / max * (width - 4)}
                    x2={l.target / max * (width - 4)}
                    y1={3}
                    y2={27}
                    stroke="var(--accent)"
                    strokeWidth={2}
                  />
                </svg>
              )}
            </Plot>
          </div>
        ))}
      </div>
      <ChartLegend
        items={[{ label: "Completed reps", color: "var(--viz-2)" }, {
          label: "Block target",
          color: "var(--accent)",
          line: true,
        }]}
      />
    </ChartShell>
  );
}
