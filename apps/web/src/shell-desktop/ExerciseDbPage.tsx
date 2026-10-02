/* Exercise DB (DECISIONS U21): search and equipment filter over the seed
 * rows, with a Hide action on each (the overlay's hidden list). Custom
 * entries must carry target and synergist muscle tags. */

import { useState } from "react";
import { EXERCISE_SEED, SEED_TOTAL } from "./exerciseSeed.ts";
import {
  FilterChips,
  PageHeader,
  Panel,
  Pill,
  type PillTone,
} from "./parts.tsx";

type Equipment = "all" | "barbell" | "dumbbell" | "machine" | "bodyweight";

const EQUIPMENT: { value: Equipment; label: string }[] = [
  { value: "all", label: "All" },
  { value: "barbell", label: "Barbell" },
  { value: "dumbbell", label: "Dumbbell" },
  { value: "machine", label: "Machine" },
  { value: "bodyweight", label: "Bodyweight" },
];

const REST_TONE: Record<string, PillTone> = {
  main: "warn",
  secondary: "info",
  isolation: "ok",
};

export function ExerciseDbPage() {
  const [hidden, setHidden] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [equipment, setEquipment] = useState<Equipment>("all");
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = EXERCISE_SEED.filter((e) =>
    !hidden.includes(e.name) &&
    (equipment === "all" || e.equipment === equipment) &&
    terms.every((t) =>
      `${e.name} ${e.target} ${e.equipment}`.toLowerCase().includes(t)
    )
  );
  const toggle = (name: string) =>
    setHidden((h) =>
      h.includes(name) ? h.filter((x) => x !== name) : [...h, name]
    );

  return (
    <div>
      <PageHeader
        kicker={`${SEED_TOTAL} seed entries · plus yours`}
        title="Exercises"
      >
        <label className="big-search">
          <input
            type="search"
            placeholder="Filter by name, muscle or equipment"
            aria-label="Filter exercises"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <FilterChips
          label="Equipment"
          options={EQUIPMENT}
          value={equipment}
          onPick={setEquipment}
          aside={`${shown.length} of ${SEED_TOTAL} shown`}
        />
      </PageHeader>
      <Panel title="All exercises">
        <div
          className="table-scroll"
          role="region"
          aria-label="Exercises table"
          tabIndex={0}
        >
          <table className="stable">
            <thead>
              <tr>
                <th scope="col">Exercise</th>
                <th scope="col">Equipment</th>
                <th scope="col">Target</th>
                <th scope="col" className="num">Bar</th>
                <th scope="col">Rest class</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.name}>
                  <td>
                    <b>{e.name}</b>
                  </td>
                  <td className="cap">{e.equipment}</td>
                  <td className="cap">{e.target}</td>
                  <td className="num">{e.bar}</td>
                  <td>
                    <Pill tone={REST_TONE[e.rest]}>{e.rest}</Pill>
                  </td>
                  <td className="num">
                    <button
                      type="button"
                      className="quiet-btn"
                      aria-label={`Hide ${e.name}`}
                      onClick={() => toggle(e.name)}
                    >
                      Hide
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Yours">
        <p className="mine-line">
          Custom entries must carry target and synergist muscle tags, so
          recovery and sets by muscle stay honest.
        </p>
        <p className="kbd-hint">
          0 custom · {hidden.length} hidden
          {hidden.map((name) => (
            <button
              key={name}
              type="button"
              className="quiet-btn"
              onClick={() => toggle(name)}
            >
              {`Unhide ${name}`}
            </button>
          ))}
        </p>
      </Panel>
    </div>
  );
}
