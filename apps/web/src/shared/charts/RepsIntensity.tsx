/* Intensity labels live in a wrapping legend. Bullet rows reserve their own
 * label and value line so long lift names cannot collide with the bars. */

import { ChartShell } from "./ChartShell.tsx";
import { ChartLegend, Plot, roundedBar } from "./Plot.tsx";
import { ORDINAL } from "./tokens.ts";

export function RepsIntensity(
  { zones, nl85 }: { zones: { label: string; reps: number }[]; nl85: number },
) {
  const total = Math.max(1, zones.reduce((a, z) => a + z.reps, 0));
  // Zones at or above 85% of 1RM are what the headline counts (NL85).
  const heavyFrom = zones.findIndex((z) => /^(85|9\d)/.test(z.label));
  const before = heavyFrom < 0
    ? total
    : zones.slice(0, heavyFrom).reduce((a, z) => a + z.reps, 0);
  return (
    <ChartShell
      title="Reps by intensity"
      head={["Zone", "Reps"]}
      rows={[...zones.map((z) => [`${z.label}%`, String(z.reps)]), [
        "NL85",
        String(nl85),
      ]]}
      label={`NL85 ${nl85} of ${total} reps.`}
    >
      <div className="chart-headline">
        <span className="figure">{nl85}</span>
        <span className="kbd-hint">
          of {total} reps at 85% or more
        </span>
      </div>
      <Plot height={58}>
        {(width) => {
          let acc = 0;
          const bx = (before / total) * width;
          return (
            <svg width={width} height={58} role="presentation">
              {heavyFrom >= 0 && nl85 > 0
                ? (
                  <g>
                    <path
                      d={`M${bx + 1},16 V8 H${width - 1} V16`}
                      fill="none"
                      stroke="var(--fg-secondary)"
                      strokeWidth={1.5}
                    />
                  </g>
                )
                : null}
              {zones.map((z, i) => {
                const x = acc / total * width;
                const w = z.reps / total * width;
                acc += z.reps;
                return (
                  <g
                    key={z.label}
                    tabIndex={0}
                    role="img"
                    aria-label={`${z.label}%: ${z.reps} reps`}
                  >
                    <title>{`${z.label}%: ${z.reps} reps`}</title>
                    <path
                      d={roundedBar(x, 24, Math.max(0, w - 2), 24)}
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
          label: `${z.label}% · ${z.reps}`,
          color: ORDINAL[i % ORDINAL.length],
        }))}
      />
    </ChartShell>
  );
}

export function BulletNl85(
  { lifts }: { lifts: { lift: string; actual: number; target: number }[] },
) {
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
        {lifts.map((l) => {
          const pct = Math.min(1, l.actual / Math.max(1, l.target));
          const left = Math.max(0, l.target - l.actual);
          return (
            <div
              key={l.lift}
              tabIndex={0}
              role="img"
              aria-label={`${l.lift}: ${l.actual} of ${l.target} reps`}
            >
              <div className="bullet-label">
                <span>{l.lift}</span>
                <span>
                  <strong style={{ color: "var(--fg)" }}>{l.actual}</strong>
                  {" / "}
                  {l.target}
                  {" · "}
                  {left > 0 ? `${left} to go` : "done"}
                </span>
              </div>
              <div
                style={{
                  height: 12,
                  borderRadius: 6,
                  background: "var(--bg-recessed)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.round(pct * 100)}%`,
                    borderRadius: 6,
                    background: left > 0 ? "var(--viz-2)" : "var(--viz-3)",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </ChartShell>
  );
}
