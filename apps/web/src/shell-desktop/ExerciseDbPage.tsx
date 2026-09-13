/* Exercise DB table: read-only seed + overlay (custom with muscle tags,
 * hidden list, per-exercise bar and rest-class overrides). */

import { useState } from "react";
import { Card, DataTable } from "../shared/ui.tsx";

const SEED = [
  {
    name: "Back Squat",
    equipment: "barbell",
    target: "quads",
    bar: "45 lb",
    rest: "main",
  },
  {
    name: "Bench Press",
    equipment: "barbell",
    target: "chest",
    bar: "45 lb",
    rest: "main",
  },
  {
    name: "Deadlift",
    equipment: "barbell",
    target: "hamstrings",
    bar: "45 lb",
    rest: "main",
  },
  {
    name: "Overhead Press",
    equipment: "barbell",
    target: "front delts",
    bar: "45 lb",
    rest: "main",
  },
  {
    name: "Romanian Deadlift",
    equipment: "barbell",
    target: "hamstrings",
    bar: "45 lb",
    rest: "secondary",
  },
  {
    name: "Walking Lunge",
    equipment: "dumbbell",
    target: "quads",
    bar: "—",
    rest: "secondary",
  },
  {
    name: "Standing Calf Raise",
    equipment: "machine",
    target: "calves",
    bar: "—",
    rest: "isolation",
  },
];

export function ExerciseDbPage() {
  const [hidden, setHidden] = useState<string[]>([]);
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title title">
          Exercises · 422 seed + yours
        </h1>
      </div>
      <Card>
        <DataTable
          head={["Exercise", "Equipment", "Target", "Bar", "Rest class", ""]}
          rows={SEED.filter((e) => !hidden.includes(e.name)).map((e) => [
            e.name,
            e.equipment,
            e.target,
            e.bar,
            e.rest,
            "",
          ])}
        />
        <p className="kbd-hint">
          Custom entries must carry target/synergist muscle tags.
        </p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {hidden.length > 0
            ? <span className="kbd-hint">Hidden: {hidden.join(", ")}</span>
            : null}
          {SEED.slice(0, 1).map((e) => (
            <button
              key={e.name}
              type="button"
              className="chip"
              onClick={() =>
                setHidden((h) => (h.includes(e.name)
                  ? h.filter((x) => x !== e.name)
                  : [...h, e.name])
                )}
            >
              {hidden.includes(e.name)
                ? `Unhide ${e.name}`
                : `Hide ${e.name} (demo)`}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
