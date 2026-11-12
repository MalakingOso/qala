/* Custom exercises from the desktop Exercises page (PLAN 3's overlay, the
 * `Exercise` shape in packages/core/exerciseTypes.ts), and the bridge that
 * lets the LS++ dry run resolve them. The wasm's settings bridge
 * (`qala_settings_to_liftoscript`) leaves liftosaur's `settings.exercises`
 * empty, so the editor merges these in as `ICustomExercise` records before it
 * calls the dry run. They live for the session only: nothing stores them. */

import type {
  BodyPart,
  Equipment,
  Exercise,
  MuscleGroup,
  RestClass,
} from "../../../../packages/core/exerciseTypes.ts";
import { createBaselineDocument } from "../../../../packages/core/migrations.ts";
import type { Lspp } from "../../../../packages/lspp/mod.ts";

/** The Exercises page's equipment chips, which the form offers too. */
export type CustomEquipment = Extract<
  Equipment,
  "barbell" | "dumbbell" | "machine" | "bodyweight"
>;

export const CUSTOM_EQUIPMENT: CustomEquipment[] = [
  "barbell",
  "dumbbell",
  "machine",
  "bodyweight",
];

export const MUSCLE_LABEL: Record<MuscleGroup, string> = {
  chest: "chest",
  back: "back",
  quads: "quads",
  hamstrings: "hamstrings",
  glutes: "glutes",
  sideDelts: "side delts",
  biceps: "biceps",
  triceps: "triceps",
  calves: "calves",
};

export interface CustomExercise {
  exercise: Exercise;
  /** The overlay keeps this as a per-exercise override (`ExerciseOverride`). */
  restClass: RestClass;
}

export interface CustomDraft {
  name: string;
  equipment: CustomEquipment;
  target: MuscleGroup[];
  synergist: MuscleGroup[];
  restClass: RestClass;
}

export const MAX_NAME = 40;

/* Letters, digits, spaces, hyphens, apostrophes and full stops. A comma names
 * the equipment in LS++ ("Squat, Barbell"), a slash ends the name, and
 * brackets start a set range, so a name with them never resolves. */
const NAME_OK = /^[A-Za-z][A-Za-z0-9 '.-]*$/;

export function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** "Zercher Hold" -> "qala-zercherhold". The prefix keeps a custom id from
 * ever equalling a built-in one, which liftosaur would let it replace. */
export function customId(name: string): string {
  return `qala-${cleanName(name).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

/** What stops a draft from being added, in the order the form shows them.
 * `taken` is every name already listed: the seed rows and the customs. */
export function draftProblems(draft: CustomDraft, taken: string[]): string[] {
  const out: string[] = [];
  const name = cleanName(draft.name);
  if (!name) out.push("Name the exercise.");
  else if (name.length > MAX_NAME) {
    out.push(`Keep the name to ${MAX_NAME} characters.`);
  } else if (!NAME_OK.test(name)) {
    out.push(
      "Start with a letter and use letters, digits, spaces, hyphens, apostrophes or full stops. Commas, slashes and brackets mean something in LS++.",
    );
  } else {
    const id = customId(name);
    const clash = taken.find((t) =>
      t.toLowerCase() === name.toLowerCase() || customId(t) === id
    );
    if (clash) out.push(`${clash} is already in the list.`);
  }
  if (draft.target.length === 0) out.push("Tag at least one target muscle.");
  if (draft.synergist.length === 0) {
    out.push("Tag at least one synergist muscle.");
  }
  if (draft.target.some((m) => draft.synergist.includes(m))) {
    out.push("A muscle is either a target or a synergist, not both.");
  }
  return out;
}

const BODY_PART: Record<MuscleGroup, BodyPart> = {
  chest: "chest",
  back: "back",
  quads: "legs",
  hamstrings: "legs",
  glutes: "legs",
  calves: "legs",
  sideDelts: "shoulders",
  biceps: "arms",
  triceps: "arms",
};

/** The overlay entry for a draft that passed `draftProblems`. */
export function toCustomExercise(draft: CustomDraft): CustomExercise {
  const name = cleanName(draft.name);
  return {
    exercise: {
      id: customId(name),
      name,
      targetMuscles: [...draft.target],
      synergistMuscles: [...draft.synergist],
      bodyParts: [...new Set(draft.target.map((m) => BODY_PART[m]))],
      equipment: draft.equipment,
    },
    restClass: draft.restClass,
  };
}

/* Liftosaur's vocabulary, for the record the evaluator reads. Each Qala group
 * takes one liftosaur muscle that its screen-muscle map files under the same
 * group (the deleted TS liftoscript/src/models/muscle.ts), so liftosaur's own
 * muscle counts would land where Qala's do. */
const LIFTOSAUR_MUSCLE: Record<MuscleGroup, string> = {
  chest: "Pectoralis Major Sternal Head",
  back: "Latissimus Dorsi",
  quads: "Quadriceps",
  hamstrings: "Hamstrings",
  glutes: "Gluteus Maximus",
  sideDelts: "Deltoid Lateral",
  biceps: "Biceps Brachii",
  triceps: "Triceps Brachii",
  calves: "Gastrocnemius",
};

const LIFTOSAUR_BODY_PART: Record<MuscleGroup, string> = {
  chest: "Chest",
  back: "Back",
  quads: "Thighs",
  hamstrings: "Thighs",
  glutes: "Hips",
  calves: "Calves",
  sideDelts: "Shoulders",
  biceps: "Upper Arms",
  triceps: "Upper Arms",
};

const LIFTOSAUR_EQUIPMENT: Record<CustomEquipment, string> = {
  barbell: "barbell",
  dumbbell: "dumbbell",
  machine: "leverageMachine",
  bodyweight: "bodyweight",
};

/** Liftosaur's `ICustomExercise`, the fields Qala fills. */
export interface LiftoscriptCustomExercise {
  vtype: "custom_exercise";
  id: string;
  name: string;
  isDeleted: false;
  meta: {
    bodyParts: string[];
    targetMuscles: string[];
    synergistMuscles: string[];
    sortedEquipment: string[];
  };
  defaultEquipment: string;
}

export function toLiftoscript(c: CustomExercise): LiftoscriptCustomExercise {
  const e = c.exercise;
  const equipment = LIFTOSAUR_EQUIPMENT[e.equipment as CustomEquipment] ??
    "barbell";
  return {
    vtype: "custom_exercise",
    id: e.id,
    name: e.name,
    isDeleted: false,
    meta: {
      bodyParts: [
        ...new Set(e.targetMuscles.map((m) => LIFTOSAUR_BODY_PART[m])),
      ],
      targetMuscles: e.targetMuscles.map((m) => LIFTOSAUR_MUSCLE[m]),
      synergistMuscles: e.synergistMuscles.map((m) => LIFTOSAUR_MUSCLE[m]),
      sortedEquipment: [equipment],
    },
    defaultEquipment: equipment,
  };
}

/** Liftosaur settings (from the wasm's `settingsFromCore`) with the session's
 * custom exercises added to `exercises`, for the dry run. */
export function withCustomExercises(
  settings: unknown,
  custom: CustomExercise[],
): unknown {
  if (custom.length === 0) return settings;
  const base = settings as { exercises?: Record<string, unknown> };
  const exercises: Record<string, unknown> = { ...base.exercises };
  for (const c of custom) exercises[c.exercise.id] = toLiftoscript(c);
  return { ...base, exercises };
}

/** A one-line program that resolves only if `name` is already an exercise
 * the evaluator knows. */
export function lookupProgram(name: string): string {
  return `# Week 1\n## Day 1\n${cleanName(name)} / 1x1\n`;
}

/** Whether `name` is already one of the evaluator's built-ins. A custom
 * with a built-in's name would quietly replace it in every program, and the
 * page only carries a sample of the seed, so the evaluator is asked. null when
 * the check could not run. */
export function isBuiltIn(
  api: Pick<Lspp, "dryRun" | "settingsFromCore">,
  name: string,
): boolean | null {
  const settings = api.settingsFromCore(createBaselineDocument().settings);
  if (!settings.ok) return null;
  const r = api.dryRun({
    programText: lookupProgram(name),
    settings: settings.value,
  });
  if (r.ok) return true;
  return r.kind === "evaluation" ? false : null;
}
