// RTS/Tuchscherer %1RM by reps and RPE (PLAN 6.2, RESEARCH-design-and-programming.md B2).
//
// PROVENANCE WARNING (PLAN 6.2 rule): this table is a third-party reproduction
// (via a vbtcoach reproduction) NOT checked against RTS's original. Its
// 6 reps @ RPE 10 = 83.7% agrees with Helms 2016 ("83% is about a 6RM").
// Before shipping, spot-check every other row against a second source and use
// e1RM rule 3 (Epley fallback) for any cell that disagrees by more than
// 1 point. Until then EVERY cell below is UNVERIFIED.

export const RTS_VERIFICATION_STATUS =
  "unverified-third-party-reproduction" as const;

/** Cells that failed the 1-point spot-check and must use rule 3 instead.
 *  Empty until the pre-ship check is done; rtsPct() consults it. */
export const RTS_FLAGGED_CELLS: ReadonlySet<string> = new Set<string>([
  // "rpe:reps" entries go here, e.g. "8:5".
]);

function cellKey(rpe: number, reps: number): string {
  return `${rpe}:${reps}`;
}

export function isRtsCellFlagged(rpe: number, reps: number): boolean {
  return RTS_FLAGGED_CELLS.has(cellKey(rpe, reps));
}

// Rows: RPE 10 down to 6 in 0.5 steps; columns: reps 1..6.
const ROWS: { rpe: number; pct: number[] }[] = [
  { rpe: 10, pct: [100, 95.5, 92.2, 89.2, 86.3, 83.7] },
  { rpe: 9.5, pct: [97.8, 93.9, 90.7, 87.8, 85.0, 82.4] },
  { rpe: 9, pct: [95.5, 92.2, 89.2, 86.3, 83.7, 81.1] },
  { rpe: 8.5, pct: [93.9, 90.7, 87.8, 85.0, 82.4, 79.9] },
  { rpe: 8, pct: [92.2, 89.2, 86.3, 83.7, 81.1, 78.6] },
  { rpe: 7.5, pct: [90.7, 87.8, 85.0, 82.4, 79.9, 77.4] },
  { rpe: 7, pct: [89.2, 86.3, 83.7, 81.1, 78.6, 76.2] },
  { rpe: 6.5, pct: [87.8, 85.0, 82.4, 79.9, 77.4, 75.1] },
  { rpe: 6, pct: [86.3, 83.7, 81.1, 78.6, 76.2, 73.9] },
];

export interface RtsLookup {
  /** %1RM value, or null when reps/RPE are outside the table. */
  pct: number | null;
  /** False for every cell until the pre-ship second-source check passes. */
  verified: boolean;
  /** True when the caller must use rule 3 (Epley) instead of this cell. */
  useRule3Fallback: boolean;
}

export function rtsLookup(reps: number, rpe: number): RtsLookup {
  if (!Number.isInteger(reps) || reps < 1 || reps > 6) {
    return { pct: null, verified: false, useRule3Fallback: true };
  }
  const row = ROWS.find((r) => Math.abs(r.rpe - rpe) < 1e-9);
  if (!row) return { pct: null, verified: false, useRule3Fallback: true };
  const pct = row.pct[reps - 1];
  if (isRtsCellFlagged(rpe, reps)) {
    return { pct, verified: false, useRule3Fallback: true };
  }
  return { pct, verified: false, useRule3Fallback: false };
}
