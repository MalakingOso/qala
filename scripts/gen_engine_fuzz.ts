// Differential fuzz oracle for the Rust engine (crates/qala-core, docs/rust-core.md R3).
//
//   deno task fuzz:engine        # same as: deno run -A scripts/gen_engine_fuzz.ts
//
// Runs the real TS engine (packages/engine) and writes random cases with the TS answers as
// JSON Lines under testdata/golden/engine/fuzz/ (gitignored):
//
//   e1rm_fuzz_00..09.jsonl   1,000,000 e1RM cases (observeSet, bestObservation, rtsLookup)
//   time_fuzz_00..04.jsonl   500,000 date, decay and readiness cases
//   manifest.json            what a complete run wrote
//
// The replay test is crates/qala-core/tests/fuzz_core.rs (fuzz_engine). Output is
// deterministic: a private seeded PRNG drives everything (FUZZ_SEED varies the corpus) and
// chunk k is seeded from (seed, k), so the worker count (FUZZ_WORKERS) changes nothing.
//
// Numbers that are NaN or +-Infinity are the strings "NaN", "Infinity" and "-Infinity".
// A set is {"w","r","completed", and when present "rpe","targetRpe","warmup","tested1rm"}.
// An observation is null or [e1rm, tested].
//
//   ["os", set, obs]                         observeSet
//   ["bo", [set...], obs]                    bestObservation
//   ["rl", reps, rpe, [pct|null, verified, useRule3Fallback]]     rtsLookup
//
// Dates are ISO 8601 strings with an explicit offset (or Z, or a bare date): the forms
// packages/engine writes and that crates/qala-core/src/time.rs parses. Instants cluster on
// DST transitions of several zones, month, year and leap-day boundaries, the 28 and 90 day
// window edges, and the ends of the supported years (0000 and 9999). The strings V8 accepts
// beyond ISO (a day that rolls over such as 2026-02-30, a time without an offset, a space
// for the T, +0530, 2026-06, six digit years) are left out on purpose: time.rs rejects them
// by design (its module docs), so they would only show a documented difference.
//
//   ["db", a, b, days|"NaN"]                 daysBetween ("NaN": TS gives NaN, Rust must error)
//   ["dv", x, dt, tau, y]                    decayValue
//   ["ai", x, dt, tau, k, input, y]          applyInput
//   ["mt", name, tau]                        muscleTau
//   ["dr", [[key, v]...], dt, tauFor, [[key, v]...]]   decayRecord; tauFor "muscleTau" or a tau
//   ["ak", key, days, result|"throw"]        addDaysKey
//   ["cs", now, [[distanceM, seconds, date]...], speed|null]       criticalSpeed
//   ["pz", now, prs, [[date, value]...], z|null]                   prsZScore
//   ["rc", now, state, checkin, muscles, readiness]    readiness core (state read as stored)
//   ["rd", now, state, checkin, muscles, readiness]    decay to now, then the readiness core
//   state = {updated, prsHistory: [[date, value]...], fatigueMuscle: {..}, fatigueDamage: {..},
//            fatigueSystemic}; checkin = {prs, soreness: {..}}
//   readiness = [score, prsZ|null, prsFlag, soreBlockedMuscles, reasons]

import { bestObservation, observeSet } from "../packages/engine/e1rm.ts";
import { rtsLookup } from "../packages/engine/rtsTable.ts";
import {
  applyInput,
  daysBetween,
  decayRecord,
  decayValue,
  muscleTau,
  TAU_DAMAGE,
  TAU_SYSTEMIC,
} from "../packages/engine/decay.ts";
import { addDaysKey } from "../packages/engine/availability.ts";
import { criticalSpeed } from "../packages/engine/running.ts";
import {
  predictReadiness as readinessCore,
  prsZScore,
} from "../packages/engine/readiness.ts";
import {
  type Checkin,
  initialState,
  type SetLog,
} from "../packages/engine/state.ts";
import {
  type ChunkJob,
  type ChunkResult,
  chunkSeed,
  ChunkWriter,
  defaultWorkers,
  dp,
  en,
  printSummary,
  removeStale,
  Rng,
  runJobs,
} from "./fuzz_lib.ts";

const CHUNK = 100_000;
const E1RM_CHUNKS = 10;
const TIME_CHUNKS = 5;
const AREA_ID = 2;
const DEFAULT_SEED = 20261014;
const OUT_DIR = new URL("../testdata/golden/engine/fuzz/", import.meta.url)
  .pathname;

// ---------------------------------------------------------------------------
// e1RM
// ---------------------------------------------------------------------------

const SPECIAL = [NaN, Infinity, -Infinity];

function pickReps(rng: Rng): number {
  return rng.weighted<() => number>([
    [52, () => rng.int(1, 6)],
    [20, () => rng.int(7, 15)],
    [7, () => rng.int(0, 24) + 0.5],
    [5, () => rng.pick(SPECIAL)],
    [6, () => dp(rng.float(0, 20), rng.int(1, 3))],
    [5, () => rng.pick([0, -1, -0.5, 30, 100, 1e6, 10.000000001, 0.999999999])],
    [5, () => rng.pick([1, 5, 8, 10])],
  ])();
}

const TABLE_RPE = [10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6];

function pickRpe(rng: Rng): number | undefined {
  return rng.weighted<() => number | undefined>([
    [34, () => rng.pick(TABLE_RPE)],
    [12, () => undefined],
    [
      9,
      () =>
        rng.pick(TABLE_RPE) +
        rng.pick([
          1e-10,
          -1e-10,
          5e-10,
          -5e-10,
          9e-10,
          1e-9,
          -1e-9,
          2e-9,
          -2e-9,
          1e-6,
          -1e-6,
        ]),
    ],
    [12, () => rng.pick([5, 5.5, 4, 3, 2, 1, 0, 10.5, 11, 12, 20])],
    [
      10,
      () =>
        rng.pick([
          7.25,
          7.75,
          8.1,
          9.9,
          9.499999999,
          9.5000000001,
          9.25,
          6.75,
          8.0000000001,
        ]),
    ],
    [4, () => rng.pick([-1, -10, -0.5])],
    [3, () => rng.pick(SPECIAL)],
    [6, () => dp(rng.float(0, 11), rng.int(1, 2))],
  ])();
}

function pickWeight(rng: Rng): number {
  return rng.weighted<() => number>([
    [52, () => 2.5 * rng.int(8, 240)],
    [10, () => dp(rng.float(0, 20), 1)],
    [7, () => 0],
    [5, () => rng.pick([-100, -2.5, -0.5, -1e-9])],
    [11, () => dp(rng.float(20, 450), rng.int(0, 3))],
    [4, () => rng.pick([1e4, 1e6, 1e7, 1e15, 1e300])],
    [3, () => rng.pick(SPECIAL)],
    [2, () => -0],
    [6, () => 5 * rng.int(9, 100)],
  ])();
}

function makeSet(rng: Rng): SetLog {
  const s: SetLog = {
    w: pickWeight(rng),
    r: pickReps(rng),
    completed: !rng.chance(0.1),
  };
  const rpe = pickRpe(rng);
  if (rpe !== undefined) s.rpe = rpe;
  if (rng.chance(0.35)) {
    const t = pickRpe(rng);
    if (t !== undefined) s.targetRpe = t;
  }
  if (rng.chance(0.08)) s.warmup = true;
  else if (rng.chance(0.05)) s.warmup = false;
  if (rng.chance(0.06)) s.tested1rm = true;
  return s;
}

function setOut(s: SetLog): Record<string, unknown> {
  const o: Record<string, unknown> = {
    w: en(s.w),
    r: en(s.r),
    completed: s.completed,
  };
  if (s.rpe !== undefined) o.rpe = en(s.rpe);
  if (s.targetRpe !== undefined) o.targetRpe = en(s.targetRpe);
  if (s.warmup !== undefined) o.warmup = s.warmup;
  if (s.tested1rm !== undefined) o.tested1rm = s.tested1rm;
  return o;
}

const obsOut = (o: { e1rm: number; tested: boolean } | null) =>
  o === null ? null : [en(o.e1rm), o.tested];

interface Ctx {
  stats: Record<string, number>;
  slowest: { ms: number; what: string };
}

function bump(ctx: Ctx, key: string): void {
  ctx.stats[key] = (ctx.stats[key] ?? 0) + 1;
}

function observeCase(rng: Rng, ctx: Ctx): unknown {
  const s = makeSet(rng);
  const o = observeSet(s);
  bump(
    ctx,
    o === null
      ? "e1rm.observe.none"
      : o.tested
      ? "e1rm.observe.tested"
      : "e1rm.observe.value",
  );
  if (o !== null && !Number.isFinite(o.e1rm)) {
    bump(ctx, "e1rm.observe.nonfinite");
  }
  return ["os", setOut(s), obsOut(o)];
}

function bestCase(rng: Rng, ctx: Ctx): unknown {
  const n = rng.weighted([[5, 0], [18, 1], [24, 2], [20, 3], [14, 4], [12, 5], [
    7,
    6,
  ]]);
  const sets: SetLog[] = [];
  for (let i = 0; i < n; i++) {
    if (sets.length && rng.chance(0.2)) {
      // A copy of an earlier set (ties keep the first), or the same load with a flag changed.
      const c = { ...rng.pick(sets) };
      if (rng.chance(0.4)) c.tested1rm = !c.tested1rm;
      if (rng.chance(0.3)) c.warmup = !c.warmup;
      sets.push(c);
    } else if (rng.chance(0.15) && sets.length) {
      // Same load and reps as an earlier set at another RPE: nearby estimates.
      const c = { ...rng.pick(sets) };
      const rpe = pickRpe(rng);
      if (rpe === undefined) delete c.rpe;
      else c.rpe = rpe;
      sets.push(c);
    } else {
      sets.push(makeSet(rng));
    }
  }
  const o = bestObservation(sets);
  bump(ctx, o === null ? "e1rm.best.none" : "e1rm.best.value");
  return ["bo", sets.map(setOut), obsOut(o)];
}

function lookupCase(rng: Rng, ctx: Ctx): unknown {
  // Half the lookups sit on or next to the table, so every cell and its edges get hit.
  const onTable = rng.chance(0.5);
  const reps = onTable
    ? rng.int(1, 6) + rng.pick([0, 0, 0, 0, 0.5, -1, 1])
    : pickReps(rng);
  const rpe = onTable
    ? rng.pick(TABLE_RPE) +
      rng.pick([0, 0, 0, 0, 1e-10, -1e-10, 1e-9, 2e-9, 0.25])
    : pickRpe(rng) ?? rng.pick(TABLE_RPE);
  const l = rtsLookup(reps, rpe);
  bump(ctx, l.pct === null ? "e1rm.lookup.miss" : "e1rm.lookup.hit");
  return ["rl", en(reps), en(rpe), [
    l.pct === null ? null : en(l.pct),
    l.verified,
    l.useRule3Fallback,
  ]];
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Epoch ms of a UTC calendar time; years 0 to 99 are real years here (Date.UTC would add 1900). */
function utcMs(
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
  s = 0,
  ms = 0,
): number {
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo, d);
  dt.setUTCHours(h, mi, s, ms);
  return dt.getTime();
}

const MS_MIN = utcMs(0, 0, 1);
const MS_MAX = utcMs(9999, 11, 31, 23, 59, 59, 999);

/** Day of month of the n-th (1-based) Sunday of a month, or the last one for n = 0. */
function sunday(y: number, mo: number, n: number): number {
  if (n === 0) {
    const last = new Date(utcMs(y, mo + 1, 0)).getUTCDate();
    const dow = new Date(utcMs(y, mo, last)).getUTCDay();
    return last - dow;
  }
  const dow = new Date(utcMs(y, mo, 1)).getUTCDay();
  return 1 + ((7 - dow) % 7) + (n - 1) * 7;
}

interface Transition {
  ms: number;
  before: number;
  after: number;
}

/** DST changes of a year for several zones: offsets in minutes before and after the instant. */
function transitions(y: number): Transition[] {
  const us = (off: number): Transition[] => [
    {
      ms: utcMs(y, 2, sunday(y, 2, 2), 2 - off / 60 + 0),
      before: off,
      after: off + 60,
    },
    {
      ms: utcMs(y, 10, sunday(y, 10, 1), 2 - (off + 60) / 60 + 0),
      before: off + 60,
      after: off,
    },
  ];
  const eu = (off: number): Transition[] => [
    { ms: utcMs(y, 2, sunday(y, 2, 0), 1), before: off, after: off + 60 },
    { ms: utcMs(y, 9, sunday(y, 9, 0), 1), before: off + 60, after: off },
  ];
  return [
    ...us(-300), // US Eastern
    ...us(-480), // US Pacific
    ...eu(0), // UK / Portugal
    ...eu(60), // Central Europe
    { ms: utcMs(y, 9, sunday(y, 9, 1) - 1, 16), before: 600, after: 660 }, // Sydney, spring
    { ms: utcMs(y, 3, sunday(y, 3, 1) - 1, 16), before: 660, after: 600 }, // Sydney, autumn
    { ms: utcMs(y, 8, sunday(y, 8, 0) - 1, 14), before: 720, after: 780 }, // Auckland
    { ms: utcMs(y, 9, sunday(y, 9, 1) - 1, 15, 30), before: 630, after: 660 }, // Lord Howe: 30 min
  ];
}

const FIXED_OFFSETS = [
  0,
  0,
  0,
  -300,
  -240,
  -480,
  -420,
  -360,
  60,
  120,
  330,
  345,
  540,
  600,
  660,
  720,
  780,
  840,
  -720,
  -210,
  -150,
  570,
  1439,
  -1439,
  -600,
];

function pickOffset(rng: Rng): number {
  if (rng.chance(0.04)) return rng.int(-95, 95) * 15;
  if (rng.chance(0.01)) return rng.int(-1439, 1439);
  return rng.pick(FIXED_OFFSETS);
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** An ISO 8601 rendering of an instant with an offset label, in one of the accepted shapes. */
function fmtIso(rng: Rng, ms: number, offMin: number): string {
  let local = ms + offMin * MIN;
  if (local < MS_MIN || local > MS_MAX) {
    offMin = 0;
    local = ms;
  }
  const iso = new Date(local).toISOString();
  const date = iso.slice(0, 10);
  const hh = iso.slice(11, 13);
  const mm = iso.slice(14, 16);
  const ss = iso.slice(17, 19);
  const frac = iso.slice(20, 23);
  let zone: string;
  if (offMin === 0) {
    zone = rng.weighted([[70, "Z"], [20, "+00:00"], [10, "-00:00"]]);
  } else {
    const a = Math.abs(offMin);
    zone = `${offMin < 0 ? "-" : "+"}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
  }
  const form = rng.weighted([
    [38, "ms"],
    [22, "nofrac"],
    [8, "short"],
    [8, "frac1"],
    [6, "frac2"],
    [7, "fraclong"],
    [4, "dateonly"],
    [7, "mid24"],
  ]);
  const midnight = hh === "00" && mm === "00" && ss === "00" && frac === "000";
  switch (form) {
    case "nofrac":
      if (frac === "000") return `${date}T${hh}:${mm}:${ss}${zone}`;
      break;
    case "short":
      if (ss === "00" && frac === "000") return `${date}T${hh}:${mm}${zone}`;
      break;
    case "frac1":
      if (frac.slice(1) === "00") {
        return `${date}T${hh}:${mm}:${ss}.${frac[0]}${zone}`;
      }
      break;
    case "frac2":
      if (frac[2] === "0") {
        return `${date}T${hh}:${mm}:${ss}.${frac.slice(0, 2)}${zone}`;
      }
      break;
    case "fraclong": {
      let extra = "";
      for (let i = rng.int(1, 6); i > 0; i--) extra += rng.int(0, 9);
      return `${date}T${hh}:${mm}:${ss}.${frac}${extra}${zone}`;
    }
    case "dateonly":
      // A bare date is UTC midnight.
      if (offMin === 0 && midnight) return date;
      break;
    case "mid24":
      if (midnight && local - DAY >= MS_MIN) {
        const prev = new Date(local - DAY).toISOString().slice(0, 10);
        return `${prev}T24:00:00${rng.chance(0.5) ? ".000" : ""}${zone}`;
      }
      break;
  }
  return `${date}T${hh}:${mm}:${ss}.${frac}${zone}`;
}

const SPECIAL_YEARS = [
  0,
  1,
  4,
  99,
  100,
  1582,
  1900,
  1969,
  1970,
  1996,
  2000,
  2024,
  2028,
  2096,
  2100,
  2400,
  9998,
  9999,
];

function pickYear(rng: Rng): number {
  return rng.weighted<() => number>([
    [60, () => rng.int(2015, 2040)],
    [14, () => rng.int(1970, 2100)],
    [16, () => rng.pick(SPECIAL_YEARS)],
    [6, () => rng.int(0, 9999)],
    [4, () => rng.int(1900, 1970)],
  ])();
}

const DELTAS = [
  0,
  1,
  -1,
  999,
  1000,
  -1000,
  59 * MIN + 59_999,
  MIN,
  HOUR - 1,
  HOUR,
  -HOUR,
  HOUR + 1,
  2 * HOUR,
  -2 * HOUR,
  23 * HOUR,
  24 * HOUR,
  -24 * HOUR,
  25 * HOUR,
  47 * HOUR,
  49 * HOUR,
  7 * DAY,
  28 * DAY,
  -28 * DAY,
  28 * DAY + 1,
  28 * DAY - 1,
  90 * DAY,
  -90 * DAY,
  90 * DAY + 1,
  90 * DAY - 1,
  365 * DAY,
  366 * DAY,
  -365 * DAY,
];

type Kind = "dst" | "month" | "random" | "leap" | "year-end" | "far";

interface Instant {
  ms: number;
  kind: Kind;
  /** Offsets that read naturally for this instant (its zone's before and after). */
  natural: number[];
}

function clampMs(ms: number): number {
  return Math.min(MS_MAX - 2 * DAY, Math.max(MS_MIN + 2 * DAY, ms));
}

function pickInstant(rng: Rng): Instant {
  const kind = rng.weighted<Kind>([
    [34, "dst"],
    [22, "month"],
    [22, "random"],
    [8, "leap"],
    [8, "year-end"],
    [6, "far"],
  ]);
  switch (kind) {
    case "dst": {
      const y = rng.chance(0.85) ? rng.int(1990, 2045) : pickYear(rng);
      const ts = transitions(y);
      const t = rng.pick(ts);
      return {
        ms: clampMs(t.ms + rng.pick(DELTAS)),
        kind,
        natural: [t.before, t.after],
      };
    }
    case "month": {
      const y = pickYear(rng);
      const mo = rng.int(0, 11);
      const first = utcMs(y, mo, 1);
      const base = rng.chance(0.5) ? first : utcMs(y, mo + 1, 1);
      return {
        ms: clampMs(
          base +
            rng.pick([
              0,
              -1,
              1,
              -1000,
              1000,
              -MIN,
              -HOUR,
              HOUR,
              -DAY,
              DAY,
              -DAY + 1,
            ]),
        ),
        kind,
        natural: [0],
      };
    }
    case "leap": {
      const y = rng.pick([
        1896,
        1900,
        1904,
        2000,
        2004,
        2023,
        2024,
        2025,
        2028,
        2096,
        2100,
        2104,
        2400,
        0,
        4,
        100,
      ]);
      const base = rng.pick([
        utcMs(y, 1, 28),
        utcMs(y, 1, 29),
        utcMs(y, 2, 1),
        utcMs(y, 1, 1),
      ]);
      return {
        ms: clampMs(
          base + rng.pick([0, -1, 1, HOUR, 12 * HOUR, DAY - 1, DAY, -DAY]),
        ),
        kind,
        natural: [0],
      };
    }
    case "year-end": {
      const y = pickYear(rng);
      const base = utcMs(y, 0, 1);
      return {
        ms: clampMs(
          base + rng.pick([0, -1, 1, -1000, -MIN, -HOUR, HOUR, -DAY, DAY]),
        ),
        kind,
        natural: [0],
      };
    }
    case "far":
      return {
        ms: rng.chance(0.5)
          ? MS_MIN + rng.int(0, 400 * 365 * 86400) * 1000 + rng.int(0, 999)
          : MS_MAX - rng.int(0, 400 * 365 * 86400) * 1000 - rng.int(0, 999),
        kind,
        natural: [0],
      };
    default:
      return {
        ms: rng.int(0, 130 * 365 * 86400) * 1000 + rng.int(0, 999),
        kind,
        natural: [0],
      };
  }
}

function labelOffset(rng: Rng, inst: Instant): number {
  return rng.chance(0.6) ? rng.pick(inst.natural) : pickOffset(rng);
}

/** Strings both V8 and time.rs read the same: ISO shapes, valid calendar dates. */
function validIso(rng: Rng, inst: Instant): string {
  return fmtIso(rng, inst.ms, labelOffset(rng, inst));
}

// Mutations that make a valid string invalid in V8 as well (checked with Date.parse).
function invalidIso(rng: Rng, ctx: Ctx): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    const base = fmtIso(rng, pickInstant(rng).ms, pickOffset(rng));
    const m =
      /^(\d{4})-(\d{2})-(\d{2})(T(\d{2}):(\d{2})(:(\d{2})(\.\d+)?)?)?(Z|[+-]\d{2}:\d{2})?$/
        .exec(base);
    if (!m) continue;
    const mutations: (() => string)[] = [
      () =>
        base.replace(
          /^(\d{4})-\d{2}/,
          `$1-${rng.pick(["00", "13", "14", "99"])}`,
        ),
      () =>
        base.replace(
          /^(\d{4}-\d{2})-\d{2}/,
          `$1-${rng.pick(["00", "32", "33", "99"])}`,
        ),
      () => base.replace(/T\d{2}/, `T${rng.pick(["25", "26", "30", "99"])}`),
      () =>
        base.replace(/T(\d{2}):\d{2}/, `T$1:${rng.pick(["60", "61", "99"])}`),
      () =>
        base.replace(/^(.{16}):\d{2}/, `$1:${rng.pick(["60", "61", "99"])}`),
      () =>
        base.replace(/[+-]\d{2}:\d{2}$/, `+${rng.pick(["24", "25", "99"])}:00`),
      () =>
        base.replace(
          /([+-]\d{2}):\d{2}$/,
          `$1:${rng.pick(["60", "75", "99"])}`,
        ),
      () => base.replace(/Z$/, ""),
      () => base + rng.pick([" ", "x", "Z", "\n", "00"]),
      () => " " + base,
      () => base.slice(0, rng.int(1, base.length - 1)),
      () => base.replace("T", rng.pick(["t ", "TT", "_", "x"])),
      () => base.replace(/-/, rng.pick(["/", ".", "_"])),
      () => base.replace(/\d/, "x"),
      () => base.replace(/:\d{2}Z$/, ":5Z"),
      () => base.replace(/\.\d+/, "."),
      () => "",
      () =>
        rng.pick([
          "tomorrow",
          "2026",
          "now",
          "NaN",
          "12:00",
          "2026-1-5",
          "20260601T120000Z",
        ]),
    ];
    const cand = rng.pick(mutations)();
    if (Number.isNaN(Date.parse(cand))) return cand;
    // V8 reads it (a lenient form): not generated, since time.rs rejects those by design.
    bump(ctx, "time.lenient_form_skipped");
  }
  return "";
}

function pickKey(rng: Rng): { key: string; ms: number } {
  const y = rng.weighted<() => number>([
    [70, () => rng.int(1990, 2045)],
    [20, () => rng.pick(SPECIAL_YEARS.filter((v) => v >= 1 && v <= 9998))],
    [10, () => rng.int(1, 9998)],
  ])();
  const mo = rng.int(0, 11);
  const dim = new Date(utcMs(y, mo + 1, 0)).getUTCDate();
  const d = rng.chance(0.4)
    ? rng.pick(
      [1, dim, dim - 1, 28, 29, 30, 31].filter((v) => v >= 1 && v <= dim),
    )
    : rng.int(1, dim);
  const ms = utcMs(y, mo, d);
  return { key: new Date(ms).toISOString().slice(0, 10), ms };
}

// ---------------------------------------------------------------------------
// Date, decay and readiness cases
// ---------------------------------------------------------------------------

function pairInstants(rng: Rng): { a: Instant; b: Instant; mode: string } {
  const mode = rng.weighted([
    [40, "delta"],
    [12, "same"],
    [12, "wall"],
    [18, "indep"],
    [10, "month"],
    [8, "far"],
  ]);
  const a = pickInstant(rng);
  const nat = a.natural;
  if (mode === "delta") {
    return {
      a,
      b: { ...a, ms: clampMs(a.ms + rng.pick(DELTAS)), natural: nat },
      mode,
    };
  }
  if (mode === "same") return { a, b: { ...a, natural: nat }, mode };
  if (mode === "wall") {
    // Same wall-clock reading under two offsets (an ambiguous or skipped local time).
    const off = nat.length > 1 ? nat[0] : 0;
    const off2 = nat.length > 1 ? nat[1] : 60;
    const local = a.ms + off * MIN;
    return {
      a: { ...a, natural: [off] },
      b: { ...a, ms: clampMs(local - off2 * MIN), natural: [off2] },
      mode,
    };
  }
  if (mode === "month") {
    const b = pickInstant(rng);
    return { a, b: { ...b, kind: "month" }, mode };
  }
  if (mode === "far") {
    return {
      a,
      b: { ms: rng.chance(0.5) ? MS_MIN : MS_MAX, kind: "far", natural: [0] },
      mode,
    };
  }
  return { a, b: pickInstant(rng), mode };
}

function daysBetweenCase(rng: Rng, ctx: Ctx): unknown {
  const { a, b, mode } = pairInstants(rng);
  bump(ctx, `time.db.${mode}`);
  bump(ctx, `time.instant.${a.kind}`);
  let sa = validIso(rng, a);
  let sb = validIso(rng, b);
  if (rng.chance(0.07)) {
    if (rng.chance(0.5)) sa = invalidIso(rng, ctx);
    else sb = invalidIso(rng, ctx);
    bump(ctx, "time.db.invalid_input");
  }
  const days = daysBetween(sa, sb);
  return ["db", sa, sb, Number.isNaN(days) ? "NaN" : en(days)];
}

const NUM_POOL = [
  0,
  1,
  -1,
  0.5,
  5,
  10,
  45,
  100,
  1e-9,
  1e-300,
  1e300,
  123.456,
  -123.456,
  NaN,
  Infinity,
  -Infinity,
  -0,
];
const DT_POOL = [
  0,
  -0,
  1,
  0.5,
  2,
  3.5,
  7,
  14,
  28,
  45,
  90,
  365,
  1e-9,
  1e-12,
  1e-300,
  1e3,
  1e6,
  1e300,
  -1,
  -0.5,
  -1e-9,
  -1e300,
  NaN,
  Infinity,
  -Infinity,
  1 / 24,
  59 / 1440,
  90.000001,
];
const TAU_POOL = [
  2,
  2.5,
  5,
  10,
  42,
  45,
  1,
  0.5,
  100,
  1e-9,
  1e9,
  0,
  -0,
  -1,
  -45,
  NaN,
  Infinity,
  -Infinity,
  1e300,
  1e-300,
];

function pickNum(rng: Rng): number {
  return rng.chance(0.6)
    ? dp(rng.float(-50, 400), rng.int(0, 4))
    : rng.pick(NUM_POOL);
}
function pickDt(rng: Rng): number {
  return rng.chance(0.5)
    ? dp(rng.float(0, 100), rng.int(0, 6))
    : rng.pick(DT_POOL);
}
function pickTau(rng: Rng): number {
  return rng.chance(0.3)
    ? dp(rng.float(0.1, 60), rng.int(0, 3))
    : rng.pick(TAU_POOL);
}

function decayValueCase(rng: Rng, ctx: Ctx): unknown {
  const x = pickNum(rng);
  const dt = pickDt(rng);
  const tau = pickTau(rng);
  bump(ctx, "time.decay_value");
  return ["dv", en(x), en(dt), en(tau), en(decayValue(x, dt, tau))];
}

function applyInputCase(rng: Rng, ctx: Ctx): unknown {
  const x = pickNum(rng);
  const dt = pickDt(rng);
  const tau = pickTau(rng);
  const k = pickNum(rng);
  const input = pickNum(rng);
  bump(ctx, "time.apply_input");
  return [
    "ai",
    en(x),
    en(dt),
    en(tau),
    en(k),
    en(input),
    en(applyInput(x, dt, tau, k, input)),
  ];
}

const MUSCLES = [
  "quads",
  "quadriceps",
  "hamstrings",
  "glutes",
  "calves",
  "lats",
  "upperback",
  "upper-back",
  "back",
  "lowerback",
  "lower-back",
  "chest",
  "delts",
  "biceps",
  "triceps",
  "traps",
  "core",
  "forearms",
  "abs",
];

// U+0085, U+180E, U+200B are not JS whitespace; the rest are.
const SPACES = [
  " ",
  "\t",
  "\n",
  "\r",
  "\v",
  "\f",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  "　",
  "﻿",
  "\u0085",
  "᠎",
  "​",
];

function muscleName(rng: Rng): string {
  let name = rng.pick(MUSCLES);
  if (rng.chance(0.4)) name = name.toUpperCase();
  else if (rng.chance(0.3)) name = name[0].toUpperCase() + name.slice(1);
  if (rng.chance(0.35)) {
    const i = rng.int(0, name.length);
    name = name.slice(0, i) + rng.pick(["_", " ", "_", ...SPACES]) +
      name.slice(i);
  }
  if (rng.chance(0.08)) name = rng.pick(SPACES) + name + rng.pick(SPACES);
  if (rng.chance(0.03)) {
    name = name.replace(/a/, rng.pick(["İ", "å", "Σ", "K"]));
  }
  if (rng.chance(0.02)) name = "";
  return name;
}

function muscleTauCase(rng: Rng, ctx: Ctx): unknown {
  const name = muscleName(rng);
  bump(ctx, "time.muscle_tau");
  return ["mt", name, muscleTau(name)];
}

function decayRecordCase(rng: Rng, ctx: Ctx): unknown {
  const n = rng.int(0, 6);
  const entries: [string, number][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const k = muscleName(rng);
    if (seen.has(k) || /^\d+$/.test(k)) continue; // JS puts integer-like keys first
    seen.add(k);
    entries.push([k, pickNum(rng)]);
  }
  const dt = pickDt(rng);
  const byMuscle = rng.chance(0.6);
  const tau = byMuscle ? 0 : pickTau(rng);
  const rec: Record<string, number> = {};
  for (const [k, v] of entries) rec[k] = v;
  const out = decayRecord(rec, dt, byMuscle ? muscleTau : () => tau);
  bump(ctx, "time.decay_record");
  return [
    "dr",
    entries.map(([k, v]) => [k, en(v)]),
    en(dt),
    byMuscle ? "muscleTau" : en(tau),
    Object.entries(out).map(([k, v]) => [k, en(v)]),
  ];
}

function badKey(rng: Rng): string {
  const { key } = pickKey(rng);
  return rng.pick<() => string>([
    () => key.replace(/^(\d{4})-\d{2}/, `$1-${rng.pick(["00", "13", "99"])}`),
    () =>
      key.replace(/^(\d{4}-\d{2})-\d{2}/, `$1-${rng.pick(["00", "32", "99"])}`),
    () => key.slice(0, rng.int(0, 9)),
    () => key + rng.pick(["x", " ", "T", "0", "-01"]),
    () => key.replace(/-/g, rng.pick(["/", "", "."])),
    () => key.replace(/^\d/, rng.pick(["x", "-", " "])),
    () => rng.pick(["", "today", "NaN", "2026-6-1", "2026-06-1", "20260601"]),
  ])();
}

function addDaysKeyCase(rng: Rng, ctx: Ctx): unknown {
  if (rng.chance(0.07)) {
    const key = badKey(rng);
    const days = rng.int(-40, 40);
    try {
      addDaysKey(key, days);
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      bump(ctx, "time.add_days.invalid_key");
      return ["ak", key, days, "throw"];
    }
    // V8 read it (a lenient key such as 2026-02-30): time.rs rejects those by design.
    bump(ctx, "time.lenient_form_skipped");
  }
  const { key, ms } = pickKey(rng);
  const span = rng.weighted<number>([[60, 40], [25, 800], [10, 40_000], [
    5,
    3_000_000,
  ]]);
  let days = rng.int(-span, span);
  if (rng.chance(0.3)) {
    days = rng.pick([
      0,
      1,
      -1,
      7,
      -7,
      28,
      29,
      30,
      31,
      365,
      366,
      -365,
      -366,
      1461,
      -1461,
      36524,
      146097,
    ]);
  }
  const target = ms + days * DAY;
  if (target < MS_MIN || target > MS_MAX) days = 0;
  const result = addDaysKey(key, days);
  bump(ctx, "time.add_days");
  return ["ak", key, days, result];
}

function effortDate(rng: Rng, nowMs: number, nowOff: number): string {
  // Around the 90 day cutoff, where `>=` matters.
  const edge = rng.pick([
    0,
    0,
    1,
    -1,
    1000,
    -1000,
    HOUR,
    -HOUR,
    DAY,
    -DAY,
    23 * HOUR,
    25 * HOUR,
  ]);
  const ms = clampMs(
    nowMs - 90 * DAY + edge + (rng.chance(0.6) ? 0 : rng.int(-30, 100) * DAY),
  );
  return fmtIso(rng, ms, rng.chance(0.5) ? nowOff : pickOffset(rng));
}

function criticalSpeedCase(rng: Rng, ctx: Ctx): unknown {
  const now = pickInstant(rng);
  const nowOff = labelOffset(rng, now);
  const nowIso = fmtIso(rng, now.ms, nowOff);
  const nowMs = Date.parse(nowIso);
  const n = rng.int(0, 12);
  const efforts: { distanceM: number; seconds: number; date: string }[] = [];
  for (let i = 0; i < n; i++) {
    const distanceM = rng.weighted<number>([
      [30, 400],
      [30, 800],
      [30, 5000],
      [6, 1000],
      [2, 399.9999],
      [2, 5000.0001],
    ]);
    const base = distanceM === 400 ? 70 : distanceM === 800 ? 170 : 1300;
    let seconds = dp(base * rng.float(0.8, 1.3), rng.int(0, 2));
    if (rng.chance(0.04)) {
      seconds = rng.pick([0, -5, NaN, 1e-9, base, Infinity]);
    }
    if (rng.chance(0.15) && efforts.length) seconds = rng.pick(efforts).seconds; // ties
    let date = effortDate(rng, nowMs, nowOff);
    if (rng.chance(0.04)) date = invalidIso(rng, ctx);
    efforts.push({ distanceM, seconds, date });
  }
  // Often make sure all three distances are present so a speed comes out.
  if (rng.chance(0.55)) {
    for (const d of [400, 800, 5000]) {
      if (!efforts.some((e) => e.distanceM === d)) {
        efforts.push({
          distanceM: d,
          seconds: dp(
            (d === 400 ? 70 : d === 800 ? 170 : 1300) * rng.float(0.8, 1.3),
            2,
          ),
          date: effortDate(rng, nowMs, nowOff),
        });
      }
    }
  }
  rng.shuffle(efforts);
  const cs = criticalSpeed(efforts, nowIso);
  bump(
    ctx,
    cs === null ? "time.critical_speed.null" : "time.critical_speed.value",
  );
  return [
    "cs",
    nowIso,
    efforts.map((e) => [en(e.distanceM), en(e.seconds), e.date]),
    cs === null ? null : en(cs),
  ];
}

function historyAround(
  rng: Rng,
  ctx: Ctx,
  nowMs: number,
  nowOff: number,
  n: number,
) {
  const hist: { date: string; value: number }[] = [];
  for (let i = 0; i < n; i++) {
    const edge = rng.pick([
      0,
      0,
      1,
      -1,
      1000,
      -1000,
      HOUR,
      -HOUR,
      DAY,
      -DAY,
      23 * HOUR,
      25 * HOUR,
    ]);
    const ms = clampMs(
      nowMs - 28 * DAY + edge + (rng.chance(0.55) ? 0 : rng.int(-20, 40) * DAY),
    );
    let date = fmtIso(rng, ms, rng.chance(0.5) ? nowOff : pickOffset(rng));
    if (rng.chance(0.03)) date = invalidIso(rng, ctx);
    let value = rng.int(1, 10);
    if (rng.chance(0.2)) value = dp(rng.float(1, 10), 1);
    if (rng.chance(0.01)) value = rng.pick(SPECIAL);
    hist.push({ date, value });
  }
  return hist;
}

const PRS_POOL = [
  0,
  1,
  2,
  3,
  3.9999,
  4,
  4.0001,
  5,
  6,
  7,
  8,
  9,
  10,
  10.5,
  11,
  -1,
  4.5,
  NaN,
  Infinity,
  -Infinity,
];

function prsZCase(rng: Rng, ctx: Ctx): unknown {
  const now = pickInstant(rng);
  const nowOff = labelOffset(rng, now);
  const nowIso = fmtIso(rng, now.ms, nowOff);
  const nowMs = Date.parse(nowIso);
  const hist = historyAround(
    rng,
    ctx,
    nowMs,
    nowOff,
    rng.weighted([[8, 0], [10, 1], [30, 2], [20, 3], [15, 5], [10, 8], [
      7,
      14,
    ]]),
  );
  const prs = rng.chance(0.6) ? rng.int(1, 10) : rng.pick(PRS_POOL);
  const z = prsZScore(hist, nowIso, prs);
  bump(ctx, z === null ? "time.prs_z.null" : "time.prs_z.value");
  return [
    "pz",
    nowIso,
    en(prs),
    hist.map((h) => [h.date, en(h.value)]),
    z === null ? null : en(z),
  ];
}

interface MiniState {
  updated: string;
  prsHistory: { date: string; value: number }[];
  fatigueMuscle: Record<string, number>;
  fatigueDamage: Record<string, number>;
  fatigueSystemic: number;
}

const FATIGUE_MUSCLES = [
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "lats",
  "chest",
  "delts",
  "biceps",
  "triceps",
  "upper_back",
  "lower-back",
  "Upper Back",
  "core",
];

function fatigueMap(rng: Rng, keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) {
    if (rng.chance(0.7)) {
      out[k] = rng.chance(0.85)
        ? dp(rng.float(0, 14), rng.int(0, 3))
        : rng.pick([0, 20, 1e-12, -1, NaN, Infinity]);
    }
  }
  return out;
}

function readinessCase(rng: Rng, ctx: Ctx, withDecay: boolean): unknown {
  const now = pickInstant(rng);
  const nowOff = labelOffset(rng, now);
  const nowIso = fmtIso(rng, now.ms, nowOff);
  const nowMs = Date.parse(nowIso);
  // `updated` is the last applied input: a little to a few weeks before `now` (equal for the core).
  const back = withDecay
    ? rng.pick([
      0,
      1,
      -1,
      HOUR,
      DAY,
      2 * DAY,
      3.5 * DAY,
      7 * DAY,
      14 * DAY,
      30 * DAY,
      90 * DAY,
      -DAY,
      -HOUR,
    ])
    : 0;
  const updated = withDecay
    ? fmtIso(
      rng,
      clampMs(nowMs - back),
      rng.chance(0.5) ? nowOff : pickOffset(rng),
    )
    : nowIso;
  const keys = rng.shuffle([...FATIGUE_MUSCLES]).slice(0, rng.int(1, 8));
  const session = rng.chance(0.15)
    ? []
    : rng.shuffle([...keys, ...(rng.chance(0.3) ? ["chest", "quads"] : [])])
      .slice(0, rng.int(1, keys.length + 1));
  const soreness: Record<string, number> = {};
  for (
    const m of rng.shuffle([...keys, "chest"]).slice(
      0,
      rng.int(0, keys.length + 1),
    )
  ) {
    soreness[m] = rng.chance(0.9)
      ? rng.int(1, 4)
      : rng.pick([0, 5, 3.5, 4.0000001]);
  }
  const state: MiniState = {
    updated,
    prsHistory: historyAround(
      rng,
      ctx,
      nowMs,
      nowOff,
      rng.weighted([[10, 0], [10, 1], [30, 3], [30, 6], [20, 12]]),
    ),
    fatigueMuscle: fatigueMap(rng, keys),
    fatigueDamage: fatigueMap(rng, keys),
    fatigueSystemic: rng.chance(0.85)
      ? dp(rng.float(0, 9), rng.int(0, 3))
      : rng.pick([0, 6, 12, 1e-12, -1, NaN]),
  };
  const checkin: Checkin = {
    prs: rng.chance(0.7) ? rng.int(1, 10) : rng.pick(PRS_POOL),
    soreness: soreness as Checkin["soreness"],
  };
  const full = { ...initialState(), ...state };
  let s = full;
  if (withDecay) {
    // The decay logSession applies (decayAll in packages/engine/mod.ts, which is not exported),
    // on the fields the readiness core reads.
    const dt = daysBetween(state.updated, nowIso);
    s = structuredClone(full);
    if (dt > 0) {
      s.fatigueMuscle = decayRecord(s.fatigueMuscle, dt, muscleTau);
      for (const k of Object.keys(s.fatigueDamage)) {
        s.fatigueDamage[k] = decayValue(s.fatigueDamage[k], dt, TAU_DAMAGE);
      }
      s.fatigueSystemic = decayValue(s.fatigueSystemic, dt, TAU_SYSTEMIC);
    }
  }
  const r = readinessCore(s, checkin, session, nowIso);
  bump(ctx, withDecay ? "time.readiness_decay" : "time.readiness_core");
  if (r.reasons.length) bump(ctx, "time.readiness.with_reasons");
  return [
    withDecay ? "rd" : "rc",
    nowIso,
    {
      updated: state.updated,
      prsHistory: state.prsHistory.map((h) => [h.date, en(h.value)]),
      fatigueMuscle: Object.fromEntries(
        Object.entries(state.fatigueMuscle).map(([k, v]) => [k, en(v)]),
      ),
      fatigueDamage: Object.fromEntries(
        Object.entries(state.fatigueDamage).map(([k, v]) => [k, en(v)]),
      ),
      fatigueSystemic: en(state.fatigueSystemic),
    },
    {
      prs: en(checkin.prs),
      soreness: Object.fromEntries(
        Object.entries(checkin.soreness).map(([k, v]) => [k, en(v as number)]),
      ),
    },
    session,
    [
      en(r.score),
      r.prsZ === null ? null : en(r.prsZ),
      r.prsFlag,
      r.soreBlockedMuscles,
      r.reasons,
    ],
  ];
}

// ---------------------------------------------------------------------------
// Chunks
// ---------------------------------------------------------------------------

type Builder = (rng: Rng, ctx: Ctx) => unknown;

function pickBuilder(
  rng: Rng,
  table: [number, Builder][],
  total: number,
): Builder {
  let r = rng.next() * total;
  for (const [wt, fn] of table) {
    r -= wt;
    if (r < 0) return fn;
  }
  return table[0][1];
}

const E1RM_TABLE: [number, Builder][] = [[55, observeCase], [25, bestCase], [
  20,
  lookupCase,
]];
const TIME_TABLE: [number, Builder][] = [
  [300, daysBetweenCase],
  [60, decayValueCase],
  [60, applyInputCase],
  [40, muscleTauCase],
  [40, decayRecordCase],
  [200, addDaysKeyCase],
  [60, criticalSpeedCase],
  [100, prsZCase],
  [60, (rng, ctx) => readinessCase(rng, ctx, false)],
  [80, (rng, ctx) => readinessCase(rng, ctx, true)],
];

export function generateEngineChunk(job: ChunkJob): ChunkResult {
  const rng = new Rng(chunkSeed(job.seed, AREA_ID, job.chunk));
  const isE1rm = job.chunk < E1RM_CHUNKS;
  const file = isE1rm
    ? `e1rm_fuzz_${p2(job.chunk)}.jsonl`
    : `time_fuzz_${p2(job.chunk - E1RM_CHUNKS)}.jsonl`;
  const table = isE1rm ? E1RM_TABLE : TIME_TABLE;
  const total = table.reduce((a, [wt]) => a + wt, 0);
  const w = new ChunkWriter(job.outDir + file);
  const ctx: Ctx = { stats: {}, slowest: { ms: 0, what: "" } };
  const n = Number(Deno.env.get("FUZZ_PILOT") ?? CHUNK);
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const line = pickBuilder(rng, table, total)(rng, ctx);
    const ms = performance.now() - t0;
    if (ms > ctx.slowest.ms) {
      ctx.slowest = { ms, what: JSON.stringify(line).slice(0, 200) };
    }
    w.line(line);
  }
  const count = w.count;
  w.close();
  return {
    chunk: job.chunk,
    file,
    count,
    bytes: Deno.statSync(job.outDir + file).size,
    stats: ctx.stats,
    slowest: ctx.slowest,
  };
}

async function main(): Promise<void> {
  const t0 = performance.now();
  const seed = Number(Deno.env.get("FUZZ_SEED") ?? DEFAULT_SEED);
  const e1rmChunks = Number(Deno.env.get("FUZZ_E1RM_CHUNKS") ?? E1RM_CHUNKS);
  const timeChunks = Number(Deno.env.get("FUZZ_TIME_CHUNKS") ?? TIME_CHUNKS);
  removeStale(OUT_DIR, "e1rm_fuzz_");
  removeStale(OUT_DIR, "time_fuzz_");
  Deno.writeTextFileSync(
    OUT_DIR + "manifest.json",
    JSON.stringify({ version: 1, area: "engine", complete: false }) + "\n",
  );
  const jobs: ChunkJob[] = [];
  for (let k = 0; k < Math.min(E1RM_CHUNKS, e1rmChunks); k++) {
    jobs.push({ area: "engine", chunk: k, outDir: OUT_DIR, seed });
  }
  for (let k = 0; k < Math.min(TIME_CHUNKS, timeChunks); k++) {
    jobs.push({
      area: "engine",
      chunk: E1RM_CHUNKS + k,
      outDir: OUT_DIR,
      seed,
    });
  }
  const workers = defaultWorkers(jobs.length);
  console.log(
    `engine fuzz: ${jobs.length} chunks, ${workers} workers, seed ${seed}`,
  );
  const results = await runJobs(
    jobs,
    workers,
    (j) => Promise.resolve(generateEngineChunk(j)),
  );
  Deno.writeTextFileSync(
    OUT_DIR + "manifest.json",
    JSON.stringify({
      version: 1,
      area: "engine",
      complete: true,
      seed,
      cases: results.reduce((a, r) => a + r.count, 0),
      files: results.map((r) => r.file),
    }) + "\n",
  );
  printSummary("engine fuzz", results, performance.now() - t0);
  console.log(`wrote ${OUT_DIR}`);
}

if (import.meta.main) await main();
