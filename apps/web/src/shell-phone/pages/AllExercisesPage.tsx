/* All exercises (DESIGN 7.7): zoomed-out grid with set dots, current
 * outlined in ember. Out-of-order work is fine; history keeps the order. */

import { useQala } from "../../store/qalaStore.tsx";
import { Card } from "../../shared/ui.tsx";

export function AllExercisesPage() {
  const { exercises } = useQala();
  const current = exercises.findIndex((e) => e.sets.some((s) => !s.done));
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">All exercises</h1>
      </div>
      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {exercises.map((e, i) => (
            <a
              key={e.id}
              href="#/phone/workout"
              style={{
                textDecoration: "none",
                color: "inherit",
                border: "var(--border-width) solid var(--border)",
                borderRadius: "var(--radius)",
                padding: 10,
                outline: i === current ? "2px solid var(--accent)" : "none",
              }}
              aria-label={`${e.name}, ${e.sets.filter((s) => s.done).length} of ${e.sets.length} sets`}
            >
              <strong>{e.name}</strong>
              <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                {e.sets.map((s, j) => (
                  <span
                    key={j}
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      background: s.done ? "var(--progress-fill)" : "var(--bg-active)",
                      border: "1px solid var(--border-strong)",
                    }}
                  />
                ))}
              </div>
            </a>
          ))}
        </div>
        <p className="kbd-hint">Warm-up done. Tap to jump; order is yours to choose.</p>
      </Card>
    </div>
  );
}
