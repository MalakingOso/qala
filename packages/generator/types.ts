// Shared input/output types for the program generator.
// NOTE: packages/core and packages/engine are built by sibling workers. To stay
// runnable standalone, this package defines the small slice it needs and cites
// the source: goal/approach/periodization vocab from PLAN.md 3/12, RunWorkout
// shape from PLAN.md 7, volume landmarks from PLAN.md 6.3. If core later exports
// these, re-export from there instead of duplicating.

export type GoalKind =
  | "hypertrophy"
  | "strength"
  | "meetPrep"
  | "athleticMaintenance";

export type Experience = "beginner" | "intermediate" | "advanced";

// PLAN.md 12: advanced lifters may pick high-frequency (3-5x, lower per-session
// volume) or low-frequency (1-2x, higher per-session volume) alternatives.
export type AdvancedFrequency = "default" | "high" | "low";

export type Priority = "emphasise" | "grow" | "maintain";

export type Approach = "strength" | "hypertrophy" | "maintenance";

export type Periodization = "linear" | "dup" | "block";

export type DupScheme = "hps" | "5-3-1";

// Canonical volume muscles from PLAN.md 6.3. Muscles without an RP row
// (frontDelts, rearDelts, abs, lowerBack, forearms, ... ) use chest's numbers.
export type MuscleGroup =
  | "chest"
  | "back"
  | "quads"
  | "hamstrings"
  | "glutes"
  | "sideDelts"
  | "biceps"
  | "triceps"
  | "calves"
  | "frontDelts"
  | "rearDelts"
  | "abs"
  | "lowerBack"
  | "forearms";

// PLAN.md 12 slot programming types (Evolve structure, expert/product practice).
export type SlotKind = "strength" | "accessoryLow" | "accessoryHigh";

export type ExerciseClass = "main" | "secondary" | "isolation";

export interface MuscleTags {
  target: MuscleGroup[];
  synergist: MuscleGroup[];
}

export interface CatalogExercise {
  id: string;
  name: string;
  equipment: string[];
  muscles: MuscleTags;
  klass: ExerciseClass;
  compound: boolean;
  mainLift?: boolean;
  lowerBody?: boolean;
  variationsOf?: string;
}

// Minimal tagged exercise DB. The full 422-entry liftosaur seed lives in
// packages/core (PLAN.md 5/9); this catalog carries the lifts the generator
// plans so volume counting has target/synergist tags without that dependency.
export const EXERCISE_CATALOG: CatalogExercise[] = [
  {
    id: "squat",
    name: "Squat",
    equipment: ["barbell", "rack"],
    muscles: { target: ["quads"], synergist: ["glutes", "hamstrings", "calves"] },
    klass: "main",
    compound: true,
    mainLift: true,
    lowerBody: true,
  },
  {
    id: "bench",
    name: "Bench Press",
    equipment: ["barbell", "bench"],
    muscles: { target: ["chest"], synergist: ["triceps", "frontDelts"] },
    klass: "main",
    compound: true,
    mainLift: true,
  },
  {
    id: "deadlift",
    name: "Deadlift",
    equipment: ["barbell"],
    muscles: { target: ["glutes"], synergist: ["hamstrings", "back", "quads", "forearms"] },
    klass: "main",
    compound: true,
    mainLift: true,
    lowerBody: true,
  },
  {
    id: "ohp",
    name: "Overhead Press",
    equipment: ["barbell"],
    muscles: { target: ["frontDelts"], synergist: ["triceps"] },
    klass: "main",
    compound: true,
    mainLift: true,
  },
  {
    id: "pauseSquat",
    name: "Pause Squat",
    equipment: ["barbell", "rack"],
    muscles: { target: ["quads"], synergist: ["glutes", "hamstrings"] },
    klass: "secondary",
    compound: true,
    lowerBody: true,
    variationsOf: "squat",
  },
  {
    id: "closeGripBench",
    name: "Close-Grip Bench",
    equipment: ["barbell", "bench"],
    muscles: { target: ["triceps"], synergist: ["chest", "frontDelts"] },
    klass: "secondary",
    compound: true,
    variationsOf: "bench",
  },
  {
    id: "rdl",
    name: "Romanian Deadlift",
    equipment: ["barbell"],
    // Dual prime movers (PLAN.md 6.3 counts direct sets per target muscle;
    // the hinge credits both, which is also what lifts glutes to MEV).
    muscles: { target: ["hamstrings", "glutes"], synergist: ["lowerBack"] },
    klass: "secondary",
    compound: true,
    lowerBody: true,
    variationsOf: "deadlift",
  },
  {
    id: "row",
    name: "Barbell Row",
    equipment: ["barbell"],
    muscles: { target: ["back"], synergist: ["biceps"] },
    klass: "secondary",
    compound: true,
  },
  {
    id: "pullup",
    name: "Pull-Up",
    equipment: ["pullupBar"],
    muscles: { target: ["back"], synergist: ["biceps", "forearms"] },
    klass: "secondary",
    compound: true,
  },
  {
    id: "legPress",
    name: "Leg Press",
    equipment: ["machine"],
    muscles: { target: ["quads"], synergist: ["glutes"] },
    klass: "secondary",
    compound: true,
    lowerBody: true,
  },
  {
    id: "lunge",
    name: "Lunge",
    equipment: ["dumbbell"],
    muscles: { target: ["quads"], synergist: ["glutes"] },
    klass: "secondary",
    compound: true,
    lowerBody: true,
  },
  {
    id: "hipThrust",
    name: "Hip Thrust",
    equipment: ["barbell", "bench"],
    muscles: { target: ["glutes"], synergist: ["hamstrings"] },
    klass: "secondary",
    compound: true,
    lowerBody: true,
  },
  {
    id: "inclineDb",
    name: "Incline Dumbbell Press",
    equipment: ["dumbbell", "bench"],
    muscles: { target: ["chest"], synergist: ["triceps", "frontDelts"] },
    klass: "secondary",
    compound: true,
  },
  {
    id: "lateralRaise",
    name: "Lateral Raise",
    equipment: ["dumbbell"],
    muscles: { target: ["sideDelts"], synergist: [] },
    klass: "isolation",
    compound: false,
  },
  {
    id: "curl",
    name: "Biceps Curl",
    equipment: ["dumbbell"],
    muscles: { target: ["biceps"], synergist: [] },
    klass: "isolation",
    compound: false,
  },
  {
    id: "pushdown",
    name: "Triceps Pushdown",
    equipment: ["cable"],
    muscles: { target: ["triceps"], synergist: [] },
    klass: "isolation",
    compound: false,
  },
  {
    id: "calfRaise",
    name: "Calf Raise",
    equipment: ["machine"],
    muscles: { target: ["calves"], synergist: [] },
    klass: "isolation",
    compound: false,
  },
  {
    id: "legCurl",
    name: "Leg Curl",
    equipment: ["machine"],
    muscles: { target: ["hamstrings"], synergist: [] },
    klass: "isolation",
    compound: false,
    lowerBody: true,
  },
  {
    id: "facePull",
    name: "Face Pull",
    equipment: ["cable"],
    muscles: { target: ["rearDelts"], synergist: ["biceps"] },
    klass: "isolation",
    compound: false,
  },
];

export function catalogById(id: string): CatalogExercise {
  const found = EXERCISE_CATALOG.find((e) => e.id === id);
  if (!found) throw new Error(`unknown exercise: ${id}`);
  return found;
}

export interface GeneratorInput {
  goal: GoalKind;
  daysPerWeek: number; // 2-6
  sessionMinutes: number;
  experience: Experience;
  equipment: string[];
  priorities: Partial<Record<MuscleGroup, Priority>>;
  exclusions: string[]; // exercise ids or injury tags to skip
  blockWeeks: number; // 4-6, last week is a deload
  referenceRm: Record<string, number>; // exerciseId -> block reference 1RM (PLAN.md 6.3)
  meetDate?: string; // ISO date, required for meetPrep
  periodization?: Periodization; // user override; default chosen by goal/experience
  dupScheme?: DupScheme;
  advancedFrequency?: AdvancedFrequency;
  startDate?: string; // ISO date of week 1 day 1; defaults to next Monday
}

export interface PlannedExercise {
  exerciseId: string;
  name: string;
  sets: number;
  repsLow: number;
  repsHigh: number;
  loadPct: number; // % of block reference 1RM
  load?: number; // resolved, plate-rounded weight
  rpe: number;
  slot: SlotKind;
  klass: ExerciseClass;
  mainLift: boolean;
  lowerBody: boolean;
  muscles: MuscleTags;
  progression: "double" | "percent" | "rpeAuto";
}

export interface DayPlan {
  label: string;
  focus: string;
  lowerBody: boolean;
  heavyLower: boolean;
  exercises: PlannedExercise[];
}

export interface BlockWeek {
  week: number;
  deload: boolean;
  days: DayPlan[];
}

// Reason codes are enumerated so the LLM/UI can narrate them (PLAN.md 6.3).
export const VOLUME_CAPPED_BY_MRV = "VOLUME_CAPPED_BY_MRV";

export interface BlockDef {
  name: string;
  goal: GoalKind;
  approach: Approach;
  periodization: Periodization;
  blockWeeks: number;
  weeks: BlockWeek[];
  reasonCodes: string[];
}

// Typed run plan entries. Shape mirrors the runPlans doc schema in PLAN.md 7;
// runs are never liftoscript (PLAN.md 3, Run plan representation).
export type RunWorkoutType =
  | "easy"
  | "long"
  | "tempo"
  | "intervals"
  | "surges"
  | "recovery"
  | "race";

export interface RunStep {
  kind: "warmup" | "work" | "recover" | "cooldown";
  distanceM?: number;
  seconds?: number;
  paceZone?: string;
  repeat?: number;
}

export interface RunWorkout {
  type: RunWorkoutType;
  steps: RunStep[];
  targetMin: number;
  targetKm: number;
  hard: boolean;
}

export interface RunPlanDay {
  dayOfWeek: number; // 0 Sunday .. 6 Saturday
  workout: RunWorkout;
}

export interface RunPlanWeek {
  week: number;
  downWeek: boolean;
  taperWeek: boolean;
  days: RunPlanDay[];
}

export interface RunPlan {
  name: string;
  goal: string;
  weeks: RunPlanWeek[];
}
