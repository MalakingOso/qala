/** Exercise, muscle, body-part and equipment tag types plus the user overlay.
 *
 * The overlay mirrors PLAN section 3: liftosaur's exercise DB is a read-only
 * seed; each user carries custom exercises, a hidden list, and per-exercise
 * overrides. This file also carries the PLAN 6.3 / RESEARCH B4-B5 metric
 * support: canonical muscles, RP set landmarks, fractional-set counting
 * weights, bodyweight load factors and intensity-zone boundaries.
 */

export type MuscleGroup =
  | "chest"
  | "back"
  | "quads"
  | "hamstrings"
  | "glutes"
  | "sideDelts"
  | "biceps"
  | "triceps"
  | "calves";

export const MUSCLE_GROUPS: readonly MuscleGroup[] = [
  "chest",
  "back",
  "quads",
  "hamstrings",
  "glutes",
  "sideDelts",
  "biceps",
  "triceps",
  "calves",
];

/** Body parts, used to derive the rest-timer exercise class (PLAN 6.6). */
export type BodyPart =
  | "chest"
  | "back"
  | "legs"
  | "shoulders"
  | "arms"
  | "core";

/** Equipment tags. `trapBar`/`ezBar` ask for their bar once (PLAN 6.8). */
export type Equipment =
  | "barbell"
  | "dumbbell"
  | "machine"
  | "cable"
  | "bodyweight"
  | "kettlebell"
  | "band"
  | "trapBar"
  | "ezBar"
  | "other";

export type RestClass = "main" | "secondary" | "isolation";

export interface Exercise {
  id: string;
  name: string;
  targetMuscles: MuscleGroup[];
  synergistMuscles: MuscleGroup[];
  bodyParts: BodyPart[];
  equipment: Equipment;
  aliases?: string[];
}

/** Per-exercise user override (PLAN section 7, `exercises.overrides`). */
export interface ExerciseOverride {
  increment?: number;
  rounding?: number;
  /** Bar id from `settings.plates.bars`. */
  bar?: string;
  restClass?: RestClass;
}
