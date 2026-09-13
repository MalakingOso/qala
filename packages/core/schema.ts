/** User-document shape (PLAN section 7, `packages/core` document shape).
 *
 * One automerge document per user. Running data is stored in SI (metres,
 * seconds, m/s); lifting weights are `{ value, unit }` passthrough.
 */

import type { PlateInventory } from "./plates.ts";
import type { ExerciseOverlay } from "./exerciseTypes.ts";
import type { DistanceUnit, WeightUnit, WeightValue } from "./units.ts";

export type Theme = "light" | "dark" | "system";
export type TitleFont = "qalaTest" | "faustina";
export type Approach = "strength" | "hypertrophy" | "maintenance";
export type Periodization = "linear" | "dup" | "block";
export type HybridPriority = "lifting" | "running";

export interface RunSettings {
  hrMax?: number;
  hrRest?: number;
  audioCueEvery: {
    /** In `settings.units.distance`. */
    distance?: 0.5 | 1;
    minutes?: number;
  };
  autoPause: boolean;
  mapRegion: string;
  recentRace?: { distanceM: number; seconds: number; date: string };
}

export interface Injury {
  date: string;
  area: string;
  kind: "lifting" | "running";
  resolved?: boolean;
}

export interface WarmupSettings {
  enabled: boolean;
  softTissue: boolean;
  /** Owner preference: move allowed muscles to percussion (PLAN 6.7). */
  preferPercussion: boolean;
  minutes: number;
}

export interface RestSettings {
  auto: boolean;
  learnFromTaps: boolean;
  showNextPlates: boolean;
  alert: "vibrate+sound" | "vibrate" | "sound" | "none";
}

export interface Settings {
  units: { weight: WeightUnit; distance: DistanceUnit };
  barbellStep: number;
  dumbbellStep: number;
  mainLifts: string[];
  theme: Theme;
  dailyWellness: boolean;
  run: RunSettings;
  hybridPriority: HybridPriority;
  injuries: Injury[];
  /** PLAN 6.8; the owner's real inventory is still to enter. */
  plates: PlateInventory;
  /** PLAN 6.7. */
  warmup: WarmupSettings;
  /** PLAN 6.6. */
  rest: RestSettings;
  /** DESIGN 3.3. */
  titleFont: TitleFont;
}

export interface ExerciseNote {
  id: string;
  date: string;
  sessionId: string;
  text: string;
  showNext: boolean;
  pinned: boolean;
  resolved: boolean;
}

export interface EquipmentState {
  recovery: string[];
  cardio: Array<"bike" | "rower" | "treadmill" | "jumpRope" | "outdoor">;
  gym: string[];
}

/** PLAN 6.6 multiplier; per-exercise m takes over after 20 rests. */
export interface RestProfile {
  byClass: Record<string, { m: number; samples: number }>;
  byExercise: Record<string, { m: number; samples: number }>;
}

export interface ReferenceRm {
  weight: WeightValue;
  date: string;
  source: "kalman" | "tested";
}

export interface Program {
  name: string;
  text: string;
  state: unknown;
  approach: Approach;
  periodization: Periodization;
  /** Reference 1RM fixed per block (PLAN 6.3). */
  referenceRm: Record<string, ReferenceRm>;
}

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
  hrZone?: string;
  repeat?: number;
}

export interface RunWorkout {
  type: RunWorkoutType;
  steps: RunStep[];
}

export interface RunPlanDay {
  dayOfWeek: number;
  workout: RunWorkout;
}

export interface RunPlan {
  name: string;
  goal: {
    kind: "distance" | "race" | "base";
    raceDate?: string;
    raceDistanceM?: number;
    targetSec?: number;
  };
  weeks: Array<{ days: RunPlanDay[] }>;
}

export interface LiftSet {
  w: WeightValue;
  r: number;
  rpe?: number;
  completed: boolean;
  note?: string;
  jointPain?: boolean;
  tested1rm?: boolean;
  warmup?: boolean;
  restPrescribedSec?: number;
  restActualSec?: number;
  restReasons?: string[];
}

export interface LiftEntry {
  exerciseId: string;
  sets: LiftSet[];
}

export interface WarmupBlockItem {
  name: string;
  tool?: string;
  muscle?: string;
  seconds?: number;
  reps?: number;
}

export interface WarmupLog {
  blocks: Array<{
    kind: "general" | "softTissue" | "mobility";
    items: WarmupBlockItem[];
    done: boolean;
  }>;
  skipped?: boolean;
}

export interface LiftSession {
  id: string;
  kind: "lift";
  date: string;
  programId: string;
  day: string;
  entries: LiftEntry[];
  warmup?: WarmupLog;
  /** Actual order when done out of plan order. */
  exerciseOrder?: string[];
  checkin: {
    prs: number;
    soreness: Record<string, 1 | 2 | 3 | 4>;
    text: string;
    parsed?: unknown;
  };
  perf: Record<string, 1 | 2 | 3 | 4>;
  srpe: number;
  minutes: number;
}

export interface RunSplit {
  index: number;
  distM: number;
  sec: number;
  gapSec: number;
  elevGainM: number;
  hr?: number;
}

export interface RunSession {
  id: string;
  kind: "run";
  date: string;
  runPlanId?: string;
  workout?: RunWorkout;
  checkin?: unknown;
  /** Columnar delta-encoded arrays, not per-point objects. */
  track: {
    encoding: "delta-v1";
    t: number[];
    lat: number[];
    lon: number[];
    alt: number[];
    acc: number[];
    hr?: number[];
  };
  /** All SI; the UI converts. */
  distanceM: number;
  movingSec: number;
  elapsedSec: number;
  elevGainM: number;
  elevLossM: number;
  gapSpeedMps: number;
  rTSS?: number;
  cadence?: number;
  /** Boundaries at each unit of `settings.units.distance` when recorded. */
  splits: RunSplit[];
  hrAvg?: number;
  hrMax?: number;
  trimp?: number;
  srpe: number;
  minutes: number;
  notes: string;
}

export type HistorySession = LiftSession | RunSession;

export interface EngineSnapshot {
  date: string;
  /** Derived cache, rebuildable from history. */
  state: unknown;
}

export interface CoachMemoryEntry {
  id: string;
  date: string;
  source: "user" | "gemma" | "engine";
  text: string;
  accepted: boolean;
}

export interface LlmLogEntry {
  date: string;
  kind: string;
  promptHash: string;
  output: string;
  accepted: boolean;
}

export interface QalaDocument {
  schemaVersion: number;
  settings: Settings;
  exercises: ExerciseOverlay;
  exerciseNotes: Record<string, ExerciseNote[]>;
  equipment: EquipmentState;
  restProfile: RestProfile;
  programs: Record<string, Program>;
  activeProgramId: string;
  runPlans: Record<string, RunPlan>;
  activeRunPlanId: string;
  history: HistorySession[];
  engineSnapshots: EngineSnapshot[];
  coachMemory: CoachMemoryEntry[];
  llmLog: LlmLogEntry[];
}
