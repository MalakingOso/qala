/* Running display math. Engine and document stay SI (metres, seconds, m/s);
 * the UI converts to miles and min/mi only here (PLAN 3, units decision). */

/** 542 -> "9:02". Zero pace renders as "--:--". */
export function formatPace(secPerMi: number): string {
  if (!(secPerMi > 0) || !Number.isFinite(secPerMi)) return "--:--";
  const s = Math.round(secPerMi);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
