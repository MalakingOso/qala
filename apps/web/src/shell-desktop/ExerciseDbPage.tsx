/* Exercise DB (DECISIONS U21): search and equipment filter over the seed
 * rows, with a Hide action on each (the overlay's hidden list). Add exercise
 * puts a custom entry in the table for this session; it must carry target and
 * synergist muscle tags, and the program editor's dry run resolves it
 * (logic/customExercises.ts). */

import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  MUSCLE_GROUPS,
  type MuscleGroup,
  type RestClass,
} from "../../../../packages/core/exerciseTypes.ts";
import type { Lspp } from "../../../../packages/lspp/mod.ts";
import {
  cleanName,
  CUSTOM_EQUIPMENT,
  type CustomEquipment,
  type CustomExercise,
  draftProblems,
  isBuiltIn,
  MAX_NAME,
  MUSCLE_LABEL,
  toCustomExercise,
} from "../logic/customExercises.ts";
import { loadLspp } from "../lspp/load.ts";
import { useCustomExercises } from "./customExercises.tsx";
import { EXERCISE_SEED, type ExerciseRow, SEED_TOTAL } from "./exerciseSeed.ts";
import {
  FilterChips,
  PageHeader,
  Panel,
  Pill,
  type PillTone,
} from "./parts.tsx";

type Equipment = "all" | CustomEquipment;

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

const REST_CLASSES: RestClass[] = ["main", "secondary", "isolation"];

type Row = ExerciseRow & { custom?: boolean };

function customRow(c: CustomExercise): Row {
  const e = c.exercise;
  return {
    name: e.name,
    equipment: e.equipment,
    target: e.targetMuscles.map((m) => MUSCLE_LABEL[m]).join(", "),
    bar: e.equipment === "barbell" ? "45 lb" : "—",
    rest: c.restClass,
    custom: true,
  };
}

/** Toggle chips for one muscle role; a muscle picked here leaves the other. */
function MuscleChips(
  { legend, picked, onToggle }: {
    legend: string;
    picked: MuscleGroup[];
    onToggle: (m: MuscleGroup) => void;
  },
) {
  return (
    <fieldset className="add-ex-muscles">
      <legend>{legend}</legend>
      <div className="filter-chips">
        {MUSCLE_GROUPS.map((m) => (
          <button
            key={m}
            type="button"
            className={picked.includes(m) ? "filter-chip on" : "filter-chip"}
            aria-pressed={picked.includes(m)}
            onClick={() => onToggle(m)}
          >
            {MUSCLE_LABEL[m]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function ExerciseDbPage() {
  const { custom, add, remove } = useCustomExercises();
  const [hidden, setHidden] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [equipment, setEquipment] = useState<Equipment>("all");
  const [name, setName] = useState("");
  const [gear, setGear] = useState<CustomEquipment>("barbell");
  const [rest, setRest] = useState<RestClass>("secondary");
  const [target, setTarget] = useState<MuscleGroup[]>([]);
  const [synergist, setSynergist] = useState<MuscleGroup[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const lspp = useRef<Lspp | null>(null);

  // The built-in name check asks the evaluator; without the wasm it is skipped.
  useEffect(() => {
    let alive = true;
    loadLspp().then((api) => {
      if (alive) lspp.current = api;
    });
    return () => {
      alive = false;
    };
  }, []);

  const rows: Row[] = [...custom.map(customRow), ...EXERCISE_SEED];
  const total = SEED_TOTAL + custom.length;
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter((e) =>
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
  const pick = (
    m: MuscleGroup,
    set: typeof setTarget,
    other: typeof setTarget,
  ) => {
    set((l) => l.includes(m) ? l.filter((x) => x !== m) : [...l, m]);
    other((l) => l.filter((x) => x !== m));
  };

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const draft = { name, equipment: gear, target, synergist, restClass: rest };
    const found = draftProblems(draft, rows.map((r) => r.name));
    const clean = cleanName(name);
    if (found.length === 0 && lspp.current && isBuiltIn(lspp.current, clean)) {
      found.push(
        `${clean} is already in the exercise database, so programs can use it as it is.`,
      );
    }
    setProblems(found);
    if (found.length > 0) {
      setNote("");
      return;
    }
    add(toCustomExercise(draft));
    setNote(`Added ${clean}. The dry run on Programs resolves it now.`);
    setName("");
    setTarget([]);
    setSynergist([]);
  };

  return (
    <div>
      <PageHeader
        kicker={`${SEED_TOTAL} seed entries · plus ${
          custom.length > 0 ? `${custom.length} of ` : ""
        }yours`}
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
          aside={`${shown.length} of ${total} shown`}
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
                    {e.custom
                      ? (
                        <>
                          {" "}
                          <Pill tone="note">custom</Pill>
                        </>
                      )
                      : null}
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
          recovery and sets by muscle stay honest. They last until the page
          reloads, and the dry run on Programs resolves them by name.
        </p>
        <form className="add-ex" onSubmit={submit} noValidate>
          <div className="add-ex-fields">
            <label className="add-ex-field add-ex-name">
              <span>Name</span>
              <input
                type="text"
                value={name}
                maxLength={MAX_NAME}
                autoComplete="off"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="add-ex-field">
              <span>Equipment</span>
              <select
                value={gear}
                onChange={(e) => setGear(e.target.value as CustomEquipment)}
              >
                {CUSTOM_EQUIPMENT.map((g) => (
                  <option key={g} value={g}>
                    {EQUIPMENT.find((o) => o.value === g)?.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="add-ex-field">
              <span>Rest class</span>
              <select
                value={rest}
                onChange={(e) => setRest(e.target.value as RestClass)}
              >
                {REST_CLASSES.map((r) => <option key={r} value={r}>{r}
                </option>)}
              </select>
            </label>
          </div>
          <MuscleChips
            legend="Target"
            picked={target}
            onToggle={(m) => pick(m, setTarget, setSynergist)}
          />
          <MuscleChips
            legend="Synergists"
            picked={synergist}
            onToggle={(m) => pick(m, setSynergist, setTarget)}
          />
          {problems.length > 0
            ? (
              <ul className="add-ex-problems" role="alert">
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )
            : null}
          <div className="add-ex-foot">
            <button type="submit" className="btn-secondary small">
              Add exercise
            </button>
            <span className="kbd-hint" role="status">{note}</span>
          </div>
        </form>
        {custom.length > 0
          ? (
            <ul className="add-ex-list" aria-label="Your exercises">
              {custom.map((c) => (
                <li key={c.exercise.id}>
                  <b>{c.exercise.name}</b>
                  <span>
                    {` · ${c.exercise.equipment} · ${
                      c.exercise.targetMuscles.map((m) => MUSCLE_LABEL[m])
                        .join(", ")
                    }, with ${
                      c.exercise.synergistMuscles.map((m) => MUSCLE_LABEL[m])
                        .join(", ")
                    }`}
                  </span>
                  <button
                    type="button"
                    className="quiet-btn"
                    aria-label={`Remove ${c.exercise.name}`}
                    onClick={() => remove(c.exercise.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )
          : null}
        <p className="kbd-hint">
          {custom.length} custom · {hidden.length} hidden
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
