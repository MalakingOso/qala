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

/** Per-lift calibration and trend, the desktop stats' drill-down unit for a
 * main lift (DESIGN 7.15's calibration table, joined with the e1RM graphs). */
export interface LiftStat {
  id: string;
  name: string;
  e1rm: number;
  kalman: number;
  weekDeltaPct: number;
  recent: { label: string; e1rm: number; tested?: boolean }[];
  fullHistory: { session: number; dailyBest: number; kalman: number }[];
  nl85: { actual: number; target: number };
  calibration: { p0: number; k1: number; theta: string; obs: number };
  residuals: number[];
}

/** Per-muscle weekly volume and recovery, the drill-down unit from the sets-
 * by-muscle chart and the Body page (PLAN 6.3's fractional-set band). */
export interface MuscleStat {
  muscle: string;
  earlier: number;
  today: number;
  band: [number, number];
  weeklyHistory: number[];
  lifting: number;
  running: number;
  readyDay: string;
}

export interface RunDetail {
  distanceMi: number;
  splits: RunSplit[];
  pace: number[];
  hr: number[];
  elev: number[];
  rtss: number;
  sRpeLoad: number;
  hrStrap: boolean;
}

/** One logged session, lift or run, the unit History rows and Overview's
 * recent list link into (SessionDetailPage). Notes and `flagged` are the
 * desktop's editable surface on top of otherwise read-only stats. */
export interface SessionSummary {
  id: string;
  date: string;
  type: "lift" | "run";
  label: string;
  loadLb?: number;
  sRPE: number;
  prCount: number;
  flagged?: string;
  exercises?: { name: string; sets: string; note?: string }[];
  run?: RunDetail;
  notes: string;
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
