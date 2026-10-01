/* Fatigue labels have dedicated left/right gutters. Running fitness shares
 * the same smooth, pixel-sized trend drawing as the strength charts. */

import { ChartShell } from "./ChartShell.tsx";
import { TrendPlot } from "./TrendPlot.tsx";
import { CATEGORICAL } from "./tokens.ts";
import { formatPace } from "../../logic/pace.ts";

/* Plain-language recovery list for someone who has never heard of
 * "fatigue load". Each row says how worn out the muscle is and when to train
 * it again; the lifting/running numbers stay in the table view and tooltip. */
function cause(lifting: number, running: number) {
  const share = running / Math.max(0.001, lifting + running);
  if (share < 0.2) return "from lifting";
  if (share > 0.6) return "from running";
  return "from lifting and running";
}

export function FatigueByMuscle({ muscles }: {
  muscles: {
    muscle: string;
    lifting: number;
    running: number;
    ready: string;
  }[];
}) {
  const rows = [...muscles].sort((a, b) =>
    b.lifting + b.running - (a.lifting + a.running)
  );
  const max = Math.max(1, ...rows.map((m) => m.lifting + m.running));
  const tired = rows.filter((m) => m.ready !== "now");
  const headline = tired.length === 0
    ? "Everything is recovered. Train whatever you like."
    : `Go easy on ${tired.map((m) => m.muscle).join(", ")} for now.`;
  return (
    <ChartShell
      title="Muscle recovery"
      head={["Muscle", "Lifting", "Running", "Ready"]}
      rows={muscles.map((
        m,
      ) => [m.muscle, m.lifting.toFixed(1), m.running.toFixed(1), m.ready])}
      label="Recovery per muscle after lifting and running."
    >
      <p style={{ margin: "0 0 16px", color: "var(--fg)" }}>{headline}</p>
      <div style={{ display: "grid", gap: 16 }}>
        {rows.map((m) => {
          const level = (m.lifting + m.running) / max;
          const ok = m.ready === "now";
          return (
            <div
              key={m.muscle}
              tabIndex={0}
              role="img"
              aria-label={`${m.muscle}: ${
                ok ? "ready now" : `ready ${m.ready}`
              }, ${cause(m.lifting, m.running)}`}
              title={`${m.lifting.toFixed(1)} lifting + ${
                m.running.toFixed(1)
              } running`}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <span style={{ color: "var(--fg)" }}>{m.muscle}</span>
                <span
                  style={{
                    color: ok ? "var(--fg)" : "var(--fg-secondary)",
                    fontWeight: ok ? 600 : 400,
                  }}
                >
                  {ok ? "Ready now" : `Ready ${m.ready}`}
                </span>
              </div>
              <div
                style={{
                  height: 10,
                  margin: "6px 0 4px",
                  borderRadius: 5,
                  background: "var(--bg-recessed)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.max(6, Math.round(level * 100))}%`,
                    borderRadius: 5,
                    background: ok ? "var(--viz-3)" : CATEGORICAL[0],
                  }}
                />
              </div>
              <span className="kbd-hint">
                {ok ? "Barely worked" : `Worked hard ${cause(m.lifting, m.running)}`}
              </span>
            </div>
          );
        })}
      </div>
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

/** Splits as the difference from the run's average pace: a bar to the
 * right is a faster mile, to the left a slower one, labeled in seconds.
 * Bars from zero would draw 8:58 and 9:11 as near-identical lengths and
 * make the slowest mile the longest bar. */
export function SplitsTable(
  { splits }: { splits: { mile: number; sec: number }[] },
) {
  const avg = splits.length
    ? splits.reduce((a, s) => a + s.sec, 0) / splits.length
    : 0;
  const maxDev = Math.max(5, ...splits.map((s) => Math.abs(s.sec - avg)));
  return (
    <ChartShell
      title="Splits"
      head={["Split", "Pace", "vs average"]}
      rows={splits.map((s) => [
        `Mile ${s.mile}`,
        formatPace(s.sec),
        Math.round(s.sec - avg) === 0
          ? "avg"
          : `${Math.round(s.sec - avg) > 0 ? "+" : "−"}${
            Math.abs(Math.round(s.sec - avg))
          } s`,
      ])}
      label={splits.map((s) => `mile ${s.mile} ${formatPace(s.sec)}`).join(
        ", ",
      )}
    >
      <div className="splits">
        <div className="splits-scale" aria-hidden="true">
          <span>slower</span>
          <span>avg {formatPace(avg)}</span>
          <span>faster</span>
        </div>
        {splits.map((s) => {
          const dev = Math.round(avg - s.sec); // positive = faster
          const pct = (Math.abs(dev) / maxDev) * 50;
          return (
            <div
              key={s.mile}
              className="split-row"
              role="img"
              aria-label={`Mile ${s.mile}: ${formatPace(s.sec)}, ${
                dev === 0
                  ? "on average"
                  : `${Math.abs(dev)} s ${dev > 0 ? "faster" : "slower"}`
              }`}
            >
              <span className="split-mile">{s.mile}</span>
              <span className="split-track">
                <span
                  className={dev >= 0 ? "split-bar faster" : "split-bar slower"}
                  style={dev >= 0
                    ? { left: "50%", width: `${pct}%` }
                    : { right: "50%", width: `${pct}%` }}
                />
              </span>
              <span className="split-pace ticking">{formatPace(s.sec)}</span>
              <span className="split-dev">
                {dev === 0 ? "avg" : `${dev > 0 ? "−" : "+"}${Math.abs(dev)} s`}
              </span>
            </div>
          );
        })}
      </div>
    </ChartShell>
  );
}
