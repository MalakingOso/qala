/** Plate calculator (PLAN 6.8).
 *
 * Inventory lives at `settings.plates`. The per-side picker is a bounded
 * knapsack in 0.25 units minimising, in order: `|achieved - t|`, plate count,
 * then heavier plates. Greedy is wrong once pair counts are limited.
 */

import { PLATE_MATH_GRANULARITY } from "./units.ts";

export type PlateUnit = "lb" | "kg";
export type ColorScheme = "bumper" | "iron" | "custom";

export interface Bar {
  id: string;
  name: string;
  /** Bar weight in the inventory unit. */
  weight: number;
  default?: boolean;
}

export interface PlateEntry {
  weight: number;
  pairs: number | "enough";
  color: string;
}

export interface PlateInventory {
  unit: PlateUnit;
  collarWeight: number;
  bars: Bar[];
  plates: PlateEntry[];
  colorScheme: ColorScheme;
}

/** Plates on one side, heaviest innermost (descending). */
export interface PlateLoad {
  /** Per-side plates, heaviest first. */
  perSide: number[];
  perSideTotal: number;
  /** Bar + collars + both sides. */
  total: number;
  barWeight: number;
  collarWeight: number;
}

export interface PlatePlan {
  requestedTotal: number;
  barWeight: number;
  collarWeight: number;
  perSideTarget: number;
  /** Set when the target is exactly loadable. */
  exact: PlateLoad | null;
  /** Nearest loadable total strictly below / above the request. */
  below: PlateLoad | null;
  above: PlateLoad | null;
}

export interface NextPlateChoice {
  load: PlateLoad;
  /** E.g. "add 10 + 2.5 each side", "take off 5, add 25", "no change". */
  instruction: string;
  /** Length of the kept inner (heaviest-first) run. */
  keptInner: number;
  /** Plates added plus plates removed, per side. */
  platesMoved: number;
}

const GRAN = PLATE_MATH_GRANULARITY;

function toUnits(w: number): number {
  return Math.round(w / GRAN);
}

function fromUnits(u: number): number {
  return u * GRAN;
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function desc(xs: number[]): number[] {
  return [...xs].sort((a, b) => b - a);
}

/** Heavier-first comparison of two descending combos. >0 means `a` is heavier. */
function compareHeavier(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? -Infinity;
    const y = b[i] ?? -Infinity;
    if (x !== y) return x - y;
  }
  return 0;
}

interface PlateType {
  weight: number;
  units: number;
  limit: number;
}

function plateTypes(plates: PlateEntry[], maxUnits: number): PlateType[] {
  const types = plates
    .filter((p) => p.weight > 0)
    .map((p) => {
      const units = toUnits(p.weight);
      const limit = p.pairs === "enough"
        ? Math.max(0, Math.ceil(maxUnits / units))
        : Math.max(0, Math.floor(p.pairs));
      return { weight: p.weight, units, limit };
    })
    .filter((t) => t.units > 0 && t.limit > 0)
    .sort((a, b) => b.weight - a.weight);
  return types;
}

interface DpEntry {
  count: number;
  combo: number[];
}

function betterCombo(
  countA: number,
  a: number[],
  countB: number,
  b: number[],
): boolean {
  if (countA !== countB) return countA < countB;
  return compareHeavier(a, b) > 0;
}

/** Best (fewest plates, then heavier) combo for every achievable sum. */
function buildDp(types: PlateType[], capUnits: number): Map<number, DpEntry> {
  const dp = new Map<number, DpEntry>([[0, { count: 0, combo: [] }]]);
  for (const t of types) {
    for (let copy = 0; copy < t.limit; copy++) {
      const snapshot = [...dp.entries()];
      for (const [s, e] of snapshot) {
        const ns = s + t.units;
        if (ns > capUnits) continue;
        const nc = e.count + 1;
        const combo = desc([...e.combo, t.weight]);
        const prev = dp.get(ns);
        if (!prev || betterCombo(nc, combo, prev.count, prev.combo)) {
          dp.set(ns, { count: nc, combo });
        }
      }
    }
  }
  return dp;
}

function makeLoad(
  perSide: number[],
  barWeight: number,
  collarWeight: number,
): PlateLoad {
  const side = desc(perSide);
  const perSideTotal = Math.round(sum(side) * 100) / 100;
  const total =
    Math.round((barWeight + 2 * collarWeight + 2 * perSideTotal) * 100) / 100;
  return { perSide: side, perSideTotal, total, barWeight, collarWeight };
}

function rankSums(
  dp: Map<number, DpEntry>,
  predicate: (s: number) => boolean,
  key: (s: number) => number,
): number | null {
  let best: number | null = null;
  for (const [s, e] of dp) {
    if (!predicate(s)) continue;
    if (best === null) {
      best = s;
      continue;
    }
    const prev = dp.get(best)!;
    const dk = key(s) - key(best);
    if (dk !== 0) {
      if (dk < 0) best = s;
    } else if (e.count !== prev.count) {
      if (e.count < prev.count) best = s;
    } else if (compareHeavier(e.combo, prev.combo) > 0) {
      best = s;
    }
  }
  return best;
}

/**
 * Plan plates for a requested total. Per-side target
 * `t = (W - bar - 2 * collar) / 2`.
 */
export function planPlates(
  requestedTotal: number,
  barWeight: number,
  plates: PlateEntry[],
  collarWeight = 0,
): PlatePlan {
  const perSideTarget = (requestedTotal - barWeight - 2 * collarWeight) / 2;
  const base: PlatePlan = {
    requestedTotal,
    barWeight,
    collarWeight,
    perSideTarget: Math.round(perSideTarget * 100) / 100,
    exact: null,
    below: null,
    above: null,
  };
  if (!(perSideTarget > 0)) {
    // At or below bar (+ collars): the bar alone is the only sensible load.
    const bar = makeLoad([], barWeight, collarWeight);
    if (Math.abs(requestedTotal - bar.total) < 1e-9) base.exact = bar;
    else if (requestedTotal < bar.total) base.above = bar;
    else base.below = bar;
    return base;
  }
  const targetUnits = toUnits(perSideTarget);
  const maxPlateUnits = Math.max(
    ...plates.filter((p) => p.weight > 0).map((p) => toUnits(p.weight)),
    toUnits(0.25),
  );
  const capUnits = targetUnits + maxPlateUnits;
  const types = plateTypes(plates, capUnits);
  if (types.length === 0) return base;
  const dp = buildDp(types, capUnits);

  const exactUnits = dp.has(targetUnits) ? targetUnits : null;
  if (exactUnits !== null) {
    base.exact = makeLoad(dp.get(exactUnits)!.combo, barWeight, collarWeight);
  }
  const belowUnits = rankSums(
    dp,
    (s) => s < targetUnits,
    (s) => targetUnits - s,
  );
  const aboveUnits = rankSums(
    dp,
    (s) => s > targetUnits,
    (s) => s - targetUnits,
  );
  // rankSums over `<` excludes exact; when exact exists also surface neighbours.
  if (belowUnits !== null) {
    base.below = makeLoad(dp.get(belowUnits)!.combo, barWeight, collarWeight);
  }
  if (aboveUnits !== null) {
    base.above = makeLoad(dp.get(aboveUnits)!.combo, barWeight, collarWeight);
  }
  return base;
}

/** Nearest loadable total: exact, else nearer of below/above (ties to below). */
export function nearestLoadable(plan: PlatePlan): PlateLoad | null {
  if (plan.exact) return plan.exact;
  if (plan.below && plan.above) {
    const dBelow = Math.abs(plan.below.total - plan.requestedTotal);
    const dAbove = Math.abs(plan.above.total - plan.requestedTotal);
    return dAbove < dBelow ? plan.above : plan.below;
  }
  return plan.below ?? plan.above;
}

function sharedPrefixLen(a: number[], b: number[]): number {
  let n = 0;
  while (n < a.length && n < b.length && Math.abs(a[n] - b[n]) < 1e-9) n++;
  return n;
}

/** All multisets of limited plates summing to `sumUnits` (heaviest-first). */
function enumerateCombos(
  types: PlateType[],
  sumUnits: number,
  cap = 5000,
): number[][] {
  const out: number[][] = [];
  const combo: number[] = [];
  function rec(i: number, rest: number): void {
    if (out.length >= cap) return;
    if (rest === 0) {
      out.push(desc(combo));
      return;
    }
    if (i >= types.length) return;
    const t = types[i];
    const max = Math.min(t.limit, Math.floor(rest / t.units));
    for (let k = max; k >= 0; k--) {
      for (let j = 0; j < k; j++) combo.push(t.weight);
      rec(i + 1, rest - k * t.units);
      for (let j = 0; j < k; j++) combo.pop();
      if (out.length >= cap) return;
    }
  }
  rec(0, sumUnits);
  return out;
}

export function describeChange(
  currentPerSide: number[],
  nextPerSide: number[],
): string {
  const cur = desc(currentPerSide);
  const next = desc(nextPerSide);
  const kept = sharedPrefixLen(cur, next);
  const removed = cur.slice(kept);
  const added = next.slice(kept);
  if (removed.length === 0 && added.length === 0) return "no change";
  const parts: string[] = [];
  if (removed.length > 0) {
    parts.push(`take off ${removed.map(fmt).join(" + ")}`);
  }
  if (added.length > 0) parts.push(`add ${added.map(fmt).join(" + ")}`);
  return `${parts.join(", ")} each side`;
}

/**
 * Between-set chooser. Candidates are ranked by fewest plates, then longest
 * shared run of inner plates, then fewest plates moved, then heavier plates.
 *
 * Note: fewest-plates outranks keep-inner because PLAN 6.8's own ramp demands
 * it: 100 -> 125 goes 25+2.5 -> 35+5 (a full swap, 2 plates) rather than
 * 25+10+5 (keeps the 25, but 3 plates). Exactness/loadability always wins via
 * `nearestLoadable`, so the engine's `roundWeight` stays consistent.
 */
export function chooseNextPlates(
  currentPerSide: number[],
  nextTotal: number,
  barWeight: number,
  plates: PlateEntry[],
  collarWeight = 0,
): NextPlateChoice | null {
  const plan = planPlates(nextTotal, barWeight, plates, collarWeight);
  const target = nearestLoadable(plan);
  if (!target) return null;
  const targetUnits = toUnits(sum(target.perSide));
  const maxPlateUnits = Math.max(
    ...plates.filter((p) => p.weight > 0).map((p) => toUnits(p.weight)),
    toUnits(0.25),
  );
  const types = plateTypes(plates, targetUnits + maxPlateUnits);
  const combos = enumerateCombos(types, targetUnits);
  const cur = desc(currentPerSide);
  let best: number[] | null = null;
  let bestKey: [number, number, number, number] | null = null;
  for (const combo of combos) {
    const kept = sharedPrefixLen(cur, combo);
    const moved = (cur.length - kept) + (combo.length - kept);
    // Fewer plates, then longer kept run, then fewer moved; heavier breaks ties.
    const key: [number, number, number, number] = [
      combo.length,
      -kept,
      moved,
      0,
    ];
    let take = best === null || bestKey === null;
    if (!take && best !== null && bestKey !== null) {
      const [bl, bk, bm] = bestKey;
      take = key[0] < bl ||
        (key[0] === bl && (key[1] < bk || (key[1] === bk && key[2] < bm)));
      if (
        !take && key[0] === bl && key[1] === bk && key[2] === bm &&
        compareHeavier(combo, best) > 0
      ) take = true;
    }
    if (take) {
      best = combo;
      bestKey = key;
    }
  }
  const perSide = best ?? target.perSide;
  const load = makeLoad(perSide, barWeight, collarWeight);
  const kept = sharedPrefixLen(cur, perSide);
  return {
    load,
    instruction: describeChange(cur, perSide),
    keptInner: kept,
    platesMoved: (cur.length - kept) + (perSide.length - kept),
  };
}

/** One-line logging-screen shorthand: "per side 45 · 45 · 10", or "bar". */
export function platesShorthand(perSide: number[]): string {
  const side = desc(perSide);
  return side.length === 0 ? "bar" : `per side ${side.map(fmt).join(" · ")}`;
}

/** Smallest barbell step: twice the smallest available plate pair (PLAN 6.8). */
export function defaultBarbellStep(plates: PlateEntry[], fallback = 5): number {
  let smallest: number | null = null;
  for (const p of plates) {
    if (p.weight <= 0) continue;
    if (p.pairs === "enough" || p.pairs >= 1) {
      if (smallest === null || p.weight < smallest) smallest = p.weight;
    }
  }
  if (smallest === null) return fallback;
  return Math.round(2 * smallest * 100) / 100;
}

export function defaultBar(inventory: PlateInventory): Bar {
  const d = inventory.bars.find((b) => b.default) ?? inventory.bars[0];
  if (!d) throw new RangeError("plate inventory has no bars");
  return d;
}

// --- Colors (PLAN 6.8 table; color is never the only cue) ---

export const IRON_COLOR = "charcoal";

/** Default bumper colors by plate weight, per inventory unit. */
export const BUMPER_COLORS: {
  lb: Record<string, string>;
  kg: Record<string, string>;
} = {
  kg: {
    "25": "red",
    "20": "blue",
    "15": "yellow",
    "10": "green",
    "5": "white",
    "2.5": "red",
    "2": "blue",
    "1.5": "yellow",
    "1": "green",
    "0.5": "white",
  },
  lb: {
    "55": "red",
    "45": "blue",
    "35": "yellow",
    "25": "green",
    "10": "white",
    "5": "charcoal",
    "2.5": "silver",
    "1.25": "silver",
  },
};

export function bumperColorFor(weight: number, unit: PlateUnit): string {
  return BUMPER_COLORS[unit][fmt(weight)] ?? IRON_COLOR;
}

/** "iron" scheme: every plate becomes charcoal (still editable per plate). */
export function applyColorScheme(inventory: PlateInventory): PlateInventory {
  if (inventory.colorScheme === "iron") {
    return {
      ...inventory,
      plates: inventory.plates.map((p) => ({ ...p, color: IRON_COLOR })),
    };
  }
  if (inventory.colorScheme === "bumper") {
    return {
      ...inventory,
      plates: inventory.plates.map((p) => ({
        ...p,
        color: bumperColorFor(p.weight, inventory.unit),
      })),
    };
  }
  return inventory;
}

/** Plate height in the barbell drawing steps down with weight. */
export function plateHeightClass(
  weight: number,
  unit: PlateUnit,
): "full" | "small" {
  const kg = unit === "kg" ? weight : weight / 2.2046226218;
  if (unit === "lb") return weight >= 25 ? "full" : "small";
  return kg >= 10 ? "full" : "small";
}

/**
 * A sensible default full lb inventory (45 lb bar, 2.5 lb smallest pair, so the
 * default barbell step is 5 lb). 1.25 lb plates are listed with 0 pairs until
 * the owner enters their real inventory (PLAN 6.8).
 */
export function defaultLbInventory(): PlateInventory {
  const weights: Array<{ weight: number; pairs: number | "enough" }> = [
    { weight: 45, pairs: "enough" },
    { weight: 35, pairs: "enough" },
    { weight: 25, pairs: "enough" },
    { weight: 10, pairs: "enough" },
    { weight: 5, pairs: "enough" },
    { weight: 2.5, pairs: "enough" },
    { weight: 1.25, pairs: 0 },
  ];
  return {
    unit: "lb",
    collarWeight: 0,
    bars: [{
      id: "bar-olympic",
      name: "Olympic bar",
      weight: 45,
      default: true,
    }],
    plates: weights.map((w) => ({
      ...w,
      color: bumperColorFor(w.weight, "lb"),
    })),
    colorScheme: "bumper",
  };
}

export { fromUnits };
