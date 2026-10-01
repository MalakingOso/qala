/* All exercises (DESIGN 7.7): the zoomed-out view. Warm-up done, then a
 * grid of exercises with a box per set, the current one outlined in ember.
 * Out-of-order work is fine; history keeps the order. */

import { useQala } from "../../store/qalaStore.tsx";
import { FlowHeader } from "../FlowHeader.tsx";
import { CircleCheck } from "../../shared/icons.ts";

export function AllExercisesPage() {
  const { exercises } = useQala();
  const current = exercises.findIndex((e) => e.sets.some((s) => !s.done));
  return (
    <div>
      <FlowHeader session="Lower A" clock="24:10" back="#/phone/workout" />
      <div className="page-head">
        <h1 className="page-title title">All exercises</h1>
      </div>
      <p className="allex-warm">
        <CircleCheck size={16} aria-hidden="true" /> Warm-up done · 15 min
      </p>
      <div className="allex-grid">
        {exercises.map((e, i) => {
          const done = e.sets.filter((s) => s.done).length;
          const complete = done === e.sets.length;
          return (
            <a
              key={e.id}
              href={`#/phone/workout?idx=${i}`}
              className={`allex-card${i === current ? " current" : ""}${
                complete ? " complete" : ""
              }`}
              aria-label={`${e.name}, ${done} of ${e.sets.length} sets`}
            >
              <span className="allex-n">{i + 1}</span>
              <strong>{e.name}</strong>
              <span className="kbd-hint">
                {e.sets.length} × {e.sets[0]?.r} @ {e.sets[0]?.w}
              </span>
              <span className="set-boxes" aria-hidden="true">
                {e.sets.map((s, j) => (
                  <span key={j} className={s.done ? "done" : undefined} />
                ))}
              </span>
            </a>
          );
        })}
      </div>
      <p className="kbd-hint footnote">
        Tap any exercise to jump to it. The order is yours to choose.
      </p>
    </div>
  );
}
