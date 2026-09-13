/* Local document model for the web shells. Mirrors the automerge shape in
 * packages/core/schema.ts (PLAN section 7); field names match the core
 * schema where they overlap. `PlateEntry` is imported directly rather than
 * duplicated: it's plain portable TypeScript (no bare/jsr specifiers), so
 * there's nothing bundler-unfriendly about importing it here. This model
 * as a whole gets replaced by the real automerge document once the client
 * sync layer is built (see the report). */

import type { PlateEntry } from "../../../../packages/core/plates.ts";

export type DayStageId =
  | "checkin"
  | "warmup"
  | "lift"
  | "recover"
  | "run"
  | "winddown";

export interface StageState {
  id: DayStageId;
  label: string;
  time: string;
  status: "done" | "now" | "later";
}

/** A rest day has no lift or run stage (DECISIONS U10): check-in, recover, wind down only. */
export function isRestDay(stages: StageState[]): boolean {
  return !stages.some((s) => s.id === "lift" || s.id === "run");
}

export interface WeekLoadDay {
  day: string;
  liftDone: number;
  runDone: number;
  liftPlanned: number;
  runPlanned: number;
  today?: boolean;
  label?: string;
}

export interface WorkoutSet {
  w: number;
  r: number;
  rpe?: number;
  done: boolean;
  warmup?: boolean;
}

export interface ExerciseNoteModel {
  id: string;
  date: string;
  text: string;
  pinned: boolean;
}

export interface WorkoutExercise {
  id: string;
  name: string;
  sets: WorkoutSet[];
  lastTime?: string;
  targetRpe?: number;
  note?: ExerciseNoteModel | null;
}

export interface RestPrescription {
  seconds: number;
  base: number;
  adjustments: { label: string; seconds: number }[];
  nextLoad: number;
  platesNow: number[];
  platesNext: number[];
}

export interface EnvelopeCardModel {
  id: string;
  /** The exercise this envelope's proposal applies to, e.g. for WorkoutPage. */
  exerciseId: string;
  title: string;
  engine: string;
  coach: string;
  reason: string;
  platesPerSide?: string;
  accepted: boolean | null;
}

export interface MemoryProposal {
  id: string;
  text: string;
  source: string;
  date: string;
  accepted: boolean | null;
}

export interface RunSplit {
  mile: number;
  sec: number;
}

export interface SettingsModel {
  units: { weight: "lb"; distance: "mi" };
  theme: "light" | "dark" | "system";
  titleFont: "qalaTest" | "faustina";
  defaultBar: number;
  /** `@qala/core`'s plate type: the plate calculator uses its real math directly. */
  plates: PlateEntry[];
  collarWeight: number;
  equipment: {
    foamRoller: boolean;
    percussion: boolean;
    bike: boolean;
    rower: boolean;
    treadmill: boolean;
  };
  warmup: {
    enabled: boolean;
    softTissue: boolean;
    preferPercussion: boolean;
    minutes: number;
  };
  rest: {
    auto: boolean;
    learnFromTaps: boolean;
    showNextPlates: boolean;
    alert: string;
  };
  run: {
    audioCues: boolean;
    autoPause: boolean;
    hrStrap: boolean;
    offlineMaps: boolean;
  };
  coach: { status: string; limits: string };
}
