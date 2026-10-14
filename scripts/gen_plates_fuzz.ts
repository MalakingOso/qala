// Differential fuzz oracle for the Rust plate math (crates/qala-core, docs/rust-core.md R2/R3).
//
//   deno task fuzz:plates        # same as: deno run -A scripts/gen_plates_fuzz.ts
//
// Runs the real TS plate math (packages/core/plates.ts and rounding.ts) on 1,000,000
// random cases and writes them, with the TS answers, as JSON Lines under
// testdata/golden/plates/fuzz/ (gitignored, about 150 MB):
//
//   inventories.json              the plate inventories the cases refer to by index
//   plates_fuzz_00..09.jsonl      100,000 cases per file, one JSON array per line
//
// The replay test is crates/qala-core/tests/fuzz_core.rs (fuzz_plates). Output is
// deterministic: a private seeded PRNG drives everything (FUZZ_SEED varies the corpus;
// the default is the committed one), and chunk k is seeded from (seed, k), so the
// worker count (FUZZ_WORKERS) does not change a byte.
//
// Line formats. Numbers that are NaN or +-Infinity are the strings "NaN", "Infinity"
// and "-Infinity" (JSON would write null). A load is [perSide, perSideTotal, total].
//
//   ["p", inv, total, bar, collar, [perSideTarget, exact, below, above, nl, rw]]
//        planPlates + nearestLoadable + roundWeight. nl says which plan slot
//        nearestLoadable returned: "e" exact, "b" below, "a" above, or null.
//   ["c", inv, currentPerSide, nextTotal, bar, collar, choice]
//        chooseNextPlates; choice is null or
//        [perSide, perSideTotal, total, instruction, keptInner, platesMoved].
//   ["d", currentPerSide, nextPerSide, text]     describeChange
//   ["s", perSide, text]                         platesShorthand
//   ["b", inv, fallback, step]                   barbellStepDefault; fallback null = default
//   ["r", value, step, result]                   roundToStep; result "throw" for RangeError
//   ["l", inv, total, bar, collar, loadable]     isLoadable

import {
  chooseNextPlates,
  describeChange,
  nearestLoadable,
  planPlates,
  type PlateEntry,
  type PlateLoad,
  platesShorthand,
} from "../packages/core/plates.ts";
import {
  barbellStepDefault,
  isLoadable,
  roundToStep,
  roundWeight,
} from "../packages/core/rounding.ts";
import {
  type ChunkJob,
  type ChunkResult,
  chunkSeed,
  ChunkWriter,
  defaultWorkers,
  dp,
  en,
  enAll,
  printSummary,
  removeStale,
  Rng,
  runJobs,
} from "./fuzz_lib.ts";

const TOTAL_CASES = 1_000_000;
const CHUNK = 100_000;
const CHUNKS = TOTAL_CASES / CHUNK;
const AREA_ID = 1;
const DEFAULT_SEED = 20261014;
const OUT_DIR = new URL("../testdata/golden/plates/fuzz/", import.meta.url)
  .pathname;
const GRAN = 0.25;
const NAN_RATE = Number(Deno.env.get("FUZZ_NAN_RATE") ?? 0);

// ---------------------------------------------------------------------------
// Inventories
// ---------------------------------------------------------------------------

type Pairs = number | "enough";
interface Inv {
  plates: PlateEntry[];
  unit: "lb" | "kg" | "any";
  /** Some positive-weight row is "enough": cost grows with the target. */
  hasEnough: boolean;
}

const LB_WEIGHTS = [55, 45, 35, 25, 10, 5, 2.5, 1.25];
const KG_WEIGHTS = [25, 20, 15, 10, 5, 2.5, 2, 1.5, 1.25, 1, 0.5, 0.25];
const COLORS = [
  "red",
  "blue",
  "yellow",
  "green",
  "white",
  "charcoal",
  "silver",
];

function row(rng: Rng, weight: number, pairs: Pairs): PlateEntry {
  return { weight, pairs, color: rng.pick(COLORS) };
}

function pairsPick(rng: Rng, enoughShare: number): Pairs {
  if (rng.chance(enoughShare)) return "enough";
  return rng.weighted<Pairs>([
    [5, 0],
    [14, 1],
    [30, 2],
    [18, 3],
    [10, 4],
    [4, 5],
    [3, 6],
    [3, 8],
    [2, 10],
    [2, 1.5],
    [2, 2.7],
    [1, 0.5],
    [1, -1],
  ]);
}

function makeInv(plates: PlateEntry[], unit: Inv["unit"]): Inv {
  const hasEnough = plates.some((p) =>
    p.pairs === "enough" && p.weight > 0 && Math.round(p.weight / GRAN) > 0
  );
  return { plates, unit, hasEnough };
}

function fixedInventories(rng: Rng): Inv[] {
  const e = (w: number, c = "grey"): PlateEntry => ({
    weight: w,
    pairs: "enough",
    color: c,
  });
  const n = (w: number, pairs: Pairs, c = "grey"): PlateEntry => ({
    weight: w,
    pairs,
    color: c,
  });
  const out: Inv[] = [];
  // The shipped default (1.25 lb at 0 pairs), with and without the 55 and 1.25.
  out.push(makeInv(
    [e(45), e(35), e(25), e(10), e(5), e(2.5), n(1.25, 0)],
    "lb",
  ));
  out.push(makeInv(
    [e(55), e(45), e(35), e(25), e(10), e(5), e(2.5), e(1.25)],
    "lb",
  ));
  out.push(makeInv([e(45), e(25), e(10), e(5), e(2.5)], "lb"));
  out.push(makeInv(
    [n(45, 2), n(35, 1), n(25, 2), n(10, 2), n(5, 2), n(2.5, 1), n(1.25, 1)],
    "lb",
  ));
  out.push(makeInv(
    [n(45, 1), e(35), e(25), e(10), e(5), e(2.5), e(1.25)],
    "lb",
  ));
  out.push(makeInv(
    [n(55, 2), n(45, 4), n(35, 2), n(25, 2), n(10, 2), n(5, 2), n(2.5, 2)],
    "lb",
  ));
  out.push(makeInv(
    [e(25), e(20), e(15), e(10), e(5), e(2.5), e(2), e(1.5), e(1), e(0.5)],
    "kg",
  ));
  out.push(makeInv(
    [e(25), e(20), e(15), e(10), e(5), e(2.5), e(1.25), e(0.5)],
    "kg",
  ));
  out.push(makeInv(
    [
      n(25, 2),
      n(20, 2),
      n(15, 1),
      n(10, 2),
      n(5, 2),
      n(2.5, 2),
      n(1.25, 1),
      n(
        0.5,
        1,
      ),
    ],
    "kg",
  ));
  out.push(makeInv([n(20, 3), n(10, 2), n(5, 2), n(2.5, 1), n(1, 2)], "kg"));
  // Odd inventories.
  out.push(makeInv([], "any"));
  out.push(makeInv([n(45, 1)], "lb"));
  out.push(makeInv([n(45, 3)], "lb"));
  out.push(makeInv([e(45)], "lb"));
  out.push(makeInv([n(20, 1)], "kg"));
  out.push(makeInv([n(1.25, 2)], "lb"));
  out.push(makeInv([e(0.5)], "kg"));
  out.push(makeInv([e(1.25)], "lb"));
  out.push(makeInv([e(5)], "lb"));
  out.push(makeInv([n(100, 2)], "any"));
  out.push(makeInv([n(0.25, 4)], "any"));
  // Everything filtered out: zero, negative, NaN, below the grid.
  out.push(makeInv([n(0, 2), n(-5, 3), n(NaN, 2)], "any"));
  out.push(makeInv([n(0.1, 3), n(0.05, "enough")], "any"));
  // Non-grid weights and duplicates.
  out.push(makeInv([n(1.1, 3), n(0.125, 2), n(0.3, 4), n(2.6, 2)], "any"));
  out.push(makeInv([n(45, 1), n(45, 2), n(45, 1), n(10, 2)], "lb"));
  out.push(makeInv([n(2.5, 2), n(45, 2), n(10, 2), n(25, 2)], "lb")); // unsorted
  out.push(makeInv([n(45, -1), n(35, 0), n(25, 1.9), n(10, 0.5)], "lb"));
  out.push(makeInv([n(45, 1e3), n(25, 50)], "lb")); // many pairs, small target only
  // Three weights that make greedy fail with limited counts.
  out.push(makeInv([n(45, 1), e(35), e(25), e(10), e(5), e(2.5)], "lb"));
  out.push(makeInv([n(30, 2), n(25, 2), n(20, 2)], "any"));
  void rng;
  return out;
}

function randomInv(rng: Rng): Inv {
  const unit = rng.weighted<Inv["unit"]>([[55, "lb"], [35, "kg"], [10, "any"]]);
  const pool = unit === "lb" ? LB_WEIGHTS : unit === "kg" ? KG_WEIGHTS : [
    100,
    50,
    45,
    30,
    25,
    20,
    15,
    10,
    7.5,
    5,
    3,
    2.5,
    2,
    1.25,
    1,
    0.75,
    0.5,
    0.25,
  ];
  const keep = rng.int(1, pool.length);
  const weights = rng.shuffle([...pool]).slice(0, keep);
  const enoughShare = rng.pick([0, 0, 0.2, 0.5, 1]);
  const plates = weights.map((w) => row(rng, w, pairsPick(rng, enoughShare)));
  // Odd rows.
  if (rng.chance(0.15)) {
    plates.push(
      row(
        rng,
        rng.pick([0, -2.5, 0.1, 0.125, 1.1, NaN]),
        rng.pick([1, 2, "enough"] as Pairs[]),
      ),
    );
  }
  if (rng.chance(0.1) && plates.length) {
    const d = rng.pick(plates);
    plates.push({ ...d, pairs: pairsPick(rng, 0) });
  }
  if (rng.chance(0.8)) plates.sort((a, b) => b.weight - a.weight); // else leave shuffled
  return makeInv(plates, unit);
}

export function makeInventories(seed: number): Inv[] {
  const rng = new Rng(chunkSeed(seed, AREA_ID, 9999));
  const inv = fixedInventories(rng);
  while (inv.length < 400) inv.push(randomInv(rng));
  return inv;
}

// ---------------------------------------------------------------------------
// Cost model: the DP does about (plate copies) x (reachable sums) steps
// ---------------------------------------------------------------------------

function toUnits(w: number): number {
  return Math.round(w / GRAN);
}

/** Mirrors the sizes planPlates builds, without building anything. */
function estCost(plates: PlateEntry[], perSideTarget: number): number {
  const tu = toUnits(perSideTarget);
  let maxU = toUnits(0.25);
  for (const p of plates) {
    if (p.weight > 0) maxU = Math.max(maxU, toUnits(p.weight));
  }
  const cap = tu + maxU;
  let copies = 0;
  let sum = 0;
  let maxEff = 0;
  for (const p of plates) {
    if (!(p.weight > 0)) continue;
    const u = toUnits(p.weight);
    if (!(u > 0)) continue;
    const limit = p.pairs === "enough"
      ? Math.max(0, Math.ceil(cap / u))
      : Math.max(0, Math.floor(p.pairs));
    if (!(limit > 0)) continue;
    copies += limit;
    sum += limit * u;
    maxEff = Math.max(maxEff, u);
  }
  if (copies === 0) return 0;
  // Every step also copies and sorts a combo of about (sum / heaviest plate) plates.
  const avgLen = 1 + Math.min(copies, Math.min(cap, sum) / maxEff) / 2;
  return copies * (Math.min(cap, sum) + 1) * avgLen;
}

const capCache = new Map<string, number>();

/** Largest per-side target whose estimated cost fits `budget`. Infinity if none binds. */
function sideCap(inv: Inv, idx: number, budget: number): number {
  const key = `${idx}:${budget}`;
  const hit = capCache.get(key);
  if (hit !== undefined) return hit;
  let result: number;
  if (estCost(inv.plates, 1e15) <= budget) {
    result = Infinity;
  } else {
    let lo = 0;
    let hi = 1e7;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (estCost(inv.plates, mid) <= budget) lo = mid;
      else hi = mid;
    }
    result = lo;
  }
  capCache.set(key, result);
  return result;
}

// ---------------------------------------------------------------------------
// Input pools
// ---------------------------------------------------------------------------

const BARS_LB = [45, 45, 45, 35, 25, 55, 15, 33, 44.5, 7, 10, 0, 65, 20];
const BARS_KG = [20, 20, 20, 15, 10, 25, 7, 0, 12.5, 18, 45];
const BARS_ANY = [45, 20, 0, 15, 5, 12.34, 0.25, 100];
const COLLARS = [0, 0, 0, 0, 0, 0, 2.5, 1.25, 0.5, 5, 1, 0.25, 0.1];

function pickBar(rng: Rng, inv: Inv): number {
  const r = rng.next();
  if (r < 0.012) return rng.pick([NaN, Infinity, -Infinity, -5, -45, -0]);
  const pool = inv.unit === "kg"
    ? BARS_KG
    : inv.unit === "lb"
    ? BARS_LB
    : BARS_ANY;
  if (r < 0.15) return rng.pick([...BARS_LB, ...BARS_KG]);
  return rng.pick(pool);
}

function pickCollar(rng: Rng): number {
  const r = rng.next();
  if (r < 0.01) return rng.pick([NaN, Infinity, -Infinity, -1, -2.5, -0]);
  return rng.pick(COLLARS);
}

const SPECIAL_TOTALS = [
  0,
  -0,
  1,
  -1,
  -45,
  -1e9,
  NaN,
  -Infinity,
  1e-9,
  -1e-9,
  Number.MIN_VALUE,
  -Number.MIN_VALUE,
  0.125,
  0.25,
  2.5,
];

/** Targets far past anything lifted. Only used where the DP cost does not follow the target. */
const LARGE_TOTALS = [
  1e4,
  1e5,
  1e6,
  1e9,
  1e12,
  1e15,
  9e15,
  1e16,
  1e17,
  1e18,
  1e19,
  1e30,
  1e100,
  1e300,
  Number.MAX_VALUE,
  Infinity,
];

type Mode = "exact" | "uniform" | "bar" | "special" | "large";

interface Drawn {
  total: number;
  mode: Mode;
}

/** A random loadable per-side sum from the inventory's usable rows (what a lifter might load). */
function randomLoadSum(rng: Rng, inv: Inv): number {
  const usable = inv.plates.filter((p) =>
    p.weight > 0 && toUnits(p.weight) > 0
  );
  rng.shuffle(usable);
  let sum = 0;
  const rows = rng.int(1, Math.max(1, Math.min(usable.length, 5)));
  for (let i = 0; i < Math.min(rows, usable.length); i++) {
    const p = usable[i];
    const limit = p.pairs === "enough" ? 4 : Math.max(0, Math.floor(p.pairs));
    const k = rng.int(0, Math.min(limit, 4));
    sum += k * p.weight;
  }
  return sum;
}

function drawTotal(
  rng: Rng,
  inv: Inv,
  idx: number,
  bar: number,
  collar: number,
  budget: number,
): Drawn {
  const barTotal = Number.isFinite(bar + 2 * collar) ? bar + 2 * collar : 45;
  const cap = sideCap(inv, idx, budget);
  const totalCap = cap === Infinity ? Infinity : barTotal + 2 * cap;
  const clamp = (
    t: number,
  ) => (t > totalCap ? Math.max(0, totalCap * rng.next()) : t);
  const mode = rng.weighted<Mode>([
    [30, "exact"],
    [34, "uniform"],
    [15, "bar"],
    [7, "special"],
    [3, "large"],
  ]);
  switch (mode) {
    case "exact": {
      let total = barTotal + 2 * randomLoadSum(rng, inv);
      if (rng.chance(0.45)) {
        total += rng.pick([
          0.25,
          -0.25,
          1.25,
          -1.25,
          2.5,
          -2.5,
          0.01,
          -0.01,
          1e-9,
          -1e-9,
          5,
          -5,
          0.5,
          -0.5,
        ]);
      }
      return { total: clamp(dp(total, 6)), mode };
    }
    case "uniform": {
      const hi = Math.min(
        rng.weighted([[70, 450], [20, 700], [10, 1500]]),
        totalCap,
      );
      const v = rng.float(0, hi);
      const form = rng.weighted([[35, "int"], [15, "half"], [20, "quarter"], [
        20,
        "cent",
      ], [10, "milli"]]);
      const t = form === "int"
        ? Math.round(v)
        : form === "half"
        ? Math.round(v * 2) / 2
        : form === "quarter"
        ? Math.round(v * 4) / 4
        : form === "cent"
        ? dp(v, 2)
        : dp(v, 3);
      return { total: t, mode };
    }
    case "bar": {
      const d = rng.pick([
        0,
        0,
        1e-10,
        -1e-10,
        5e-10,
        -5e-10,
        1e-9,
        -1e-9,
        2e-9,
        -2e-9,
        0.25,
        -0.25,
        0.5,
        -0.5,
        1,
        -1,
        2.5,
        -2.5,
        5,
        -5,
        0.125,
        0.0625,
      ]);
      return { total: clamp(barTotal + d), mode };
    }
    case "special": {
      let t = rng.pick(SPECIAL_TOTALS);
      // +Infinity is only safe when no "enough" row would loop; the large tail covers it.
      if (t > totalCap) t = 0;
      return { total: t, mode };
    }
    case "large": {
      if (inv.hasEnough && cap !== Infinity) {
        // Cost follows the target here: stay inside the budget.
        return { total: clamp(rng.float(0.5, 1) * totalCap), mode: "uniform" };
      }
      if (inv.hasEnough) {
        return { total: rng.pick([1e4, 5e3, 3e3]), mode };
      }
      return { total: rng.pick(LARGE_TOTALS), mode };
    }
  }
}

const PS_WEIGHTS = [
  45,
  35,
  25,
  10,
  5,
  2.5,
  1.25,
  55,
  20,
  15,
  1.5,
  0.5,
  0.25,
  100,
  1.005,
  1.1,
  2.675,
  0.015,
  1.255,
  8.345,
  33.333,
  0.1,
  0.004,
  1e-7,
  123456.789,
  1e15,
  1e16,
  1e20,
  0,
  -5,
  -0.5,
];

function randomPerSide(rng: Rng, inv: Inv | null): number[] {
  const n = rng.weighted([[12, 0], [20, 1], [25, 2], [20, 3], [12, 4], [7, 5], [
    4,
    8,
  ]]);
  const out: number[] = [];
  const usable = inv ? inv.plates.filter((p) => p.weight > 0) : [];
  for (let i = 0; i < n; i++) {
    if (usable.length && rng.chance(0.7)) out.push(rng.pick(usable).weight);
    else if (rng.chance(0.85)) out.push(rng.pick(PS_WEIGHTS));
    else out.push(dp(rng.float(0, 60), rng.pick([0, 1, 2, 3])));
  }
  // Sorted descending (a real load), or shuffled / duplicated / with a special value.
  const r = rng.next();
  if (r < 0.55) out.sort((a, b) => b - a);
  else if (r < 0.85) rng.shuffle(out);
  if (rng.chance(0.02)) out.push(rng.pick([Infinity, -Infinity]));
  if (rng.chance(NAN_RATE)) out.splice(rng.int(0, out.length), 0, NaN);
  return out;
}

// ---------------------------------------------------------------------------
// Case builders
// ---------------------------------------------------------------------------

const loadOut = (l: PlateLoad | null) =>
  l ? [enAll(l.perSide), en(l.perSideTotal), en(l.total)] : null;

interface Ctx {
  invs: Inv[];
  stats: Record<string, number>;
  slowest: { ms: number; what: string };
}

function bump(ctx: Ctx, key: string): void {
  ctx.stats[key] = (ctx.stats[key] ?? 0) + 1;
}

function timed<T>(ctx: Ctx, what: () => string, fn: () => T): T {
  const t0 = performance.now();
  const v = fn();
  const ms = performance.now() - t0;
  if (ms > ctx.slowest.ms) ctx.slowest = { ms, what: what() };
  ctx.stats["time_us.total_timed"] = (ctx.stats["time_us.total_timed"] ?? 0) +
    Math.round(ms * 1000);
  return v;
}

/** Largest estimated DP cost the generator ever lets the oracle run. */
const HARD_BUDGET = 3_000_000;

/**
 * Keeps an "enough" inventory away from targets that would loop (a -Infinity bar or collar
 * makes the per-side target Infinity) or take minutes. Returns safe inputs.
 */
function guard(
  inv: Inv,
  total: number,
  bar: number,
  collar: number,
): { total: number; bar: number; collar: number } {
  const side = (total - bar - 2 * collar) / 2;
  if (!(side > 0) || estCost(inv.plates, side) <= HARD_BUDGET) {
    return { total, bar, collar };
  }
  return { total: 135, bar: 45, collar: 0 };
}

/**
 * Size of the search tree chooseNextPlates walks for a target: the product, over the usable
 * rows, of how many copies of each row could go on one side. enumerateCombos has no pruning
 * beyond that, so a big inventory with a target near its sum takes minutes.
 */
function enumEst(plates: PlateEntry[], side: number): number {
  if (!(side > 0)) return 1;
  const tu = Number.isFinite(side) ? toUnits(side) : 1e18;
  let maxU = toUnits(0.25);
  for (const p of plates) {
    if (p.weight > 0) maxU = Math.max(maxU, toUnits(p.weight));
  }
  const cap = tu + maxU;
  let est = 1;
  for (const p of plates) {
    if (!(p.weight > 0)) continue;
    const u = toUnits(p.weight);
    if (!(u > 0)) continue;
    const limit = p.pairs === "enough"
      ? Math.max(0, Math.ceil(cap / u))
      : Math.max(0, Math.floor(p.pairs));
    if (!(limit > 0)) continue;
    est *= Math.min(limit, Math.floor(tu / u)) + 1;
    if (est > 1e12) return est;
  }
  return est;
}

const ENUM_BUDGET = 300_000;

/** Shrinks `total` until chooseNextPlates stays cheap on this inventory. */
function enumGuard(
  inv: Inv,
  total: number,
  bar: number,
  collar: number,
): number {
  let side = (total - bar - 2 * collar) / 2;
  if (!(side > 0)) return total;
  for (let i = 0; i < 80 && enumEst(inv.plates, side) > ENUM_BUDGET; i++) {
    side /= 2;
  }
  if (enumEst(inv.plates, side) > ENUM_BUDGET) side = 10;
  return bar + 2 * collar + 2 * side;
}

function budgetFor(rng: Rng, inv: Inv): number {
  return inv.hasEnough
    ? rng.weighted([[44, 30_000], [38, 120_000], [15, 300_000], [3, 1_000_000]])
    : rng.weighted([[90, 150_000], [10, 1_000_000]]);
}

function planCase(rng: Rng, ctx: Ctx): unknown {
  const idx = rng.weighted([[35, rng.int(0, 29)], [
    65,
    rng.int(0, ctx.invs.length - 1),
  ]]);
  const inv = ctx.invs[idx];
  const pickedBar = pickBar(rng, inv);
  const pickedCollar = pickCollar(rng);
  const drawn = drawTotal(
    rng,
    inv,
    idx,
    pickedBar,
    pickedCollar,
    budgetFor(rng, inv),
  );
  const mode = drawn.mode;
  const { total, bar, collar } = guard(
    inv,
    drawn.total,
    pickedBar,
    pickedCollar,
  );
  bump(ctx, `plan.mode.${mode}`);
  if (!Number.isFinite(total)) bump(ctx, "plan.total.nonfinite");
  else if (total < 0) bump(ctx, "plan.total.negative");
  else if (total <= bar) bump(ctx, "plan.total.at_or_below_bar");
  else if (!Number.isInteger(total * 2)) bump(ctx, "plan.total.non_half_step");
  return timed(
    ctx,
    () => `plan inv=${idx} total=${total} bar=${bar} collar=${collar}`,
    () => {
      const plan = planPlates(total, bar, inv.plates, collar);
      const nl = nearestLoadable(plan);
      const slot = nl === null
        ? null
        : nl === plan.exact
        ? "e"
        : nl === plan.below
        ? "b"
        : "a";
      const rw = roundWeight(total, bar, inv.plates, collar);
      bump(ctx, plan.exact ? "plan.exact" : "plan.inexact");
      bump(ctx, `plan.nearest.${slot ?? "none"}`);
      return [
        "p",
        idx,
        en(total),
        en(bar),
        en(collar),
        [
          en(plan.perSideTarget),
          loadOut(plan.exact),
          loadOut(plan.below),
          loadOut(plan.above),
          slot,
          en(rw),
        ],
      ];
    },
  );
}

function chooseCase(rng: Rng, ctx: Ctx): unknown {
  const idx = rng.int(0, ctx.invs.length - 1);
  const inv = ctx.invs[idx];
  const pickedBar = pickBar(rng, inv);
  const pickedCollar = pickCollar(rng);
  // The chooser enumerates combinations too: keep the target modest.
  const drawn = drawTotal(rng, inv, idx, pickedBar, pickedCollar, 100_000);
  const g = guard(inv, drawn.total, pickedBar, pickedCollar);
  const { bar, collar } = g;
  const total = enumGuard(inv, g.total, bar, collar);
  const cur = rng.chance(0.15) ? [] : randomPerSide(rng, inv);
  bump(ctx, "choose");
  return timed(
    ctx,
    () => `choose inv=${idx} total=${total} cur=${JSON.stringify(cur)}`,
    () => {
      const c = chooseNextPlates(cur, total, bar, inv.plates, collar);
      if (!c) bump(ctx, "choose.null");
      return [
        "c",
        idx,
        enAll(cur),
        en(total),
        en(bar),
        en(collar),
        c === null ? null : [
          enAll(c.load.perSide),
          en(c.load.perSideTotal),
          en(c.load.total),
          c.instruction,
          c.keptInner,
          c.platesMoved,
        ],
      ];
    },
  );
}

function describeCase(rng: Rng, ctx: Ctx): unknown {
  const inv = rng.chance(0.5) ? rng.pick(ctx.invs) : null;
  const cur = randomPerSide(rng, inv);
  // Often a small edit of the current load, as a ramp would be.
  let next: number[];
  if (rng.chance(0.5)) {
    next = [...cur];
    if (next.length && rng.chance(0.5)) {
      next.splice(rng.int(0, next.length - 1), 1);
    }
    if (rng.chance(0.5)) next.push(rng.pick(PS_WEIGHTS));
    next.sort((a, b) => b - a);
  } else {
    next = randomPerSide(rng, inv);
  }
  bump(ctx, "describe");
  return ["d", enAll(cur), enAll(next), describeChange(cur, next)];
}

function shorthandCase(rng: Rng, ctx: Ctx): unknown {
  const side = randomPerSide(rng, rng.chance(0.5) ? rng.pick(ctx.invs) : null);
  bump(ctx, "shorthand");
  return ["s", enAll(side), platesShorthand(side)];
}

function stepCase(rng: Rng, ctx: Ctx): unknown {
  const idx = rng.int(0, ctx.invs.length - 1);
  const fallback = rng.weighted<number | null>([
    [50, null],
    [30, 5],
    [8, 2.5],
    [4, 0],
    [3, NaN],
    [3, Infinity],
    [2, -1],
  ]);
  bump(ctx, "barbell_step");
  const step = fallback === null
    ? barbellStepDefault(ctx.invs[idx].plates)
    : barbellStepDefault(ctx.invs[idx].plates, fallback);
  return ["b", idx, fallback === null ? null : en(fallback), en(step)];
}

function roundToStepCase(rng: Rng, ctx: Ctx): unknown {
  const value = rng.weighted<number>([
    [40, dp(rng.float(0, 300), rng.pick([0, 1, 2]))],
    [20, rng.pick([0.5, 1.5, 2.5, 7.5, -0.5, -1.5, -2.5, 0, -0, 12.5, 100.25])],
    [20, dp(rng.float(-300, 300), 3)],
    [10, rng.pick([NaN, Infinity, -Infinity, 1e15, 1e300, -1e300])],
    [
      10,
      rng.pick([5, 2.5, 10]) * rng.int(0, 60) +
      rng.pick([0, 0.25, 2.5, 1.25, 1e-9]),
    ],
  ]);
  const step = rng.weighted<number>([
    [60, rng.pick([5, 2.5, 1, 10, 0.5, 1.25, 2, 0.25, 4, 7.5])],
    [10, rng.pick([0.1, 0.3, 1e-9, 1e6, Number.MIN_VALUE, Infinity])],
    [10, rng.pick([0, -0, -1, -5, NaN, -Infinity])],
    [20, dp(rng.float(0.05, 25), rng.pick([1, 2, 3]))],
  ]);
  bump(ctx, "round_to_step");
  let result: number | string;
  try {
    result = en(roundToStep(value, step));
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    result = "throw";
    bump(ctx, "round_to_step.throw");
  }
  return ["r", en(value), en(step), result];
}

function loadableCase(rng: Rng, ctx: Ctx): unknown {
  const idx = rng.int(0, ctx.invs.length - 1);
  const inv = ctx.invs[idx];
  const pickedBar = pickBar(rng, inv);
  const pickedCollar = pickCollar(rng);
  const drawn = drawTotal(rng, inv, idx, pickedBar, pickedCollar, 100_000);
  const { total, bar, collar } = guard(
    inv,
    drawn.total,
    pickedBar,
    pickedCollar,
  );
  bump(ctx, "is_loadable");
  return [
    "l",
    idx,
    en(total),
    en(bar),
    en(collar),
    isLoadable(total, bar, inv.plates, collar),
  ];
}

// ---------------------------------------------------------------------------
// Chunks
// ---------------------------------------------------------------------------

export function generatePlatesChunk(job: ChunkJob): ChunkResult {
  const invs = (job.payload as { invs: Inv[] }).invs;
  const rng = new Rng(chunkSeed(job.seed, AREA_ID, job.chunk));
  const file = `plates_fuzz_${String(job.chunk).padStart(2, "0")}.jsonl`;
  const w = new ChunkWriter(job.outDir + file);
  const ctx: Ctx = { invs, stats: {}, slowest: { ms: 0, what: "" } };
  const table: [number, (rng: Rng, ctx: Ctx) => unknown][] = [
    [915, planCase],
    [28, chooseCase],
    [20, describeCase],
    [12, shorthandCase],
    [10, stepCase],
    [10, roundToStepCase],
    [5, loadableCase],
  ];
  const total = table.reduce((a, [wt]) => a + wt, 0);
  const n = Number(Deno.env.get("FUZZ_PILOT") ?? CHUNK);
  for (let i = 0; i < n; i++) {
    let r = rng.next() * total;
    let build = table[0][1];
    for (const [wt, fn] of table) {
      r -= wt;
      if (r < 0) {
        build = fn;
        break;
      }
    }
    w.line(build(rng, ctx));
  }
  const count = w.count;
  w.close();
  const bytes = Deno.statSync(job.outDir + file).size;
  return {
    chunk: job.chunk,
    file,
    count,
    bytes,
    stats: ctx.stats,
    slowest: ctx.slowest,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const t0 = performance.now();
  const seed = Number(Deno.env.get("FUZZ_SEED") ?? DEFAULT_SEED);
  const chunkLimit = Number(Deno.env.get("FUZZ_CHUNKS") ?? CHUNKS);
  removeStale(OUT_DIR, "plates_fuzz_");
  // The replay test refuses a directory whose manifest is not complete, so a killed
  // run cannot pass for a finished one.
  Deno.writeTextFileSync(
    OUT_DIR + "manifest.json",
    JSON.stringify({ version: 1, area: "plates", complete: false }) + "\n",
  );
  const invs = makeInventories(seed);
  Deno.writeTextFileSync(
    OUT_DIR + "inventories.json",
    JSON.stringify(
      {
        version: 1,
        seed,
        inventories: invs.map((i) =>
          i.plates.map((p) => ({
            weight: en(p.weight),
            pairs: p.pairs,
            color: p.color,
          }))
        ),
      },
    ) + "\n",
  );
  const jobs: ChunkJob[] = [];
  for (let k = 0; k < Math.min(CHUNKS, chunkLimit); k++) {
    jobs.push({
      area: "plates",
      chunk: k,
      outDir: OUT_DIR,
      seed,
      payload: { invs },
    });
  }
  const workers = defaultWorkers(jobs.length);
  console.log(
    `plates fuzz: ${jobs.length} chunks, ${workers} workers, seed ${seed}`,
  );
  const results = await runJobs(
    jobs,
    workers,
    (j) => Promise.resolve(generatePlatesChunk(j)),
  );
  Deno.writeTextFileSync(
    OUT_DIR + "manifest.json",
    JSON.stringify({
      version: 1,
      area: "plates",
      complete: true,
      seed,
      cases: results.reduce((a, r) => a + r.count, 0),
      files: results.map((r) => r.file),
    }) + "\n",
  );
  printSummary("plates fuzz", results, performance.now() - t0);
  console.log(`wrote ${OUT_DIR}`);
}

if (import.meta.main) await main();
