/** Weight rounding against the user's plate inventory (PLAN 6.3 + 6.8).
 *
 * The engine prescribes through `roundWeight`, so a prescribed weight is
 * always loadable. `barbellStep` defaults to twice the smallest plate pair.
 */

import { defaultBarbellStep, nearestLoadable, planPlates } from "./plates.ts";
import type { Bar, PlateEntry } from "./plates.ts";

/** Round a bare target total (in the inventory unit) to a loadable total. */
export function roundWeight(
  targetWeight: number,
  barWeight: number,
  plates: PlateEntry[],
  collarWeight = 0,
): number {
  const plan = planPlates(targetWeight, barWeight, plates, collarWeight);
  const load = nearestLoadable(plan);
  if (!load) return Math.round((barWeight + 2 * collarWeight) * 100) / 100;
  return load.total;
}

/** Round against a bar object instead of a bare bar weight. */
export function roundWeightWithBar(
  targetWeight: number,
  bar: Bar,
  plates: PlateEntry[],
  collarWeight = 0,
): number {
  return roundWeight(targetWeight, bar.weight, plates, collarWeight);
}

/** Default `settings.barbellStep`: twice the smallest plate pair. */
export function barbellStepDefault(plates: PlateEntry[], fallback = 5): number {
  return defaultBarbellStep(plates, fallback);
}

/** Round to an arbitrary step (e.g. dumbbell steps), halves up. */
export function roundToStep(value: number, step: number): number {
  if (!(step > 0)) throw new RangeError("step must be positive");
  return Math.round(value / step) * step;
}

/** True when the total can be loaded exactly with the inventory. */
export function isLoadable(
  total: number,
  barWeight: number,
  plates: PlateEntry[],
  collarWeight = 0,
): boolean {
  return planPlates(total, barWeight, plates, collarWeight).exact !== null;
}
