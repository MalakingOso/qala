/* Rest-timer display helpers (PLAN 6.6, DESIGN 7.6). The prescription itself
 * comes from @qala/engine rest.ts; this formats the ticking figure and the
 * always-visible "why" line. */

export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatDuration(totalSec: number): string {
  const s = Math.round(totalSec);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? `${m}:00` : `${m}:${String(rest).padStart(2, "0")}`;
}

export interface RestWhy {
  base: number;
  adjustments: { label: string; seconds: number }[];
}

/** "3:45 · base 3:00, your pace -15 s, last set RPE 9 vs 8 +30 s" */
export function formatRestWhy(total: number, why: RestWhy): string {
  const parts = [`base ${formatDuration(why.base)}`];
  for (const a of why.adjustments) {
    const sign = a.seconds >= 0 ? "+" : "-";
    parts.push(`${a.label} ${sign}${formatDuration(Math.abs(a.seconds))}`);
  }
  return `${formatDuration(total)} · ${parts.join(", ")}`;
}
