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

export const LB_PER_KG = 2.2046226218;
export const KG_PER_LB = 0.45359237;
export const M_PER_MI = 1609.344;
export const M_PER_KM = 1000;

/** Smallest plate-math granularity used by the plate calculator (PLAN 6.8). */
export const PLATE_MATH_GRANULARITY = 0.25;

export function isWeightUnit(u: unknown): u is WeightUnit {
  return u === "lb" || u === "kg";
}

export function isDistanceUnit(u: unknown): u is DistanceUnit {
  return u === "mi" || u === "km" || u === "m";
}

/** Convert a bare weight number between lb and kg. */
export function convertWeight(
  value: number,
  from: WeightUnit,
  to: WeightUnit,
): number {
  if (from === to) return value;
  return from === "lb" ? value * KG_PER_LB : value * LB_PER_KG;
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

export function kgToLb(kg: number): number {
  return kg * LB_PER_KG;
}

/** Lifting passthrough: keep `{value, unit}`, converting only for display. */
export function toWeightValue(value: number, unit: WeightUnit): WeightValue {
  return { value, unit };
}

export function weightValueToUnit(w: WeightValue, to: WeightUnit): WeightValue {
  return { value: convertWeight(w.value, w.unit, to), unit: to };
}

export function weightValueToLb(w: WeightValue): number {
  return convertWeight(w.value, w.unit, "lb");
}

export function weightValueToKg(w: WeightValue): number {
  return convertWeight(w.value, w.unit, "kg");
}

/** Display helper: `175.5 lb`, trims trailing zeros. */
export function formatWeight(w: WeightValue): string {
  const v = Math.round(w.value * 100) / 100;
  return `${v} ${w.unit}`;
}

/** Convert a bare distance number between mi, km and m. */
export function convertDistance(
  value: number,
  from: DistanceUnit,
  to: DistanceUnit,
): number {
  const metres = from === "mi"
    ? value * M_PER_MI
    : from === "km"
    ? value * M_PER_KM
    : value;
  return to === "mi"
    ? metres / M_PER_MI
    : to === "km"
    ? metres / M_PER_KM
    : metres;
}

export function distanceMToDisplay(
  distanceM: number,
  unit: DistanceUnit,
): number {
  return convertDistance(distanceM, "m", unit);
}

export function displayToDistanceM(value: number, unit: DistanceUnit): number {
  return convertDistance(value, unit, "m");
}

/** Pace: seconds-per-metre is the canonical SI form. */
export function mpsToSecPerM(mps: number): number {
  if (!(mps > 0)) throw new RangeError("speed must be positive");
  return 1 / mps;
}

export function secPerMToMps(secPerM: number): number {
  if (!(secPerM > 0)) throw new RangeError("pace must be positive");
  return 1 / secPerM;
}

/** Seconds per display-distance-unit (e.g. seconds per mile). */
export function secPerMToSecPerUnit(
  secPerM: number,
  unit: "mi" | "km",
): number {
  return secPerM * (unit === "mi" ? M_PER_MI : M_PER_KM);
}

/** Format SI pace as `M:SS` per display unit (default min/mi per PLAN 3). */
export function formatPace(secPerM: number, unit: "mi" | "km" = "mi"): string {
  const totalSec = secPerMToSecPerUnit(secPerM, unit);
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Parse `M:SS` per display unit back to SI seconds-per-metre. */
export function parsePaceToSecPerM(
  pace: string,
  unit: "mi" | "km" = "mi",
): number {
  const m = pace.trim().match(/^(\d+):([0-5]?\d(?:\.\d+)?)$/);
  if (!m) throw new RangeError(`invalid pace: ${pace}`);
  const totalSec = Number(m[1]) * 60 + Number(m[2]);
  if (!(totalSec > 0)) throw new RangeError(`invalid pace: ${pace}`);
  return totalSec / (unit === "mi" ? M_PER_MI : M_PER_KM);
}

export function mpsToMph(mps: number): number {
  return (mps * 3600) / M_PER_MI;
}

export function mpsToKmh(mps: number): number {
  return (mps * 3600) / M_PER_KM;
}
