/* Running display math. Engine and document stay SI (metres, seconds, m/s);
 * the UI converts to miles and min/mi only here (PLAN 3, units decision). */

export const MILE_M = 1609.344;

export function mToMi(m: number): number {
  return m / MILE_M;
}

export function mpsToPaceSecPerMi(mps: number): number {
  if (!(mps > 0)) return 0;
  return MILE_M / mps;
}

/** 542 -> "9:02". Zero pace renders as "--:--". */
export function formatPace(secPerMi: number): string {
  if (!(secPerMi > 0) || !Number.isFinite(secPerMi)) return "--:--";
  const s = Math.round(secPerMi);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 3720 -> "1:02:00", 320 -> "5:20". */
export function formatElapsed(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** Average pace over the moving window: distance / moving time. */
export function avgPace(distanceM: number, movingSec: number): number {
  if (distanceM <= 0 || movingSec <= 0) return 0;
  return movingSec / mToMi(distanceM);
}

/** Audio-cue label: "Mile 2, 9:04 pace, 18:12 total". */
export function cueLabel(
  mile: number,
  pace: number,
  elapsedSec: number,
): string {
  return `Mile ${mile}, ${formatPace(pace)} pace, ${
    formatElapsed(elapsedSec)
  } total`;
}
