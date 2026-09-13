/* Readiness-ring geometry (DESIGN 6.4). Pure math; the component draws it.
 * readiness 0-1, average over the 28-day window, low line at mean - 1.5 SD
 * (50 until 14 check-ins exist). PRS <= 4 counts as low whatever the number. */

export interface RingModel {
  /** 0-100 display value. */
  value: number;
  /** Fraction of the full circle for the value arc. */
  valueFrac: number;
  /** Fraction where the 28-day average tick sits, null while hidden. */
  avgFrac: number | null;
  /** Fraction where the low-line tick sits. */
  lowFrac: number;
  low: boolean;
  legendAvg: string;
  legendLow: string;
}

export function readinessRing(
  readiness: number,
  avg: number | null,
  lowLine: number,
  checkins: number,
  prs?: number,
): RingModel {
  const value = Math.round(readiness * 100);
  const low = prs !== undefined ? prs <= 4 || value < lowLine : value < lowLine;
  const settled = checkins >= 14;
  return {
    value,
    valueFrac: Math.min(1, Math.max(0, value / 100)),
    avgFrac: settled && avg !== null ? avg / 100 : null,
    lowFrac: (settled ? lowLine : 50) / 100,
    low,
    legendAvg: settled && avg !== null ? `your avg ${Math.round(avg)}` : "avg needs 14 check-ins",
    legendLow: `low under ${settled ? Math.round(lowLine) : 50}`,
  };
}
