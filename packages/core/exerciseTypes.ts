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

export interface ExerciseOverlay {
  hidden: string[];
  custom: Record<string, Exercise>;
  overrides: Record<string, ExerciseOverride>;
}

export function emptyOverlay(): ExerciseOverlay {
  return { hidden: [], custom: {}, overrides: {} };
}

/** Custom exercises must carry target/synergist muscle tags (PLAN section 3). */
export function isValidCustomExercise(e: Exercise): boolean {
  return e.targetMuscles.length > 0 &&
    [...e.targetMuscles, ...e.synergistMuscles].every((m) =>
      (MUSCLE_GROUPS as readonly string[]).includes(m)
    );
}

/** RP weekly-set landmarks per muscle: [lo, hi] (PLAN 6.3 table). */
export interface RpLandmarks {
  /** Maintenance volume. */
  mv: [number, number];
  /** Minimum effective volume. */
  mev: [number, number];
  /** Maximum adaptive volume. */
  mav: [number, number];
  /** Maximum recoverable volume. */
  mrv: [number, number];
}

export const RP_LANDMARKS: Record<MuscleGroup, RpLandmarks> = {
  chest: { mv: [2, 4], mev: [4, 6], mav: [6, 16], mrv: [16, 24] },
  back: { mv: [10, 12], mev: [12, 14], mav: [16, 22], mrv: [22, 30] },
  quads: { mv: [2, 4], mev: [4, 6], mav: [6, 14], mrv: [14, 18] },
  hamstrings: { mv: [0, 2], mev: [2, 4], mav: [2, 8], mrv: [8, 14] },
  glutes: { mv: [2, 6], mev: [6, 8], mav: [8, 24], mrv: [24, 30] },
  sideDelts: { mv: [2, 6], mev: [6, 8], mav: [8, 24], mrv: [24, 30] },
  biceps: { mv: [6, 8], mev: [8, 10], mav: [14, 20], mrv: [20, 26] },
  triceps: { mv: [0, 4], mev: [4, 6], mav: [6, 16], mrv: [16, 20] },
  calves: { mv: [2, 4], mev: [4, 6], mav: [6, 16], mrv: [16, 24] },
};

/** Muscles without a row use chest's numbers (PLAN 6.3). */
export function muscleLandmarks(muscle: string): RpLandmarks {
  return (RP_LANDMARKS as Record<string, RpLandmarks>)[muscle] ??
    RP_LANDMARKS.chest;
}

/** Fractional-set counting weight: direct 1.0, synergist 0.5 (B4-B5). */
export const SYNERGIST_SET_WEIGHT = 0.5;

/** Owner's fractional-set band per muscle per week (PLAN 6.3). */
export const VOLUME_BAND = {
  grow: [10, 20] as [number, number],
  emphasise: [14, 20] as [number, number],
} as const;

/**
 * Bodyweight load factors for volume load `VL_m` (PLAN 6.3; assumptions,
 * not sourced). Keyed by exercise-id fragment, lower-cased.
 */
export const BODYWEIGHT_LOAD_FACTORS: Record<string, number> = {
  "pullup": 1.0,
  "pull-up": 1.0,
  "chinup": 1.0,
  "dip": 1.0,
  "pushup": 0.65,
  "push-up": 0.65,
};

export function bodyweightFactor(exerciseId: string): number | undefined {
  const id = exerciseId.toLowerCase();
  for (const [key, factor] of Object.entries(BODYWEIGHT_LOAD_FACTORS)) {
    if (id.includes(key)) return factor;
  }
  return undefined;
}

/** Intensity-zone lower boundaries by load / reference 1RM (B5.6). */
export const INTENSITY_ZONE_BOUNDARIES = [0.7, 0.8, 0.85, 0.9] as const;

export type IntensityZone = "<70" | "70-79.9" | "80-84.9" | "85-89.9" | "90+";

export function intensityZone(loadDivRef: number): IntensityZone {
  if (loadDivRef >= 0.9) return "90+";
  if (loadDivRef >= 0.85) return "85-89.9";
  if (loadDivRef >= 0.8) return "80-84.9";
  if (loadDivRef >= 0.7) return "70-79.9";
  return "<70";
}
