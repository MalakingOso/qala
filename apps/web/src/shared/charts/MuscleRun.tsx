/* Fatigue labels have dedicated left/right gutters. Running fitness shares
 * the same smooth, pixel-sized trend drawing as the strength charts. */

import { ChartShell } from "./ChartShell.tsx";
import { TrendPlot } from "./TrendPlot.tsx";
import { formatPace } from "../../logic/pace.ts";

export function RunSpark(
  { points, label, flat }: { points: number[]; label: string; flat?: boolean },
) {
  return (
    <ChartShell
      title="Running fitness"
      flat={flat}
      surface="night"
      head={["Week", "VDOT"]}
      rows={points.map((p, i) => [`w${i + 1}`, p.toFixed(1)])}
      label={label}
    >
      <TrendPlot
        points={points.map((p, i) => ({ label: `W${i + 1}`, value: p }))}
        height={160}
        axisLabel={"V\u0307"}
        axisHint="V-dot (VDOT): Daniels' running fitness score, the VO2max that a race or hard effort implies. Higher is fitter; 40 is about a 24 minute 5K."
      />
    </ChartShell>
  );
}

/** Splits as the difference from the run's average pace: a bar to the
 * right is a faster mile, to the left a slower one, labeled in seconds.
 * Bars from zero would draw 8:58 and 9:11 as near-identical lengths and
 * make the slowest mile the longest bar. */
export function SplitsTable(
  { splits, title = "Splits", flat }: {
    splits: { mile: number; sec: number }[];
    title?: string;
    flat?: boolean;
  },
) {
  const avg = splits.length
    ? splits.reduce((a, s) => a + s.sec, 0) / splits.length
    : 0;
  const maxDev = Math.max(5, ...splits.map((s) => Math.abs(s.sec - avg)));
  return (
    <ChartShell
      title={title}
      flat={flat}
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
