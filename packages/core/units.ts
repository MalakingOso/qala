/** Shared scalar types for units across `packages/core`.
 *
 * Storage rules (PLAN section 3, Units row):
 * - Lifting weights are stored as `{ value, unit }` and passed through as-is.
 * - Everything running is stored in SI (metres, seconds, m/s); conversion
 *   happens only in the UI and when placing split boundaries.
 */

export type WeightUnit = "lb" | "kg";
export type DistanceUnit = "mi" | "km" | "m";

/** Liftosaur-style lifting weight: value in its own unit, never normalised. */
export interface WeightValue {
  value: number;
  unit: WeightUnit;
}
