/* Local document model for the web shells. Mirrors the automerge shape in
 * packages/core/schema.ts (PLAN section 7) but stays bundler-local so the
 * Vite build never imports Deno-style `.ts` sources. Field names match the
 * core schema where they overlap; the sync client swaps this for the real
 * automerge document once the server shell lands. */

export type DayStageId = "checkin" | "warmup" | "lift" | "recover" | "run" | "winddown";

export interface StageState {
  id: DayStageId;
  label: string;
  time: string;
  status: "done" | "now" | "later";
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
  changeText: string;
}

export interface EnvelopeCardModel {
  id: string;
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
  plates: { weight: number; pairs: number | "enough" }[];
  collarWeight: number;
  equipment: { foamRoller: boolean; percussion: boolean; bike: boolean; rower: boolean; treadmill: boolean };
  warmup: { enabled: boolean; softTissue: boolean; preferPercussion: boolean; minutes: number };
  rest: { auto: boolean; learnFromTaps: boolean; showNextPlates: boolean; alert: string };
  run: { audioCues: boolean; autoPause: boolean; hrStrap: boolean; offlineMaps: boolean };
  coach: { status: string; limits: string };
}
