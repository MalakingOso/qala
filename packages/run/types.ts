// Shared types for @qala/run. Pure TypeScript: no DOM, no Capacitor imports.
//
// Conventions (PLAN.md sections 6.4, 7, 8a):
// - Distances in metres, times in seconds, speeds in m/s. The UI converts to
//   miles and min/mi from settings.units.distance.
// - Fix.t is seconds on a monotonic clock owned by the fix source (the
//   plugin's location timestamp), never callback wall-clock time, so batched
//   late delivery after screen lock gives identical results to on-time
//   delivery. Exporters take an explicit startTimeMs epoch origin.

/** One raw GPS fix as captured. Stored as captured; every derived number is recomputable. */
export interface Fix {
  /** Seconds. The fix's own timestamp, not Date.now() at callback time. */
  t: number;
  /** Degrees. */
  lat: number;
  /** Degrees. */
  lon: number;
  /** Horizontal accuracy in metres (Android 68% radius, used as 1-sigma). */
  acc: number;
  /** Beats per minute, when a strap is connected. */
  hr?: number;
  /** Steps per minute, when available. */
  cad?: number;
  /** Metres above ellipsoid. Recorded only; gain comes from the server DEM. */
  ele?: number;
}

export type WorkoutStepKind = "warmup" | "work" | "recover" | "cooldown";

export interface WorkoutStep {
  kind: WorkoutStepKind;
  /** Step ends after covering this distance (first of distance/seconds wins). */
  distanceM?: number;
  /** Step ends after this many seconds on the run clock (moving time). */
  seconds?: number;
  /** Centre of the pace zone in m/s, when the step has a pace target. */
  targetMps?: number;
  /** Slow edge of the pace zone in m/s. */
  paceLoMps?: number;
  /** Fast edge of the pace zone in m/s. */
  paceHiMps?: number;
  /** Target HR zone number, when the step is HR-guided. */
  hrZone?: number;
  /**
   * Execute this step this many times in a row (default 1). Repeats expand
   * per step, in place; there are no group repeats in v1, so an intervals
   * block is written work, recover, work, recover... or work xN is N back to
   * back work bouts. Each repetition becomes its own TCX Lap.
   */
  repeat?: number;
}

export type RunWorkoutType =
  | "easy"
  | "long"
  | "tempo"
  | "intervals"
  | "surges"
  | "recovery"
  | "race";

/** Typed run workout. Lives in runPlans, never in liftoscript (PLAN.md 3). */
export interface RunWorkout {
  type: RunWorkoutType;
  steps: WorkoutStep[];
  name?: string;
}

/** One split boundary crossing. Boundaries sit at each multiple of the split unit. */
export interface Split {
  /** 1-based split number. */
  index: number;
  /** Length of this split in metres (split unit, except a trailing partial). */
  distM: number;
  /** Duration of this split in seconds. */
  sec: number;
  /** Cumulative distance at this boundary in metres. */
  cumDistM: number;
  /** Elapsed seconds from the first fix to this boundary. */
  cumSec: number;
  /** Mean HR over the split, when HR samples exist. */
  hrAvg?: number;
}

/** One accepted fix after filtering, with cumulative Vincenty distance. */
export interface FilteredPoint {
  t: number;
  lat: number;
  lon: number;
  /** Filtered speed in m/s (Kalman velocity magnitude). */
  speedMps: number;
  /** Cumulative filtered distance in metres. */
  distM: number;
  /** Horizontal accuracy of the raw fix that produced this point. */
  acc: number;
  hr?: number;
  cad?: number;
  ele?: number;
  /**
   * True when the segment from the previous point spans a re-anchor jump and
   * its distance was NOT counted (the jump is not running).
   */
  gap?: boolean;
}

/** One auto-paused interval on the fix clock. */
export interface PauseInterval {
  startT: number;
  endT: number;
}

/** Processed run: everything the Live, Summary and engine-handoff need. */
export interface Run {
  /** Total filtered distance in metres (includes paused drift, if any). */
  distanceM: number;
  /** Seconds excluding paused intervals. */
  movingSec: number;
  /** Seconds from first to last accepted fix, pauses included. */
  elapsedSec: number;
  /** Mean speed over moving time in m/s. */
  avgSpeedMps: number;
  /** 20 s window speed at the last fix, null when the window is too short. */
  currentSpeedMps: number | null;
  /** 30 s window speed at the last fix, null when the window is too short. */
  cueSpeedMps: number | null;
  splits: Split[];
  paused: PauseInterval[];
  points: FilteredPoint[];
}
