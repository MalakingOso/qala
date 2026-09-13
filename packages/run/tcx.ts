// TCX exporter: one Lap per workout step (each repeat its own Lap), or one
// Lap per split, or a single Lap for a bare run. No FIT (see gpx.ts).

import type { Split } from "./types.ts";
import type { StepSummary } from "./guided.ts";

export interface TcxLap {
  /** Epoch milliseconds of the lap start. */
  startTimeMs: number;
  totalTimeSec: number;
  distanceM: number;
  intensity: "Active" | "Rest";
  avgHr?: number;
  maxHr?: number;
  avgCad?: number;
  notes?: string;
}

export interface TcxOptions {
  startTimeMs: number;
  laps: TcxLap[];
  sport?: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function lapXml(lap: TcxLap): string {
  const start = new Date(lap.startTimeMs).toISOString();
  return `    <Lap StartTime="${start}">` +
    `<TotalTimeSeconds>${lap.totalTimeSec.toFixed(1)}</TotalTimeSeconds>` +
    `<DistanceMeters>${lap.distanceM.toFixed(1)}</DistanceMeters>` +
    (lap.avgHr !== undefined
      ? `<AverageHeartRateBpm><Value>${
        Math.round(lap.avgHr)
      }</Value></AverageHeartRateBpm>`
      : "") +
    (lap.maxHr !== undefined
      ? `<MaximumHeartRateBpm><Value>${
        Math.round(lap.maxHr)
      }</Value></MaximumHeartRateBpm>`
      : "") +
    `<Intensity>${lap.intensity}</Intensity>` +
    `<TriggerMethod>Manual</TriggerMethod>` +
    (lap.notes !== undefined ? `<Notes>${esc(lap.notes)}</Notes>` : "") +
    `</Lap>`;
}

/** Serialise laps to a TCX (TrainingCenterDatabase v2) string. */
export function exportRunTcx(opts: TcxOptions): string {
  const id = new Date(opts.startTimeMs).toISOString();
  const laps = opts.laps.map(lapXml).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">\n` +
    `  <Activities>\n` +
    `    <Activity Sport="${esc(opts.sport ?? "Running")}">\n` +
    `      <Id>${id}</Id>\n${laps}\n` +
    `    </Activity>\n` +
    `  </Activities>\n` +
    `</TrainingCenterDatabase>`;
}

/**
 * One Lap per guided step occurrence. recover steps map to Rest intensity,
 * everything else to Active. Times are run-clock seconds plus the epoch
 * origin; distances are measured step distances.
 */
export function workoutLaps(
  summaries: StepSummary[],
  startTimeMs: number,
  t0: number,
): TcxLap[] {
  return summaries.map((s) => ({
    startTimeMs: startTimeMs + (t0 + s.startTimeSec) * 1000,
    totalTimeSec: Math.max(0, s.endTimeSec - s.startTimeSec),
    distanceM: Math.max(0, s.endDistM - s.startDistM),
    intensity: s.step.kind === "recover" ? "Rest" : "Active",
    notes: s.step.kind,
  }));
}

/** One Lap per split, for runs recorded without a workout. */
export function splitsToLaps(
  splits: Split[],
  startTimeMs: number,
  t0: number,
): TcxLap[] {
  return splits.map((s) => {
    const startCum = s.cumSec - s.sec;
    const lap: TcxLap = {
      startTimeMs: startTimeMs + (t0 + startCum) * 1000,
      totalTimeSec: s.sec,
      distanceM: s.distM,
      intensity: "Active",
    };
    if (s.hrAvg !== undefined) {
      lap.avgHr = s.hrAvg;
      lap.maxHr = s.hrAvg;
    }
    return lap;
  });
}
