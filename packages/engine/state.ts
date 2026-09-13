// EngineState types (PLAN 6.2, 6.4, 7). Pure data, no DOM, no automerge.

export type Approach = "strength" | "hypertrophy" | "maintenance";
export type MuscleId = string;

/** Default main lifts (PLAN 3/15, user-editable via state.mainLifts). */
export const DEFAULT_MAIN_LIFTS = ["squat", "bench", "deadlift", "ohp"];

/** Lower-body lifts affected by the cross-modal run-before-lift rules. */
export const LOWER_BODY_PATTERNS = [
  "squat",
  "deadlift",
  "lunge",
  "legpress",
  "leg-press",
  "leg_press",
];

export function isLowerBodyLift(exerciseId: string): boolean {
  const id = exerciseId.toLowerCase();
  return LOWER_BODY_PATTERNS.some((p) => id.includes(p));
}

export interface SetLog {
  w: number; // load (user weight unit; consistent within a block)
  r: number; // reps completed
  rpe?: number; // logged RPE (RIR scale: 10 = 0 RIR)
  targetRpe?: number; // program target RPE (top of range)
  targetRepsMin?: number;
  targetRepsMax?: number;
  completed: boolean;
  warmup?: boolean;
  tested1rm?: boolean; // flagged test or meet attempt
  jointPain?: boolean;
}

export interface LiftEntry {
  exerciseId: string;
  targets: MuscleId[];
  synergists?: MuscleId[];
  sets: SetLog[];
  isMain?: boolean;
}

export interface Checkin {
  prs: number; // 0-10
  soreness: Record<string, 1 | 2 | 3 | 4>; // RP 4-point per muscle
}

export interface LiftWorkout {
  kind: "lift";
  id: string;
  date: string; // ISO 8601
  entries: LiftEntry[];
  checkin?: Checkin;
  perf?: Record<string, 1 | 2 | 3 | 4>; // post-muscle-group performance taps
  srpe?: number; // session RPE CR-10
  minutes?: number;
}

export interface RunWorkout {
  kind: "run";
  id: string;
  /** ISO 8601, the run's START. Compute the end as `date + movingSec`. */
  date: string;
  distanceM: number;
  movingSec: number;
  elapsedSec: number;
  /** Mean grade profile as {grade fraction, meters} segments; flat when absent. */
  gradeProfile?: { grade: number; meters: number }[];
  /** Total metres descended on grades steeper than -5% (0 when unknown). */
  descentM?: number;
  srpe?: number;
  minutes?: number;
  /** Banister TRIMP when HR was recorded (optional). */
  hrTrimp?: number;
}

export type Workout = LiftWorkout | RunWorkout;

export interface KalmanState {
  p0: number;
  k1: number;
  k2: number;
  thetaPrior: number;
  P: number[][];
  obs: number;
  /** Observation variance for a normal e1RM observation. */
  R: number;
}

export interface BestEffort {
  distanceM: number;
  seconds: number;
  date: string;
}

export interface EngineState {
  updated: string; // ISO timestamp of last applied input
  mainLifts: string[];
  fitness: Record<string, number>; // F_l per lift, tau 45 d
  fatigueMuscle: Record<string, number>; // G_m
  fatigueDamage: Record<string, number>; // D_m, tau 5 d
  fatigueSystemic: number; // G_s, tau 10 d
  fitnessRun: number; // F_run, tau 42 d
  kalman: Record<string, KalmanState>;
  kalmanRun: KalmanState;
  /** Running-derived fatigue only (for runFatigueHold rule). */
  runFatigueMuscle: Record<string, number>;
  runFatigueDamage: Record<string, number>;
  bestEfforts: BestEffort[]; // for CS, last 90 d window applied at read time
  prsHistory: { date: string; value: number }[];
  dailyLoad: { date: string; load: number }[]; // sRPE-load per day (lifting + running)
  liftSessions: {
    date: string;
    quadSetEq: number;
    heavyLower: boolean;
    srpe?: number;
  }[];
  e1rmObs: Record<string, { date: string; value: number }[]>;
  runs: {
    date: string;
    distanceM: number;
    movingSec: number;
    descentM: number;
    z: number;
  }[];
  srpeRtssPairs: { srpeLoad: number; rTSS: number }[];
  referenceRm: Record<
    string,
    { weight: number; date: string; source: "kalman" | "tested" }
  >;
  restProfile: {
    byClass: Record<string, { m: number; samples: number }>;
    byExercise: Record<string, { m: number; samples: number }>;
  };
  lastCheckin?: Checkin & { date: string };
  lastRun?: { date: string; minutes: number; distanceM: number; z: number };
  sorenessPrev?: Record<string, number>;
  sorenessPrevPrev?: Record<string, number>;
  jointPainLog: { date: string; exerciseId: string }[];
  injuries: { date: string; area: string; kind: "lifting" | "running" }[];
  hybridPriority: "lifting" | "running";
}

export function initialState(
  mainLifts: string[] = DEFAULT_MAIN_LIFTS,
): EngineState {
  return {
    updated: new Date(0).toISOString(),
    mainLifts: [...mainLifts],
    fitness: {},
    fatigueMuscle: {},
    fatigueDamage: {},
    fatigueSystemic: 0,
    fitnessRun: 0,
    kalman: {},
    kalmanRun: {
      p0: 40,
      k1: 1,
      k2: 2,
      thetaPrior: 2,
      P: [[1e4, 0, 0], [0, 1e3, 0], [0, 0, 1]],
      obs: 0,
      R: 1,
    },
    runFatigueMuscle: {},
    runFatigueDamage: {},
    bestEfforts: [],
    prsHistory: [],
    dailyLoad: [],
    liftSessions: [],
    e1rmObs: {},
    runs: [],
    srpeRtssPairs: [],
    referenceRm: {},
    restProfile: { byClass: {}, byExercise: {} },
    jointPainLog: [],
    injuries: [],
    hybridPriority: "lifting",
  };
}
