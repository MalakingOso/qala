/* Intensity labels live in a wrapping legend. Bullet rows reserve their own
 * label and value line so long lift names cannot collide with the bars. */

import { ChartShell } from "./ChartShell.tsx";

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
