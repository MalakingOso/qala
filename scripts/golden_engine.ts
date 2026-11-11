// Golden-file oracle for the Rust port of packages/engine (crates/qala-core).
//
//   deno task golden:engine     # same as: deno run -A scripts/golden_engine.ts
//
// Runs the real TS engine and writes testdata/golden/engine/*.json. The file
// formats and the conventions Rust must follow are in
// testdata/golden/engine/README.md. Output is deterministic: Math.random is
// the seeded PRNG from golden_liftoscript_lib.ts and every scenario reseeds
// it, so regenerating gives byte-identical files.

import { canon, reseed, toJson } from "./golden_liftoscript_lib.ts";
import {
  calibrate,
  logSession,
  predictReadiness as predictReadinessTs,
} from "../packages/engine/mod.ts";
import {
  applyInput,
  daysBetween,
  decayRecord,
  decayValue,
  muscleTau,
  TAU_DAMAGE,
  TAU_FITNESS_LIFT,
  TAU_FITNESS_RUN,
  TAU_SYSTEMIC,
} from "../packages/engine/decay.ts";
import { bestObservation, observeSet } from "../packages/engine/e1rm.ts";
import { rtsLookup } from "../packages/engine/rtsTable.ts";
import {
  initKalman,
  kalmanPredict,
  kalmanUpdate,
  thetaOf,
} from "../packages/engine/kalman.ts";
import {
  criticalSpeed,
  descentDamage,
  gapDistanceM,
  gapFactor,
  gradeAdjustedPace,
  gradeAdjustedSpeed,
  intensityFactor,
  meanGapFactor,
  minettiCost,
  minettiRatio,
  ngp,
  ngpFromGapDistance,
  rbeFactor,
  riegel,
  rtss,
  rtssFromRun,
  runSetEquivalents,
  type RunZone,
  runZone,
  SRPE_PER_100_RTSS_PRIOR,
  srpeLoadRatio,
  thresholdPaceFromRace,
  vdotFromEffort,
} from "../packages/engine/running.ts";
import {
  fatigueLocal,
  predictReadiness as readinessCore,
  type Readiness,
} from "../packages/engine/readiness.ts";
import {
  addDaysKey,
  applyInjuryToCheckin,
  classifyDay,
  coversDay,
  guardExercise,
  injuredOn,
  normMuscle,
  reasonOn,
  shiftsPlan,
} from "../packages/engine/availability.ts";
import {
  type Checkin,
  type EngineState,
  initialState,
  type KalmanState,
  type LiftEntry,
  type LiftWorkout,
  type RunWorkout,
  type SetLog,
  type Workout,
} from "../packages/engine/state.ts";
import type {
  Availability,
  DaySkip,
  SkipReason,
} from "../packages/core/schema.ts";

// ---------------------------------------------------------------------------
// Output plumbing
// ---------------------------------------------------------------------------

const OUT_DIR = new URL("../testdata/golden/engine/", import.meta.url).pathname;

/** Relative tolerance recorded on every case whose output holds floats. */
const TOL = 1e-9;

const DAY = 86400000;
const HOUR = 3600000;
const MIN = 60000;

interface GoldenCase {
  name: string;
  input: unknown;
  expected: unknown;
  tolerance?: number;
}

type Oracle = "ts" | "ts+decay";

/** Fail the generation when a scenario did not reach the branch it targets. */
function must(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`golden_engine: scenario check failed: ${msg}`);
}

/** JSON round trip through canon: exactly what lands in the file. */
function freeze<T>(v: T): T {
  return JSON.parse(JSON.stringify(canon(v))) as T;
}

/** Undo canon's non-finite strings so TS runs on the numbers they stand for. */
function revive(v: unknown): unknown {
  if (v === "NaN") return NaN;
  if (v === "Infinity") return Infinity;
  if (v === "-Infinity") return -Infinity;
  if (Array.isArray(v)) return v.map(revive);
  if (v !== null && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = revive(x);
    return o;
  }
  return v;
}

/**
 * One case. `input` is frozen to canonical JSON first and `call` runs on a
 * fresh revived copy of it, so Rust replays exactly what TS ran on.
 */
function mk<I>(
  name: string,
  input: I,
  call: (input: I) => unknown,
  tolerance?: number,
): GoldenCase {
  const frozen = freeze(input);
  const out = freeze(call(revive(freeze(input)) as I));
  const c: GoldenCase = { name, input: frozen, expected: out };
  if (tolerance !== undefined) c.tolerance = tolerance;
  return c;
}

/** A case of a multi-function file: input is `{fn, args}`. */
function fcase<A>(
  fn: string,
  name: string,
  args: A,
  call: (args: A) => unknown,
  tolerance?: number,
): GoldenCase {
  const frozen = freeze(args);
  const out = freeze(call(revive(freeze(args)) as A));
  const c: GoldenCase = { name, input: { fn, args: frozen }, expected: out };
  if (tolerance !== undefined) c.tolerance = tolerance;
  return c;
}

const counts: [string, number][] = [];

/** Write one golden file now (the Rust worker polls the directory). */
function emit(file: string, oracle: Oracle, cases: GoldenCase[]): void {
  const names = new Set<string>();
  for (const c of cases) {
    const key = `${(c.input as { fn?: string }).fn ?? ""}::${c.name}`;
    must(!names.has(key), `duplicate case name in ${file}: ${key}`);
    names.add(key);
  }
  const lines = cases.map((c) => "  " + toJson(c, undefined).trimEnd());
  const text = `{\n "fn": ${
    JSON.stringify(file)
  },\n "version": 1,\n "oracle": ${JSON.stringify(oracle)},\n "cases": [\n${
    lines.join(",\n")
  }\n ]\n}\n`;
  Deno.mkdirSync(OUT_DIR, { recursive: true });
  Deno.writeTextFileSync(`${OUT_DIR}${file}.json`, text);
  counts.push([file, cases.length]);
  console.log(`${file}.json: ${cases.length} cases, ${text.length} bytes`);
}

// ---------------------------------------------------------------------------
// Date helpers (strings only, never a Date object in a case)
// ---------------------------------------------------------------------------

type Style = "z" | "zs" | "-5" | "-4" | "+530";

/** Format epoch ms as an ISO 8601 string in one of the forms the engine sees. */
function fmt(ms: number, style: Style = "z"): string {
  if (style === "z") return new Date(ms).toISOString();
  if (style === "zs") return new Date(ms).toISOString().replace(".000Z", "Z");
  const off = style === "-5" ? -300 : style === "-4" ? -240 : 330;
  const local = new Date(ms + off * MIN).toISOString();
  const sign = off < 0 ? "-" : "+";
  const a = Math.abs(off);
  const hh = String(Math.floor(a / 60)).padStart(2, "0");
  const mm = String(a % 60).padStart(2, "0");
  const base = local.slice(0, 19);
  const frac = local.slice(19, 23); // ".mmm"
  return `${base}${frac === ".000" ? "" : frac}${sign}${hh}:${mm}`;
}

const ms = (iso: string): number => Date.parse(iso);

// ---------------------------------------------------------------------------
// decay.json
// ---------------------------------------------------------------------------

function genDecay(): void {
  const cs: GoldenCase[] = [];
  const db = (name: string, a: string, b: string) =>
    cs.push(
      fcase(
        "daysBetween",
        name,
        { aIso: a, bIso: b },
        (x) => daysBetween(x.aIso, x.bIso),
        TOL,
      ),
    );
  // Ported from decay_test.ts.
  db(
    "DST spring forward (Mar 8 2026): noon EST to noon EDT two days later is 47 h",
    "2026-03-07T12:00:00-05:00",
    "2026-03-09T12:00:00-04:00",
  );
  db(
    "DST fall back (Nov 1 2026): 49 h",
    "2026-10-31T12:00:00-04:00",
    "2026-11-02T12:00:00-05:00",
  );
  db(
    "month boundary Jan to Feb",
    "2026-01-31T00:00:00Z",
    "2026-02-02T00:00:00Z",
  );
  db(
    "month boundary Feb to Mar",
    "2026-02-28T00:00:00Z",
    "2026-03-01T00:00:00Z",
  );
  // Extras.
  db("same instant", "2026-09-14T17:30:00.000Z", "2026-09-14T17:30:00.000Z");
  db(
    "same instant in two offset forms",
    "2026-09-14T17:30:00.000Z",
    "2026-09-14T13:30:00-04:00",
  );
  db(
    "negative gap (b before a)",
    "2026-09-14T17:30:00.000Z",
    "2026-09-13T17:30:00.000Z",
  );
  db(
    "offset forms without milliseconds",
    "2026-09-14T17:30:00Z",
    "2026-09-15T23:00:00+05:30",
  );
  db(
    "milliseconds survive",
    "2026-09-14T17:30:00.000Z",
    "2026-09-14T17:30:00.250Z",
  );
  db(
    "epoch zero (initialState.updated) to a 2026 date",
    "1970-01-01T00:00:00.000Z",
    "2026-01-05T22:30:00.000Z",
  );
  db("leap day 2028", "2028-02-28T12:00:00Z", "2028-03-01T12:00:00Z");
  db("year boundary", "2026-12-31T23:30:00-05:00", "2027-01-01T00:30:00-05:00");
  db(
    "DST spring forward, local clock reads 24 h apart",
    "2026-03-07T20:00:00-05:00",
    "2026-03-08T20:00:00-04:00",
  );
  db(
    "DST fall back, local clock reads 24 h apart",
    "2026-10-31T20:00:00-04:00",
    "2026-11-01T20:00:00-05:00",
  );

  const dv = (name: string, x: number, dtDays: number, tau: number) =>
    cs.push(
      fcase(
        "decayValue",
        name,
        { x, dtDays, tau },
        (a) => decayValue(a.x, a.dtDays, a.tau),
        TOL,
      ),
    );
  // Ported from decay_test.ts.
  dv("dt 0 returns x", 100, 0, 45);
  dv("dt equal to tau gives x/e", 100, 45, 45);
  dv("negative dt clamps (returns x)", 100, -3, 45);
  // Extras.
  dv("fitness tau, one week", 12.5, 7, 45);
  dv("muscle tau 2.5, half a day", 8, 0.5, 2.5);
  dv("damage tau 5, three days", 3.25, 3, 5);
  dv("systemic tau 10, 21 days", 6.4, 21, 10);
  dv("run fitness tau 42, 90 days", 2.2, 90, 42);
  dv("x zero stays zero", 0, 10, 2);
  dv("tiny dt", 100, 1e-9, 45);
  dv("x negative decays toward zero", -5, 2, 2);
  dv("very large dt underflows toward zero", 100, 5000, 2);
  dv("nonfinite: NaN dt returns x", 100, NaN, 45);
  dv("nonfinite: infinite dt gives 0", 100, Infinity, 45);
  dv("nonfinite: negative infinite dt returns x", 100, -Infinity, 45);
  dv("nonfinite: tau 0 gives 0", 100, 1, 0);
  dv("nonfinite: infinite tau gives x", 100, 1, Infinity);

  const ai = (
    name: string,
    x: number,
    dtDays: number,
    tau: number,
    k: number,
    input: number,
  ) =>
    cs.push(
      fcase(
        "applyInput",
        name,
        { x, dtDays, tau, k, input },
        (a) => applyInput(a.x, a.dtDays, a.tau, a.k, a.input),
        TOL,
      ),
    );
  ai("decay then add k*input (decay_test)", 100, 45, 45, 2, 10);
  ai("dt 0 only adds", 5, 0, 10, 0.5, 4);
  ai("negative dt only adds", 5, -2, 10, 0.5, 4);
  ai("zero input", 7, 3, 2.5, 1, 0);

  const mt = (name: string, muscle: string) =>
    cs.push(fcase("muscleTau", name, { muscle }, (a) => muscleTau(a.muscle)));
  // Ported from decay_test.ts.
  for (
    const m of [
      "chest",
      "triceps",
      "quads",
      "hamstrings",
      "glutes",
      "calves",
      "back",
      "lats",
    ]
  ) mt(`decay_test: ${m}`, m);
  // Extras: aliases, case, separators. muscleTau strips whitespace and
  // underscores but NOT hyphens (the set holds the hyphenated spellings).
  mt("alias quadriceps", "quadriceps");
  mt("case: Quadriceps", "Quadriceps");
  mt("case: QUADS", "QUADS");
  mt("case: Lats", "Lats");
  mt("underscore: upper_back", "upper_back");
  mt("space: upper back", "upper back");
  mt("hyphen: upper-back is in the set", "upper-back");
  mt("joined: upperback", "upperback");
  mt("joined: lowerback", "lowerback");
  mt("camel case: lowerBack", "lowerBack");
  mt("space: lower back", "lower back");
  mt("underscore: lower_back", "lower_back");
  mt("hyphen and case: Lower-Back", "Lower-Back");
  mt("hyphen not stripped: quad-riceps is unknown", "quad-riceps");
  mt("hyphen not stripped: ham-strings is unknown", "ham-strings");
  mt("surrounding whitespace: ' quads '", " quads ");
  mt("inner whitespace is removed: 'q u a d s'", "q u a d s");
  mt("tab and newline: '\\tquads\\n'", "\tquads\n");
  mt("non-breaking space is whitespace: 'upper\\u00a0back'", "upper back");
  mt("mixed separators: Upper_ Back", "Upper_ Back");
  mt("unknown: shoulders", "shoulders");
  mt("unknown: quad", "quad");
  mt("unknown: glute (singular)", "glute");
  mt("unknown: calf", "calf");
  mt("unknown: lat", "lat");
  mt("unknown: biceps", "biceps");
  mt("unknown: abs", "abs");
  mt("unknown: empty string", "");
  mt("unknown: only separators", " _ ");

  // decayRecord: `tauFor` is encoded as the string "muscleTau" or a number
  // (a constant tau). Output key order follows the input.
  const dr = (
    name: string,
    rec: Record<string, number>,
    dtDays: number,
    tauFor: "muscleTau" | number,
  ) =>
    cs.push(
      fcase(
        "decayRecord",
        name,
        { rec, dtDays, tauFor },
        (a) =>
          decayRecord(
            a.rec,
            a.dtDays,
            a.tauFor === "muscleTau" ? muscleTau : (() => a.tauFor as number),
          ),
        TOL,
      ),
    );
  dr(
    "muscle taus by key",
    { quads: 10, chest: 10, lats: 10, "Lower Back": 4, upper_back: 4 },
    2,
    "muscleTau",
  );
  dr("dt 0 copies", { quads: 3.5, chest: 1 }, 0, "muscleTau");
  dr("negative dt copies", { quads: 3.5, chest: 1 }, -1, "muscleTau");
  dr("empty record", {}, 3, "muscleTau");
  dr("constant tau 5 (damage)", { quads: 2, calves: 0.5 }, 4, 5);

  cs.push(
    fcase("TAU_CONSTANTS", "tau constants", {}, () => ({
      TAU_FITNESS_LIFT,
      TAU_SYSTEMIC,
      TAU_FITNESS_RUN,
      TAU_DAMAGE,
    })),
  );
  emit("decay", "ts", cs);
}

// ---------------------------------------------------------------------------
// e1rm.json
// ---------------------------------------------------------------------------

function genE1rm(): void {
  const cs: GoldenCase[] = [];
  const obs = (name: string, s: SetLog) =>
    cs.push(fcase("observeSet", name, { s }, (a) => observeSet(a.s), TOL));
  const best = (name: string, sets: SetLog[]) =>
    cs.push(
      fcase("bestObservation", name, { sets }, (a) =>
        bestObservation(a.sets), TOL),
    );
  const S = (
    w: number,
    r: number,
    o: Partial<SetLog> = {},
  ): SetLog => ({ w, r, completed: true, ...o });

  // Ported from e1rm_test.ts.
  obs("rule 1: single at RPE 9.5 is a tested 1RM", S(200, 1, { rpe: 9.5 }));
  obs(
    "rule 1: flagged test attempt at any RPE",
    S(190, 1, { rpe: 8, tested1rm: true }),
  );
  obs("rule 2: 100 x 5 @ 8 uses the RTS table", S(100, 5, { rpe: 8 }));
  obs("rule 2: 83.7 x 6 @ 10 (Helms anchor)", S(83.7, 6, { rpe: 10 }));
  obs(
    "rule 3: 100 x 5 targetRpe 8 uses Epley with target RIR",
    S(100, 5, { targetRpe: 8 }),
  );
  obs("rule 3: 100 x 5 no RPE uses Epley with RIR 0", S(100, 5));
  obs("rule 3: single with no RPE is the load", S(150, 1));
  obs("rule 4: 12 reps @ 9 gives no observation", S(60, 12, { rpe: 9 }));
  obs("rule 4: 12 reps no RPE gives no observation", S(60, 12));

  // Grid: reps 1..12 x (no RPE, 6..10 in 0.5 steps).
  const rpes: (number | undefined)[] = [
    undefined,
    6,
    6.5,
    7,
    7.5,
    8,
    8.5,
    9,
    9.5,
    10,
  ];
  for (let reps = 1; reps <= 12; reps++) {
    rpes.forEach((rpe, i) => {
      const w = 60 + 2.5 * ((reps * 13 + i * 7) % 40);
      obs(
        `grid: ${w} x ${reps} @ ${rpe === undefined ? "no RPE" : rpe}`,
        rpe === undefined ? S(w, reps) : S(w, reps, { rpe }),
      );
    });
  }
  // Grid: targetRpe only (no logged RPE), reps 1..12.
  for (let reps = 1; reps <= 12; reps++) {
    for (const t of [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]) {
      const w = 50 + 2.5 * ((reps * 11 + t * 3) % 44);
      obs(
        `target-only: ${w} x ${reps} target RPE ${t}`,
        S(w, reps, { targetRpe: t }),
      );
    }
  }
  // Logged RPE wins over targetRpe.
  obs(
    "logged RPE 8 wins over targetRpe 9",
    S(100, 5, { rpe: 8, targetRpe: 9 }),
  );
  obs(
    "logged RPE 9 wins over targetRpe 7",
    S(100, 4, { rpe: 9, targetRpe: 7 }),
  );
  // Tested and flagged variants.
  obs("tested1rm at 5 reps is the load", S(180, 5, { tested1rm: true }));
  obs(
    "tested1rm with RPE 6 is the load",
    S(180, 3, { tested1rm: true, rpe: 6 }),
  );
  obs("tested1rm on 12 reps is the load", S(60, 12, { tested1rm: true }));
  obs("tested single at RPE 10", S(225, 1, { rpe: 10 }));
  obs(
    "single at RPE 9.5 flagged and unflagged agree",
    S(225, 1, { rpe: 9.5, tested1rm: true }),
  );
  obs("single at RPE 9 uses the table (95.5)", S(225, 1, { rpe: 9 }));
  obs("single at RPE 9.4 is not tested", S(225, 1, { rpe: 9.4 }));
  // Incomplete sets give null whatever else they carry.
  obs("incomplete set", S(100, 5, { rpe: 8, completed: false }));
  obs(
    "incomplete tested set",
    S(300, 1, { tested1rm: true, completed: false }),
  );
  obs("incomplete 12 reps", S(60, 12, { completed: false }));
  // observeSet does not look at `warmup` (bestObservation does).
  obs(
    "warmup flag is ignored by observeSet",
    S(200, 5, { rpe: 8, warmup: true }),
  );
  // Extra fields the engine ignores.
  obs(
    "targetRepsMin/Max and jointPain are ignored",
    S(100, 5, { rpe: 8, targetRepsMin: 4, targetRepsMax: 6, jointPain: true }),
  );
  // Off-table and unusual RPE.
  const oddRpe = [
    0,
    4,
    5,
    5.5,
    7.25,
    8.75,
    9.9,
    10.5,
    11,
    7.9999999995,
    8.0000000005,
    8.000000002,
  ];
  for (const rpe of oddRpe) {
    for (const reps of [1, 3, 5, 6, 7, 10, 11]) {
      const w = 80 + 2.5 * ((reps * 5 + Math.round(rpe * 4)) % 30);
      obs(`off-table RPE ${rpe}: ${w} x ${reps}`, S(w, reps, { rpe }));
    }
  }
  // Half-integer and zero reps.
  for (const reps of [0, 0.5, 1.5, 2.5, 5.5, 9.5, 10.5]) {
    for (const rpe of [undefined, 7, 8.5, 9.5, 10]) {
      const w = 70 + 2.5 * ((Math.round(reps * 2) * 3 + (rpe ?? 0)) % 20);
      obs(
        `fractional reps ${reps} @ ${rpe === undefined ? "no RPE" : rpe}: ${w}`,
        rpe === undefined ? S(w, reps) : S(w, reps, { rpe }),
      );
    }
  }
  obs(
    "0 reps, target RPE 9: reps+RIR is exactly 1, returns the load",
    S(100, 0, { targetRpe: 9 }),
  );
  obs(
    "0.5 reps @ 9.5: reps+RIR is exactly 1, returns the load",
    S(100, 0.5, { rpe: 9.5 }),
  );
  obs("1 rep, target RPE 9: reps+RIR is 2, Epley", S(100, 1, { targetRpe: 9 }));
  obs(
    "10 reps @ 10 is reps+RIR 10, still valid (off table)",
    S(70, 10, { rpe: 10 }),
  );
  obs("11 reps @ 10 exceeds reps+RIR 10", S(70, 11, { rpe: 10 }));
  obs("10 reps no RPE is Epley", S(70, 10));
  obs("11 reps no RPE is none", S(70, 11));
  obs("10.5 reps no RPE is none", S(70, 10.5));
  obs("reps 3 @ RPE 11 (RIR -1)", S(100, 3, { rpe: 11 }));
  // Weights.
  obs("zero weight", S(0, 5, { rpe: 8 }));
  obs("fractional weight", S(142.3, 4, { rpe: 8.5 }));
  obs("large weight", S(612.5, 2, { rpe: 9 }));

  // bestObservation ported from e1rm_test.ts.
  best("picks max, skips warmup and incomplete", [
    S(100, 5, { rpe: 8 }),
    S(200, 5, { rpe: 8, warmup: true }),
    S(105, 5, { rpe: 8, completed: false }),
    S(102, 5, { rpe: 8 }),
  ]);
  best("empty list", []);
  best("only warmups", [
    S(60, 5, { warmup: true }),
    S(80, 3, { warmup: true }),
  ]);
  best("only incomplete", [S(100, 5, { completed: false })]);
  best("only reps over 10", [S(50, 12), S(50, 15, { rpe: 8 })]);
  best("single set", [S(140, 3, { rpe: 8 })]);
  // Ties keep the first (strict > comparison), which decides the tested flag.
  best("tie: tested first wins (tested true)", [
    S(100, 1, { rpe: 9.5 }),
    S(100, 1),
  ]);
  best("tie: untested first wins (tested false)", [
    S(100, 1),
    S(100, 1, { rpe: 9.5 }),
  ]);
  best("tested set loses to a higher untested e1RM", [
    S(100, 1, { rpe: 10 }),
    S(100, 5, { rpe: 8 }),
  ]);
  best("tested set beats lower untested e1RM", [
    S(150, 1, { tested1rm: true }),
    S(100, 5, { rpe: 8 }),
  ]);
  best("heavier warmup is skipped", [
    S(300, 1, { warmup: true, tested1rm: true }),
    S(150, 3, { rpe: 8 }),
  ]);
  best("typical working sets, descending quality", [
    S(120, 5, { rpe: 8 }),
    S(120, 5, { rpe: 8.5 }),
    S(120, 5, { rpe: 9 }),
    S(110, 8, { rpe: 9 }),
  ]);
  best("no RPE sets use Epley", [S(100, 5), S(95, 8), S(90, 10)]);
  best("target-only sets", [
    S(100, 5, { targetRpe: 8 }),
    S(100, 5, { targetRpe: 9 }),
  ]);
  // Seeded random lists.
  reseed(2001);
  const rnd = (n: number) => Math.floor(Math.random() * n);
  for (let i = 0; i < 40; i++) {
    const n = rnd(7);
    const sets: SetLog[] = [];
    for (let j = 0; j < n; j++) {
      const w = 40 + 2.5 * rnd(80);
      const r = 1 + rnd(12);
      const o: Partial<SetLog> = {};
      const k = rnd(11);
      if (k > 0) o.rpe = Math.min(10, 6 + (k - 1) * 0.5);
      if (rnd(3) === 0) o.targetRpe = 6 + rnd(9) * 0.5;
      if (rnd(10) === 0) o.completed = false;
      if (rnd(7) === 0) o.warmup = true;
      if (rnd(20) === 0) o.tested1rm = true;
      sets.push(S(w, r, o));
    }
    best(`random list ${i + 1} (${n} sets)`, sets);
  }

  // rtsLookup: exact outputs (table constants and flags), no tolerance.
  const rts = (name: string, reps: number, rpe: number) =>
    cs.push(
      fcase("rtsLookup", name, { reps, rpe }, (a) => rtsLookup(a.reps, a.rpe)),
    );
  for (let reps = 0; reps <= 8; reps++) {
    for (const rpe of [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]) {
      rts(`table: reps ${reps} RPE ${rpe}`, reps, rpe);
    }
  }
  for (const reps of [0.5, 1.5, 2.5, 5.5, 6.5, -1, 9, 100]) {
    rts(`non-integer or out of range reps ${reps} RPE 8`, reps, 8);
  }
  for (const rpe of [5, 5.5, 10.5, 11, 0, -1, 7.25, 8.75]) {
    rts(`off-table RPE ${rpe} reps 5`, 5, rpe);
  }
  rts(
    "RPE within 1e-9 of a row (7.9999999995) matches the row",
    5,
    7.9999999995,
  );
  rts(
    "RPE within 1e-9 of a row (8.0000000005) matches the row",
    5,
    8.0000000005,
  );
  rts("RPE 1e-8 off a row does not match", 5, 8.00000001);
  rts("nonfinite: NaN RPE", 5, NaN);
  rts("nonfinite: NaN reps", NaN, 8);
  rts("nonfinite: infinite reps", Infinity, 8);
  emit("e1rm", "ts", cs);
}

// ---------------------------------------------------------------------------
// kalman.json
// ---------------------------------------------------------------------------

/** The mulberry32 in kalman_test.ts (a separate generator from the lib PRNG). */
function mulberryTest(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genKalman(): void {
  const cs: GoldenCase[] = [];
  const init = (
    name: string,
    p0: number,
    k1: number,
    thetaPrior: number,
    R?: number,
  ) => {
    const args: { p0: number; k1: number; thetaPrior: number; R?: number } = {
      p0,
      k1,
      thetaPrior,
    };
    if (R !== undefined) args.R = R;
    cs.push(
      fcase(
        "initKalman",
        name,
        args,
        (a) => initKalman(a.p0, a.k1, a.thetaPrior, a.R),
        TOL,
      ),
    );
  };
  init("lift prior, default R", 100, 0.5, 4);
  init("lift prior, R given", 100, 0.5, 4, 9);
  init("kalman_test init(170, 0.35, 4, 9)", 170, 0.35, 4, 9);
  init("kalman_test init(150, 15, 4, 4)", 150, 15, 4, 4);
  init("engine state seed init(est, 0.5, 4)", 142.5, 0.5, 4);
  init("run prior", 40, 1, 2, 1);
  init("run prior, default R", 40, 1, 2);
  init("k1 zero", 100, 0, 4);
  init("negative k1", 100, -0.5, 4);
  init("theta prior zero", 100, 0.5, 0);
  init("R zero", 100, 0.5, 4, 0);
  init("large R", 100, 0.5, 4, 100);

  type Step = { fitness: number; fatigue: number; y: number; ns?: number };

  /**
   * Chain: step n's input state is step n-1's expected state. `ns` omitted
   * means the noiseScale argument is absent from the input (TS default 1).
   */
  const chain = (prefix: string, start: KalmanState, steps: Step[]) => {
    let k: KalmanState = freeze(start);
    const states: KalmanState[] = [k];
    steps.forEach((s, i) => {
      const args: {
        k: KalmanState;
        fitness: number;
        fatigue: number;
        y: number;
        noiseScale?: number;
      } = { k, fitness: s.fitness, fatigue: s.fatigue, y: s.y };
      if (s.ns !== undefined) args.noiseScale = s.ns;
      const c = fcase(
        "kalmanUpdate",
        `${prefix} step ${String(i + 1).padStart(2, "0")} (obs ${k.obs} -> ${
          k.obs + 1
        }${s.ns === undefined ? "" : `, noiseScale ${s.ns}`})`,
        args,
        (a) => kalmanUpdate(a.k, a.fitness, a.fatigue, a.y, a.noiseScale),
        TOL,
      );
      cs.push(c);
      k = c.expected as KalmanState;
      states.push(k);
    });
    return states;
  };

  // kalman_test.ts synthetic recovery: 30 observations from the true model
  // p0=200, k1=0.5, theta=4, plus its noise. Crosses the 20-observation unlock.
  {
    const p0 = 200;
    const k1 = 0.5;
    const k2 = k1 * 4;
    const rand = mulberryTest(42);
    const steps: Step[] = [];
    for (let i = 0; i < 30; i++) {
      const F = 6.7 * i;
      const G = 6 + 5 * Math.sin(i * 1.7) + (i % 3 === 0 ? 3 : 0);
      const noise = (rand() + rand() + rand() - 1.5) * 2 * 3;
      steps.push({ fitness: F, fatigue: G, y: p0 + k1 * F - k2 * G + noise });
    }
    const states = chain(
      "recovery chain (kalman_test)",
      initKalman(170, 0.35, 4, 9),
      steps,
    );
    must(states[30].obs === 30, "recovery chain reaches 30 observations");
    must(
      states[21].k2 !== states[21].thetaPrior * states[21].k1,
      "theta unlocks after 20 observations",
    );
    // kalmanPredict and thetaOf on the chain states (first, locked, at the
    // unlock boundary, unlocked, final).
    for (const i of [0, 1, 2, 10, 19, 20, 21, 25, 30]) {
      const k = states[i];
      cs.push(
        fcase(
          "kalmanPredict",
          `recovery chain state ${i}, F 100 G 8`,
          { k, fitness: 100, fatigue: 8 },
          (a) => kalmanPredict(a.k, a.fitness, a.fatigue),
          TOL,
        ),
      );
      cs.push(
        fcase(
          "thetaOf",
          `recovery chain state ${i}`,
          { k },
          (a) => thetaOf(a.k),
          TOL,
        ),
      );
    }
  }

  // Tested-1RM noise (0.25) on every step after the anchor.
  {
    reseed(2101);
    const steps: Step[] = [];
    let y = 150;
    for (let i = 0; i < 24; i++) {
      y += (Math.random() - 0.4) * 6;
      steps.push({
        fitness: 2 * i,
        fatigue: 3 + Math.random() * 6,
        y: Math.round(y * 10) / 10,
        ns: 0.25,
      });
    }
    chain("noiseScale 0.25 chain", initKalman(150, 15, 4, 4), steps);
  }
  // Doubled noise (run before a lower-body lift).
  {
    reseed(2102);
    const steps: Step[] = [];
    let y = 120;
    for (let i = 0; i < 23; i++) {
      y += (Math.random() - 0.45) * 5;
      steps.push({
        fitness: 1.5 * i,
        fatigue: 2 + Math.random() * 8,
        y: Math.round(y * 10) / 10,
        ns: 2,
      });
    }
    chain("noiseScale 2 chain", initKalman(110, 0.5, 4), steps);
  }
  // Mixed noise scales, default noiseScale (key omitted) on some steps. 28
  // updates cross the unlock.
  {
    reseed(2103);
    const steps: Step[] = [];
    let y = 180;
    const scales = [undefined, 1, 0.25, 2];
    for (let i = 0; i < 28; i++) {
      y += (Math.random() - 0.35) * 4;
      steps.push({
        fitness: 3.1 * i,
        fatigue: Math.random() * 10,
        y: Math.round(y * 10) / 10,
        ns: scales[i % 4],
      });
    }
    const states = chain(
      "mixed noise chain",
      initKalman(165, 0.5, 4, 4),
      steps,
    );
    must(states[28].obs === 28, "mixed chain reaches 28 observations");
  }
  // Run-side filter, started from the literal initialState().kalmanRun (note
  // the P matrix differs from initKalman(40, 1, 2, 1)). 25 VDOT-like updates.
  {
    reseed(2104);
    const steps: Step[] = [];
    let y = 42;
    let f = 0;
    for (let i = 0; i < 25; i++) {
      y += (Math.random() - 0.45) * 1.2;
      f += 0.4 + Math.random() * 0.8;
      steps.push({
        fitness: Math.round(f * 100) / 100,
        fatigue: Math.round(Math.random() * 500) / 100,
        y: Math.round(y * 100) / 100,
        ns: 1,
      });
    }
    chain(
      "run filter chain from initialState().kalmanRun",
      initialState().kalmanRun,
      steps,
    );
  }
  // First observation anchors p0 and ignores noiseScale.
  const first = (
    name: string,
    k: KalmanState,
    F: number,
    G: number,
    y: number,
    ns?: number,
  ) => {
    const args: {
      k: KalmanState;
      fitness: number;
      fatigue: number;
      y: number;
      noiseScale?: number;
    } = { k, fitness: F, fatigue: G, y };
    if (ns !== undefined) args.noiseScale = ns;
    cs.push(
      fcase(
        "kalmanUpdate",
        name,
        args,
        (a) => kalmanUpdate(a.k, a.fitness, a.fatigue, a.y, a.noiseScale),
        TOL,
      ),
    );
  };
  first(
    "first observation anchors p0 (kalman_test seed)",
    initKalman(150, 15, 4, 4),
    1,
    1,
    200,
    1,
  );
  first(
    "first observation, noiseScale 0.25 changes nothing",
    initKalman(150, 15, 4, 4),
    1,
    1,
    200,
    0.25,
  );
  first(
    "first observation, noiseScale omitted",
    initKalman(150, 15, 4, 4),
    1,
    1,
    200,
  );
  first(
    "first observation with zero fitness and fatigue",
    initKalman(100, 0.5, 4),
    0,
    0,
    142.5,
  );
  first(
    "first observation with fatigue",
    initKalman(100, 0.5, 4),
    12.5,
    7.25,
    160,
  );
  first(
    "first observation, engine seed (initKalman(est, 0.5, 4))",
    initKalman(142.5, 0.5, 4),
    3.2,
    14,
    150,
  );
  first(
    "first observation on the run filter",
    initialState().kalmanRun,
    0,
    0,
    44.5,
    1,
  );
  first(
    "first observation, run filter with fitness",
    initialState().kalmanRun,
    1.2,
    3.4,
    47.1,
  );
  // After the anchor, the effect of noiseScale on the very next update.
  {
    const base = kalmanUpdate(initKalman(150, 15, 4, 4), 1, 1, 200, 1);
    for (const ns of [undefined, 0.25, 1, 2, 4]) {
      first(
        `second update from the anchored seed, noiseScale ${ns ?? "omitted"}`,
        base,
        2,
        1.5,
        212,
        ns,
      );
    }
  }
  // Unlock boundary: obs 19 (locked), 20 (first unlocked update) and 21.
  {
    const states: KalmanState[] = [freeze(initKalman(100, 0.5, 4, 4))];
    let k = states[0];
    for (let i = 0; i < 22; i++) {
      k = kalmanUpdate(k, 4 * i, 5 + (i % 4), 100 + 2 * i + (i % 3), 1);
      states.push(freeze(k));
    }
    for (const n of [18, 19, 20, 21]) {
      first(
        `unlock boundary: update from obs ${n}`,
        states[n],
        4 * n,
        5 + (n % 4),
        100 + 2 * n + 1,
        1,
      );
    }
  }
  // thetaOf edge cases.
  const th = (name: string, k: KalmanState) =>
    cs.push(fcase("thetaOf", name, { k }, (a) => thetaOf(a.k), TOL));
  th("fresh lift prior", initKalman(100, 0.5, 4));
  th("fresh run prior", initKalman(40, 1, 2));
  th("k1 zero falls back to thetaPrior", initKalman(100, 0, 4));
  th("k1 zero with a custom k2", { ...initKalman(100, 0, 3), k2: 7 });
  th("negative k1", { ...initKalman(100, 0.5, 4), k1: -0.5, k2: 1 });
  th("k2 drifted", { ...initKalman(100, 0.5, 4), k2: 3.1 });
  // kalmanPredict edge cases.
  const pr = (name: string, k: KalmanState, fitness: number, fatigue: number) =>
    cs.push(
      fcase(
        "kalmanPredict",
        name,
        { k, fitness, fatigue },
        (a) => kalmanPredict(a.k, a.fitness, a.fatigue),
        TOL,
      ),
    );
  pr("fresh prior, zero inputs", initKalman(100, 0.5, 4), 0, 0);
  pr("fresh prior, fitness only", initKalman(100, 0.5, 4), 40, 0);
  pr("fresh prior, fatigue only", initKalman(100, 0.5, 4), 0, 12);
  pr("fresh prior, both", initKalman(100, 0.5, 4), 40, 12);
  pr("run prior", initialState().kalmanRun, 5, 3);
  pr("negative fatigue", initKalman(100, 0.5, 4), 10, -2);
  emit("kalman", "ts", cs);
}

// ---------------------------------------------------------------------------
// running.json
// ---------------------------------------------------------------------------

function genRunning(): void {
  const cs: GoldenCase[] = [];

  const GRADES = [
    -1,
    -0.5,
    -0.3,
    -0.25,
    -0.2,
    -0.18,
    -0.15,
    -0.1,
    -0.05,
    -0.02,
    -0.01,
    0,
    0.01,
    0.02,
    0.05,
    0.1,
    0.15,
    0.2,
    0.25,
    0.3,
    0.45,
    0.5,
    1,
  ];
  for (const grade of GRADES) {
    cs.push(
      fcase(
        "minettiCost",
        `grade ${grade}`,
        { grade },
        (a) => minettiCost(a.grade),
        TOL,
      ),
    );
  }
  for (const grade of GRADES) {
    cs.push(
      fcase(
        "minettiRatio",
        `grade ${grade}`,
        { grade },
        (a) => minettiRatio(a.grade),
        TOL,
      ),
    );
  }
  const GAP = [
    ...GRADES,
    0.03,
    0.07,
    0.08,
    -0.03,
    -0.04,
    -0.06,
    -0.08,
    -0.12,
    -0.17,
    -0.179999,
    -0.180001,
    -0.0001,
    1e-9,
    -1e-9,
  ];
  for (const grade of GAP) {
    const label = grade >= 0
      ? "uphill or flat"
      : grade <= -0.18
      ? "beyond -18%"
      : "downhill";
    cs.push(
      fcase(
        "gapFactor",
        `${label}: grade ${grade}`,
        { grade },
        (a) => gapFactor(a.grade),
        TOL,
      ),
    );
  }
  cs.push(
    fcase(
      "gapFactor",
      "nonfinite: NaN grade",
      { grade: NaN },
      (a) => gapFactor(a.grade),
      TOL,
    ),
  );
  for (
    const [speedMps, grade] of [
      [3, 0],
      [3, 0.05],
      [3, -0.05],
      [4.2, 0.1],
      [2.5, -0.1],
      [3.5, -0.2],
      [0, 0.05],
      [5, 0.3],
      [3.3, -0.0001],
    ]
  ) {
    cs.push(
      fcase(
        "ngp",
        `speed ${speedMps} m/s grade ${grade}`,
        { speedMps, grade },
        (a) => ngp(a.speedMps, a.grade),
        TOL,
      ),
    );
  }

  type Profile = { grade: number; meters: number }[];
  const mg = (name: string, profile?: Profile) => {
    const args: { profile?: Profile } = {};
    if (profile !== undefined) args.profile = profile;
    cs.push(
      fcase("meanGapFactor", name, args, (a) => meanGapFactor(a.profile), TOL),
    );
  };
  mg("profile omitted (key absent)");
  mg("empty profile", []);
  mg("zero total meters", [{ grade: 0.05, meters: 0 }]);
  mg("zero meters in every segment", [{ grade: 0.05, meters: 0 }, {
    grade: -0.05,
    meters: 0,
  }]);
  mg("negative total meters", [{ grade: 0.1, meters: -100 }, {
    grade: 0.05,
    meters: 50,
  }]);
  mg("single flat segment", [{ grade: 0, meters: 1000 }]);
  mg("single uphill segment", [{ grade: 0.06, meters: 2000 }]);
  mg("single downhill segment", [{ grade: -0.08, meters: 2000 }]);
  mg("rolling course", [
    { grade: 0.03, meters: 1500 },
    { grade: -0.03, meters: 1500 },
    { grade: 0.05, meters: 800 },
    { grade: -0.06, meters: 1200 },
    { grade: 0, meters: 5000 },
  ]);
  mg("segment beyond -18% counts as 1.0", [
    { grade: -0.25, meters: 300 },
    { grade: 0.02, meters: 700 },
  ]);
  mg("steep uphill mix", [{ grade: 0.2, meters: 500 }, {
    grade: 0.3,
    meters: 250,
  }]);
  mg("downhill clamp at 0.88", [{ grade: -0.04, meters: 4000 }, {
    grade: -0.1,
    meters: 1000,
  }]);
  mg("fractional meters", [{ grade: 0.012, meters: 123.456 }, {
    grade: -0.007,
    meters: 987.654,
  }]);

  for (
    const [ngpMps, thresholdPaceMps] of [
      [3.3, 3.3],
      [4, 3.3],
      [2, 3.3],
      [3.9, 5],
      [1, 7.5],
      [0, 3.3],
    ]
  ) {
    cs.push(
      fcase(
        "intensityFactor",
        `ngp ${ngpMps} threshold ${thresholdPaceMps}`,
        { ngpMps, thresholdPaceMps },
        (a) => intensityFactor(a.ngpMps, a.thresholdPaceMps),
        TOL,
      ),
    );
  }
  cs.push(
    fcase(
      "intensityFactor",
      "nonfinite: threshold 0",
      { ngpMps: 3, thresholdPaceMps: 0 },
      (a) => intensityFactor(a.ngpMps, a.thresholdPaceMps),
      TOL,
    ),
  );
  cs.push(
    fcase(
      "intensityFactor",
      "nonfinite: 0 over 0",
      { ngpMps: 0, thresholdPaceMps: 0 },
      (a) => intensityFactor(a.ngpMps, a.thresholdPaceMps),
      TOL,
    ),
  );
  for (
    const [hours, IF] of [
      [1, 1],
      [0.5, 0.8],
      [2.17, 0.65],
      [0, 1],
      [3.5, 1.2],
      [1, 0],
      [0.25, 1.5],
      [4, 0.5],
    ]
  ) {
    cs.push(
      fcase(
        "rtss",
        `${hours} h at IF ${IF}`,
        { hours, IF },
        (a) => rtss(a.hours, a.IF),
        TOL,
      ),
    );
  }

  for (
    const [distanceM, seconds] of [
      [400, 80],
      [400, 95],
      [800, 170],
      [800, 200],
      [1000, 210],
      [1000, 204],
      [1609.34, 330],
      [3000, 700],
      [5000, 1250],
      [5000, 1200],
      [5000, 1500],
      [5000, 1800],
      [8000, 2400],
      [10000, 2700],
      [10000, 3600],
      [10000, 4200],
      [15000, 5400],
      [21097.5, 5400],
      [21097.5, 7200],
      [42195, 12600],
      [42195, 15600],
      [35000, 13800],
      [100, 13],
      [60000, 25000],
    ]
  ) {
    cs.push(
      fcase(
        "vdotFromEffort",
        `${distanceM} m in ${seconds} s`,
        { distanceM, seconds },
        (a) => vdotFromEffort(a.distanceM, a.seconds),
        TOL,
      ),
    );
  }
  cs.push(
    fcase(
      "vdotFromEffort",
      "nonfinite: zero seconds",
      { distanceM: 1000, seconds: 0 },
      (a) => vdotFromEffort(a.distanceM, a.seconds),
      TOL,
    ),
  );
  cs.push(
    fcase(
      "vdotFromEffort",
      "zero distance",
      { distanceM: 0, seconds: 600 },
      (a) => vdotFromEffort(a.distanceM, a.seconds),
      TOL,
    ),
  );

  for (
    const [seconds1, d1, d2] of [
      [1200, 5000, 10000],
      [1200, 5000, 5000],
      [80, 400, 800],
      [170, 800, 5000],
      [2700, 10000, 21097.5],
      [5400, 21097.5, 42195],
      [1500, 5000, 1000],
      [600, 3000, 1500],
      [1200, 5000, 0],
    ]
  ) {
    cs.push(
      fcase(
        "riegel",
        `${seconds1} s over ${d1} m to ${d2} m`,
        { seconds1, d1, d2 },
        (a) => riegel(a.seconds1, a.d1, a.d2),
        TOL,
      ),
    );
  }

  // criticalSpeed. Dates use both Z and offset forms.
  type Eff = { distanceM: number; seconds: number; date: string };
  const cspeed = (name: string, efforts: Eff[], nowIso: string) =>
    cs.push(
      fcase("criticalSpeed", name, { efforts, nowIso }, (a) =>
        criticalSpeed(a.efforts, a.nowIso), TOL),
    );
  const NOW = "2026-05-05T12:00:00.000Z";
  const nowMs = ms(NOW);
  const ago = (days: number, extraMs = 0, style: Style = "z") =>
    fmt(nowMs - days * DAY - extraMs, style);
  const e = (distanceM: number, seconds: number, date: string): Eff => ({
    distanceM,
    seconds,
    date,
  });
  cspeed("no efforts", [], NOW);
  cspeed("one effort", [e(400, 82, ago(10))], NOW);
  cspeed(
    "two efforts (400, 800)",
    [e(400, 82, ago(10)), e(800, 170, ago(9))],
    NOW,
  );
  cspeed("two efforts (800, 5000)", [
    e(800, 170, ago(10)),
    e(5000, 1250, ago(8)),
  ], NOW);
  cspeed("three efforts in window", [
    e(400, 82, ago(30)),
    e(800, 170, ago(20)),
    e(5000, 1250, ago(10)),
  ], NOW);
  cspeed("three efforts, input order shuffled", [
    e(5000, 1250, ago(10)),
    e(400, 82, ago(30)),
    e(800, 170, ago(20)),
  ], NOW);
  cspeed("fastest per distance wins", [
    e(400, 90, ago(40)),
    e(400, 82, ago(35)),
    e(400, 85, ago(5)),
    e(800, 180, ago(40)),
    e(800, 170, ago(20)),
    e(5000, 1300, ago(40)),
    e(5000, 1250, ago(10)),
    e(5000, 1400, ago(2)),
  ], NOW);
  cspeed("two identical-seconds efforts at one distance (tie)", [
    e(400, 82, ago(30)),
    e(400, 82, ago(12)),
    e(800, 170, ago(20)),
    e(5000, 1250, ago(10)),
  ], NOW);
  cspeed("other distances are ignored", [
    e(1000, 210, ago(10)),
    e(1500, 330, ago(10)),
    e(10000, 2700, ago(10)),
    e(400, 82, ago(10)),
    e(800, 170, ago(10)),
    e(5000, 1250, ago(10)),
  ], NOW);
  cspeed("only non-target distances", [
    e(1000, 210, ago(1)),
    e(3000, 700, ago(1)),
    e(10000, 2700, ago(1)),
  ], NOW);
  cspeed("distance must match exactly (5000.5 and 399.9 are not targets)", [
    e(399.9, 82, ago(10)),
    e(800, 170, ago(10)),
    e(5000.5, 1250, ago(10)),
  ], NOW);
  cspeed("window edge: effort exactly 90 d old is included", [
    e(400, 82, ago(90)),
    e(800, 170, ago(20)),
    e(5000, 1250, ago(10)),
  ], NOW);
  cspeed("window edge: effort 90 d + 1 ms old is excluded", [
    e(400, 82, ago(90, 1)),
    e(800, 170, ago(20)),
    e(5000, 1250, ago(10)),
  ], NOW);
  cspeed("window edge: effort 90 d - 1 ms old is included", [
    e(400, 82, ago(90, -1)),
    e(800, 170, ago(20)),
    e(5000, 1250, ago(10)),
  ], NOW);
  cspeed("window edge in offset form (-05:00), exactly 90 d", [
    e(400, 82, ago(90, 0, "-5")),
    e(800, 170, ago(20, 0, "-5")),
    e(5000, 1250, ago(10, 0, "-5")),
  ], fmt(nowMs, "-5"));
  cspeed("window edge in +05:30 form, 90 d + 1 s excluded", [
    e(400, 82, ago(90, 1000, "+530")),
    e(800, 170, ago(20, 0, "+530")),
    e(5000, 1250, ago(10, 0, "+530")),
  ], fmt(nowMs, "+530"));
  cspeed("an old best is replaced by a slower in-window effort", [
    e(400, 70, ago(120)),
    e(400, 90, ago(40)),
    e(800, 170, ago(20)),
    e(5000, 1250, ago(10)),
  ], NOW);
  cspeed("effort dated after now still counts (no upper bound)", [
    e(400, 82, ago(10)),
    e(800, 170, ago(-5)),
    e(5000, 1250, ago(-30)),
  ], NOW);
  cspeed("all three efforts the same seconds: den 0 gives null", [
    e(400, 100, ago(10)),
    e(800, 100, ago(10)),
    e(5000, 100, ago(10)),
  ], NOW);
  cspeed("slower longer efforts give a smaller speed", [
    e(400, 100, ago(10)),
    e(800, 230, ago(10)),
    e(5000, 1800, ago(10)),
  ], NOW);
  cspeed("a real best-efforts set", [
    e(400, 78.5, ago(70)),
    e(800, 168.2, ago(55)),
    e(5000, 1198, ago(14)),
    e(5000, 1255, ago(80)),
    e(10000, 2650, ago(30)),
  ], NOW);
  cspeed("non-monotone times: faster long effort than short", [
    e(400, 200, ago(10)),
    e(800, 170, ago(10)),
    e(5000, 1250, ago(10)),
  ], NOW);

  // runZone: csMps 1 so the ratio is exactly the ngp.
  const zone = (name: string, ngpMps: number, csMps: number) =>
    cs.push(
      fcase(
        "runZone",
        name,
        { ngpMps, csMps },
        (a) => runZone(a.ngpMps, a.csMps),
      ),
    );
  for (
    const r of [
      0,
      0.5,
      0.77,
      0.7799999999,
      0.78,
      0.7800000001,
      0.9,
      0.99,
      1,
      1.0000000001,
      1.2,
      2,
    ]
  ) {
    zone(`ratio ${r} with cs 1`, r, 1);
  }
  zone("boundary 0.78 from 3.9 / 5", 3.9, 5);
  zone("boundary 1.0 from 4 / 4", 4, 4);
  zone("easy 2.8 / 3.9", 2.8, 3.9);
  zone("steady 3.4 / 3.9", 3.4, 3.9);
  zone("hard 4.3 / 3.9", 4.3, 3.9);
  zone("nonfinite: cs 0 gives infinite ratio", 1, 0);
  zone("nonfinite: 0 over 0", 0, 0);

  for (const z of [0.5, 1.0, 1.5] as RunZone[]) {
    for (const km of [0, 0.4, 1, 5, 10, 21.0975, 42.195, 100]) {
      cs.push(
        fcase(
          "runSetEquivalents",
          `${km} km at z ${z}`,
          { km, z },
          (a) => runSetEquivalents(a.km, a.z),
          TOL,
        ),
      );
    }
  }
  for (const n of [0, 1, 2, 3, 5, 8, 9, 10, 11, 14, 28]) {
    cs.push(fcase("rbeFactor", `n ${n}`, { n }, (a) => rbeFactor(a.n), TOL));
  }
  for (const descentM of [0, 50, 199.9, 200, 350.5, 1000, 2500]) {
    for (const rbe of [1, 0.965, 0.65]) {
      cs.push(
        fcase(
          "descentDamage",
          `${descentM} m with rbe ${rbe}`,
          { descentM, rbe },
          (a) => descentDamage(a.descentM, a.rbe),
          TOL,
        ),
      );
    }
  }

  type Pair = { srpeLoad: number; rTSS: number };
  const sl = (name: string, pairs: Pair[]) =>
    cs.push(
      fcase(
        "srpeLoadRatio",
        name,
        { pairs },
        (a) => srpeLoadRatio(a.pairs),
        TOL,
      ),
    );
  const mkPairs = (n: number, rtssOf: (i: number) => number): Pair[] =>
    Array.from({ length: n }, (_, i) => ({
      srpeLoad: 1.5 + 0.35 * i,
      rTSS: rtssOf(i),
    }));
  sl("no pairs gives the prior", []);
  sl("one pair gives the prior", mkPairs(1, () => 50));
  sl("nine pairs give the prior", mkPairs(9, (i) => 40 + 7 * i));
  sl("exactly ten pairs use the fitted ratio", mkPairs(10, (i) => 40 + 7 * i));
  sl("eleven pairs use the fitted ratio", mkPairs(11, (i) => 35 + 9 * i));
  sl("thirty pairs", mkPairs(30, (i) => 30 + 4 * (i % 7)));
  sl("ten pairs, den 0 falls back to the prior", mkPairs(10, () => 0));
  sl("ten pairs, negative den falls back to the prior", mkPairs(10, () => -5));
  sl("ten pairs, tiny positive den", mkPairs(10, () => 1e-6));
  sl(
    "ten pairs with zero srpe load",
    Array.from({ length: 10 }, (_, i) => ({ srpeLoad: 0, rTSS: 20 + i })),
  );
  cs.push(
    fcase(
      "SRPE_PER_100_RTSS_PRIOR",
      "constant",
      {},
      () => SRPE_PER_100_RTSS_PRIOR,
    ),
  );

  // The helpers merged in from packages/run/load.ts (R1). Fixed arguments only,
  // so no generator state moves and the cases above stay byte-identical.
  for (const grade of [-0.3, -0.18, -0.1, -0.02, 0, 0.02, 0.05, 0.12, 0.3]) {
    for (const speedMps of [0, 2.5, 3.3, 5]) {
      cs.push(
        fcase(
          "gradeAdjustedSpeed",
          `speed ${speedMps} grade ${grade}`,
          { speedMps, grade },
          (a) => gradeAdjustedSpeed(a.speedMps, a.grade),
          TOL,
        ),
      );
    }
    for (const paceSecPerM of [0, 0.3, 0.45]) {
      cs.push(
        fcase(
          "gradeAdjustedPace",
          `pace ${paceSecPerM} grade ${grade}`,
          { paceSecPerM, grade },
          (a) => gradeAdjustedPace(a.paceSecPerM, a.grade),
          TOL,
        ),
      );
    }
  }
  for (
    const [name, speedMps, grade] of [
      ["negative speed", -3, 0.05],
      ["nonfinite: NaN speed", NaN, 0.05],
      ["nonfinite: NaN grade", 3, NaN],
      ["nonfinite: infinite speed", Infinity, 0.02],
    ] as [string, number, number][]
  ) {
    cs.push(
      fcase(
        "gradeAdjustedSpeed",
        name,
        { speedMps, grade },
        (a) => gradeAdjustedSpeed(a.speedMps, a.grade),
        TOL,
      ),
    );
  }
  for (
    const [name, paceSecPerM, grade] of [
      ["negative pace", -0.3, 0.05],
      ["nonfinite: NaN pace", NaN, 0.05],
      ["nonfinite: NaN grade", 0.3, NaN],
    ] as [string, number, number][]
  ) {
    cs.push(
      fcase(
        "gradeAdjustedPace",
        name,
        { paceSecPerM, grade },
        (a) => gradeAdjustedPace(a.paceSecPerM, a.grade),
        TOL,
      ),
    );
  }
  const gd = (name: string, segments: { grade: number; meters: number }[]) =>
    cs.push(
      fcase(
        "gapDistanceM",
        name,
        { segments },
        (a) => gapDistanceM(a.segments),
        TOL,
      ),
    );
  gd("empty", []);
  gd("flat", [{ grade: 0, meters: 1000 }]);
  gd("rolling course", [
    { grade: 0.03, meters: 1500 },
    { grade: -0.03, meters: 1500 },
    { grade: 0.05, meters: 800 },
    { grade: -0.06, meters: 1200 },
    { grade: 0, meters: 5000 },
  ]);
  gd("exactly -18% counts as 1.0", [{ grade: -0.18, meters: 400 }, {
    grade: 0.1,
    meters: 400,
  }]);
  gd("steep downhill counts as 1.0", [{ grade: -0.25, meters: 300 }]);
  gd("zero and negative lengths are skipped", [
    { grade: 0.1, meters: 0 },
    { grade: 0.1, meters: -50 },
    { grade: 0.05, meters: 700 },
  ]);
  gd("nonfinite: NaN grade poisons the sum", [{ grade: NaN, meters: 100 }, {
    grade: 0,
    meters: 100,
  }]);
  gd("nonfinite: NaN meters is skipped", [{ grade: 0.1, meters: NaN }, {
    grade: 0,
    meters: 100,
  }]);
  for (
    const [gapDistM, movingSec] of [
      [12000, 3600],
      [0, 100],
      [5000, 0],
      [5000, -10],
      [-5, 100],
      [3.3 * 3600, 3600],
      [1e-9, 1e-9],
    ]
  ) {
    cs.push(
      fcase(
        "ngpFromGapDistance",
        `gap distance ${gapDistM} over ${movingSec} s`,
        { gapDistM, movingSec },
        (a) => ngpFromGapDistance(a.gapDistM, a.movingSec),
        TOL,
      ),
    );
  }
  cs.push(
    fcase(
      "ngpFromGapDistance",
      "nonfinite: NaN distance",
      { gapDistM: NaN, movingSec: 100 },
      (a) => ngpFromGapDistance(a.gapDistM, a.movingSec),
      TOL,
    ),
  );
  cs.push(
    fcase(
      "ngpFromGapDistance",
      "nonfinite: NaN time",
      { gapDistM: 100, movingSec: NaN },
      (a) => ngpFromGapDistance(a.gapDistM, a.movingSec),
      TOL,
    ),
  );
  for (
    const [name, gapDistM, movingSec, thresholdMps] of [
      ["one hour at threshold on flat is 100", 4 * 3600, 3600, 4],
      ["half an hour easy", 2.9 * 1800, 1800, 4],
      ["a 5 km race", 5000, 1200, 4.2],
      ["a long run above threshold", 21000, 6000, 3.0],
      ["threshold 0 gives 0", 1000, 300, 0],
      ["negative threshold gives 0", 1000, 300, -4],
      ["moving time 0 gives 0", 1000, 0, 4],
      ["negative moving time gives 0", 1000, -300, 4],
      ["negative distance gives 0", -1000, 300, 4],
      ["zero distance gives 0", 0, 300, 4],
      ["nonfinite: NaN threshold gives 0", 1000, 300, NaN],
      ["nonfinite: NaN distance gives 0", NaN, 300, 4],
      ["nonfinite: infinite distance", Infinity, 300, 4],
      ["nonfinite: infinite threshold", 1000, 300, Infinity],
    ] as [string, number, number, number][]
  ) {
    cs.push(
      fcase(
        "rtssFromRun",
        name,
        { gapDistM, movingSec, thresholdMps },
        (a) => rtssFromRun(a),
        TOL,
      ),
    );
  }
  for (
    const [raceDistM, raceSec] of [
      [5000, 1200],
      [10000, 2400],
      [21097.5, 5400],
      [42195, 12600],
      [1609.344, 330],
      [400, 60],
      [0, 100],
      [5000, 0],
      [-5000, 1200],
      [5000, -1200],
    ]
  ) {
    cs.push(
      fcase(
        "thresholdPaceFromRace",
        `${raceDistM} m in ${raceSec} s`,
        { raceDistM, raceSec },
        (a) => thresholdPaceFromRace(a.raceDistM, a.raceSec),
        TOL,
      ),
    );
  }
  cs.push(
    fcase(
      "thresholdPaceFromRace",
      "nonfinite: NaN distance",
      { raceDistM: NaN, raceSec: 1200 },
      (a) => thresholdPaceFromRace(a.raceDistM, a.raceSec),
      TOL,
    ),
  );
  emit("running", "ts", cs);
}

// ---------------------------------------------------------------------------
// Workout builders and the case chain
// ---------------------------------------------------------------------------

type Sore = Record<string, 1 | 2 | 3 | 4>;

const SET = (w: number, r: number, o: Partial<SetLog> = {}): SetLog => ({
  w,
  r,
  completed: true,
  ...o,
});

interface ExLib {
  targets: string[];
  synergists?: string[];
}

/** Engine-side muscle ids per exercise (what the adapter would produce). */
const EX: Record<string, ExLib> = {
  squat: {
    targets: ["quads", "glutes"],
    synergists: ["hamstrings", "lowerback"],
  },
  bench: { targets: ["chest"], synergists: ["triceps", "shoulders"] },
  deadlift: {
    targets: ["glutes", "hamstrings", "lowerback"],
    synergists: ["quads", "upperback", "lats"],
  },
  ohp: { targets: ["shoulders"], synergists: ["triceps", "upperback"] },
  legpress: { targets: ["quads", "glutes"] },
  lunge: { targets: ["quads", "glutes"], synergists: ["hamstrings"] },
  romanian_deadlift: {
    targets: ["hamstrings", "glutes"],
    synergists: ["lowerback"],
  },
  legcurl: { targets: ["hamstrings"] },
  calfraise: { targets: ["calves"] },
  row: { targets: ["upperback", "lats"], synergists: ["biceps"] },
  pullup: { targets: ["lats"], synergists: ["biceps", "upperback"] },
  triceps: { targets: ["triceps"] },
  curl: { targets: ["biceps"] },
  lateralraise: { targets: ["shoulders"] },
};

function entry(
  id: string,
  sets: SetLog[],
  o: { isMain?: boolean; targets?: string[]; synergists?: string[] | null } =
    {},
): LiftEntry {
  const lib = EX[id];
  const e: LiftEntry = {
    exerciseId: id,
    targets: o.targets ?? lib?.targets ?? [],
    sets,
  };
  const syn = o.synergists === undefined
    ? lib?.synergists
    : (o.synergists ?? undefined);
  if (syn !== undefined) e.synergists = syn;
  if (o.isMain !== undefined) e.isMain = o.isMain;
  return e;
}

const ck = (prs: number, soreness: Sore = {}): Checkin => ({ prs, soreness });

function liftW(
  id: string,
  date: string,
  entries: LiftEntry[],
  extra: Partial<LiftWorkout> = {},
): LiftWorkout {
  return { kind: "lift", id, date, entries, ...extra };
}

function runW(
  id: string,
  date: string,
  distanceM: number,
  movingSec: number,
  extra: Partial<RunWorkout> = {},
): RunWorkout {
  return {
    kind: "run",
    id,
    date,
    distanceM,
    movingSec,
    elapsedSec: movingSec,
    ...extra,
  };
}

const times = (n: number, make: (i: number) => SetLog): SetLog[] =>
  Array.from({ length: n }, (_, i) => make(i));

function label(w: Workout): string {
  return w.kind === "lift"
    ? `lift ${
      w.entries.map((e) => e.exerciseId).join("+") || "(no entries)"
    } ${w.date}`
    : `run ${w.distanceM} m in ${w.movingSec} s ${w.date}`;
}

function noSpecials(v: unknown, where: string): void {
  must(
    v !== "NaN" && v !== "Infinity" && v !== "-Infinity",
    `non-finite number in ${where}`,
  );
  if (Array.isArray(v)) v.forEach((x) => noSpecials(x, where));
  else if (v !== null && typeof v === "object") {
    for (const x of Object.values(v)) noSpecials(x, where);
  }
}

/** One log_session case; returns the next state (the case's expected). */
function applyCase(
  cases: GoldenCase[],
  name: string,
  state: EngineState,
  workout: Workout,
): EngineState {
  const c = mk(
    name,
    { state, workout },
    (i) => logSession(i.state, i.workout),
    TOL,
  );
  noSpecials(c.expected, name);
  cases.push(c);
  return c.expected as EngineState;
}

/** A chain of log_session steps: each step's input state is the previous expected. */
class Chain {
  state: EngineState;
  readonly states: EngineState[];
  private n = 0;
  constructor(
    private cases: GoldenCase[],
    private prefix: string,
    start: EngineState,
  ) {
    this.state = freeze(start);
    this.states = [this.state];
  }
  step(w: Workout, note = ""): EngineState {
    const name = `${this.prefix}/${String(++this.n).padStart(2, "0")} ${
      label(w)
    }${note ? ` (${note})` : ""}`;
    this.state = applyCase(this.cases, name, this.state, w);
    this.states.push(this.state);
    return this.state;
  }
}

interface Scenario {
  workouts: Workout[];
  /** states[i] is the state after i workouts (states[0] is the start state). */
  states: EngineState[];
}

function runScenario(
  cases: GoldenCase[],
  prefix: string,
  workouts: Workout[],
): Scenario {
  for (let i = 1; i < workouts.length; i++) {
    must(
      ms(workouts[i].date) >= ms(workouts[i - 1].date),
      `${prefix}: dates ascend at step ${i + 1}`,
    );
  }
  const ch = new Chain(cases, prefix, initialState());
  for (const w of workouts) ch.step(w);
  return { workouts, states: ch.states };
}

const idxOf = (s: Scenario, id: string): number => {
  const i = s.workouts.findIndex((w) => w.id === id);
  must(i >= 0, `workout ${id} exists`);
  return i;
};

// ---------------------------------------------------------------------------
// Scenario A: three weeks of lifting
// ---------------------------------------------------------------------------

function scenarioA(): Workout[] {
  reseed(1001);
  const rnd = (n: number) => Math.floor(Math.random() * n);
  const r25 = (x: number) => Math.round(x / 2.5) * 2.5;
  const sore = (...ms: string[]): Sore => {
    const o: Sore = {};
    for (const m of ms) o[m] = (1 + rnd(4)) as 1 | 2 | 3 | 4;
    return o;
  };
  const prsOf = () => [6, 6.5, 7, 7.5, 8, 8.5, 9][rnd(7)];
  const base = Date.UTC(2026, 0, 5, 22, 30); // Mon 2026-01-05 17:30 EST
  const styles: Style[] = ["-5", "z", "-5", "zs", "-5", "-5", "z"];
  const out: Workout[] = [];
  let n = 0;
  let k = 0;
  const at = (wk: number, day: number) =>
    fmt(base + (wk * 7 + day) * DAY, styles[k++ % styles.length]);
  for (let wk = 0; wk < 3; wk++) {
    const p = 1 + 0.02 * wk;
    // Monday: squat day, RPE logged in week 0, target RPE only in week 1.
    const sq = r25(122.5 * p);
    const squatSets: SetLog[] = [
      SET(60, 5, { warmup: true }),
      SET(r25(sq * 0.75), 3, { warmup: true }),
    ];
    if (wk === 0) {
      for (const rpe of [7, 7.5, 8]) squatSets.push(SET(sq, 5, { rpe }));
    } else if (wk === 1) {
      squatSets.push(...times(3, () => SET(sq, 5, { targetRpe: 8 })));
    } else {
      squatSets.push(SET(sq, 5, { rpe: 8.5 }), SET(sq, 5, { rpe: 9 }));
      squatSets.push(
        SET(sq, 5, { rpe: 9.5 }),
        SET(sq, 4, { rpe: 10, completed: false }),
      );
    }
    out.push(liftW(`a${++n}`, at(wk, 0), [
      entry("squat", squatSets),
      entry(
        "legpress",
        times(3, () => SET(r25(sq * 1.6), 10, { targetRpe: 9 })),
      ),
      entry("lunge", [
        SET(40, 8, { rpe: 8 }),
        SET(40, 8, { rpe: 8.5, jointPain: wk === 1 }),
        SET(40, 7, { rpe: 9 }),
      ]),
    ], {
      checkin: ck(prsOf(), sore("quads", "glutes", "hamstrings")),
      srpe: 7,
      minutes: 75,
    }));
    // Tuesday: bench day.
    const bn = r25(87.5 * p);
    out.push(liftW(`a${++n}`, at(wk, 1), [
      entry("bench", [
        SET(60, 8, { warmup: true }),
        SET(r25(bn * 0.8), 5, { warmup: true }),
        ...times(
          4,
          (i) =>
            wk === 0
              ? SET(bn, 5, { rpe: 8 + (i > 1 ? 0.5 : 0) })
              : SET(bn, 5, { targetRpe: 8.5 }),
        ),
      ]),
      entry("row", times(3, () => SET(r25(bn * 0.8), 8, { rpe: 8 }))),
      entry("triceps", times(3, () => SET(25, 12, { targetRpe: 9 })), {
        synergists: null,
      }),
    ], {
      checkin: ck(prsOf(), sore("chest", "triceps", "lats")),
      srpe: 6,
      minutes: 60,
    }));
    // Thursday: deadlift day. Week 0 has no sRPE, week 1 sRPE without
    // minutes, week 2 a tested single plus sRPE and minutes.
    const dl = r25(160 * p);
    const dlSets: SetLog[] = [
      SET(60, 5, { warmup: true }),
      SET(100, 3, { warmup: true }),
    ];
    if (wk === 2) {
      dlSets.push(SET(200, 1, { rpe: 10, tested1rm: true }));
      dlSets.push(SET(r25(dl * 0.9), 3, { rpe: 8 }));
    } else {
      dlSets.push(SET(dl, 5, { rpe: 8 }), SET(dl, 5, { rpe: 8.5 }));
    }
    const thu: Partial<LiftWorkout> = {
      checkin: wk === 2
        ? ck(4, sore("hamstrings", "lowerback"))
        : ck(prsOf(), sore("hamstrings", "lowerback")),
    };
    if (wk === 1) thu.srpe = 7.5;
    if (wk === 2) {
      thu.srpe = 9;
      thu.minutes = 90;
    }
    out.push(liftW(`a${++n}`, at(wk, 3), [
      entry("deadlift", dlSets),
      entry(
        "romanian_deadlift",
        times(3, () => SET(r25(dl * 0.55), 8, { rpe: 8 })),
      ),
      entry("pullup", times(3, () => SET(0, 6, { targetRpe: 9 }))),
    ], thu));
    // Friday: overhead press day with a second bench entry.
    const oh = r25(55 * p);
    const fri: Partial<LiftWorkout> = {};
    if (wk < 2) {
      fri.checkin = ck(prsOf(), {});
      fri.srpe = 6.5;
      fri.minutes = 70;
    } else {
      fri.minutes = 65;
    }
    out.push(liftW(`a${++n}`, at(wk, 4), [
      entry(
        "ohp",
        times(4, (i) => SET(oh, 6, i < 2 ? { rpe: 8 } : { targetRpe: 8.5 })),
      ),
      entry("bench", times(3, () => SET(r25(bn * 0.85), 8, { rpe: 8 }))),
      entry("curl", times(3, () => SET(15, 12, { targetRpe: 9 }))),
      entry("lateralraise", times(3, () => SET(7.5, 15, { rpe: 9 }))),
    ], fri));
    if (wk === 1) {
      // Saturday: extra squat volume, target RPE only, no check-in, no sRPE.
      out.push(liftW(`a${++n}`, at(wk, 5), [
        entry(
          "squat",
          times(3, () => SET(r25(sq * 0.85), 8, { targetRpe: 7 })),
        ),
      ]));
    }
    if (wk === 2) {
      // Saturday: light arm day. jointPain on a warmup and on an incomplete
      // set is ignored. `perf` is an input field the engine never reads.
      out.push(liftW(`a${++n}`, at(wk, 5), [
        entry("curl", [
          SET(10, 10, { warmup: true, jointPain: true }),
          SET(15, 12, { rpe: 8 }),
          SET(15, 8, { rpe: 10, completed: false, jointPain: true }),
        ]),
        entry("lateralraise", times(2, () => SET(7.5, 15, { targetRpe: 8 }))),
      ], { perf: { biceps: 3, shoulders: 2 } }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scenario B: a mixed lift and run block (five weeks of Feb 2026 plus a tail)
// ---------------------------------------------------------------------------

/** Ids of the scenario B workouts the checks refer to. */
const B_IDS: Record<string, string> = {};

function scenarioB(): Workout[] {
  reseed(1002);
  const r25 = (x: number) => Math.round(x / 2.5) * 2.5;
  const out: Workout[] = [];
  const t0 = Date.UTC(2026, 1, 2, 5, 0); // Mon 2026-02-02 00:00 EST
  const T = (day: number, hh: number, mm = 0) =>
    t0 + day * DAY + hh * HOUR + mm * MIN;
  let n = 0;
  const run = (
    day: number,
    hh: number,
    mm: number,
    dist: number,
    sec: number,
    o: Partial<RunWorkout> = {},
    style: Style = "-5",
  ) => out.push(runW(`b${++n}`, fmt(T(day, hh, mm), style), dist, sec, o));
  const lift = (
    day: number,
    hh: number,
    mm: number,
    entries: LiftEntry[],
    extra: Partial<LiftWorkout> = {},
    style: Style = "-5",
  ) => out.push(liftW(`b${++n}`, fmt(T(day, hh, mm), style), entries, extra));
  const mark = (key: string) => {
    B_IDS[key] = out[out.length - 1].id;
  };
  const sqW = (wk: number) => r25(110 + 2.5 * wk + Math.random() * 2);
  const main = (
    id: string,
    wt: number,
    reps: number,
    nSets: number,
    o: Partial<SetLog>,
  ) =>
    entry(id, [
      SET(60, 5, { warmup: true }),
      ...times(nSets, () => SET(wt, reps, o)),
    ]);

  run(0, 7, 0, 5200, 1740, { srpe: 4, minutes: 29 }); // r1
  lift(0, 17, 30, [
    main("squat", sqW(0), 5, 3, { rpe: 8 }),
    entry("legpress", times(3, () => SET(180, 10, { targetRpe: 9 }))),
  ], {
    checkin: ck(7.5, { quads: 1 }),
    srpe: 7,
    minutes: 70,
  }); // squat anchors its Kalman
  run(1, 12, 0, 10000, 3600, {
    srpe: 5,
    elapsedSec: 3700,
    descentM: 80,
    gradeProfile: [{ grade: 0.01, meters: 4000 }, {
      grade: -0.02,
      meters: 6000,
    }],
  });
  lift(1, 17, 30, [
    main("deadlift", 150, 5, 3, { rpe: 8 }),
    entry("row", times(3, () => SET(65, 8, { rpe: 8 }))),
  ], {
    checkin: ck(7, { hamstrings: 2, lowerback: 1 }),
    srpe: 7,
    minutes: 65,
  }); // deadlift anchors
  run(2, 7, 0, 400, 82, { srpe: 9, elapsedSec: 90 }); // best effort 400
  lift(2, 18, 0, [
    main("bench", 90, 5, 4, { rpe: 8 }),
    main("ohp", 52.5, 6, 3, { targetRpe: 8.5 }),
  ], {
    checkin: ck(8, { chest: 1 }),
    srpe: 6.5,
    minutes: 70,
  }); // bench and ohp anchor
  // Day 3: a 40 min run ending 08:10, then squat at 15:00 (6 h 50 min gap):
  // run-before-lift doubles the Kalman noise (squat already has obs 1).
  run(3, 7, 30, 5600, 2400, { srpe: 5, minutes: 40, descentM: 40 });
  lift(3, 15, 0, [
    main("squat", sqW(0), 5, 3, { targetRpe: 8 }),
    entry("lunge", times(3, () => SET(40, 8, { rpe: 8 }))),
  ], {
    checkin: ck(6.5, { quads: 3 }),
    srpe: 7,
    minutes: 70,
  });
  mark("runBeforeLift");
  run(4, 7, 0, 800, 170, { srpe: 9 }); // best effort 800
  run(5, 9, 0, 5000, 1250, { srpe: 9, elapsedSec: 1300 }); // best effort 5000, first VDOT observation
  // Day 5 17:00: the 5 km run was 20.8 min (< 30), so no noise doubling.
  lift(5, 17, 0, [main("deadlift", 155, 5, 3, { rpe: 8.5 })], {
    checkin: ck(7, { hamstrings: 2 }),
    srpe: 6,
    minutes: 55,
  });
  // Critical speed now exists (400, 800 and 5000 m inside 90 days): zones kick in.
  run(7, 7, 0, 6000, 2100, { srpe: 4, hrTrimp: 65 }); // easy, z 0.5
  lift(7, 17, 30, [
    main("squat", sqW(1), 5, 3, { rpe: 8 }),
    main("bench", 92.5, 5, 3, { rpe: 8 }),
  ], {
    checkin: ck(7.5, { quads: 2, chest: 1 }),
    srpe: 7,
    minutes: 75,
  });
  run(8, 12, 0, 8000, 2400); // steady, z 1.0, no sRPE (prior ratio: fewer than 10 pairs)
  run(9, 7, 0, 5000, 1200, { srpe: 8.5 }); // hard, z 1.5, second VDOT observation
  lift(9, 18, 0, [
    main("bench", 95, 5, 4, { rpe: 8.5 }),
    main("ohp", 55, 6, 3, { rpe: 8 }),
  ], {
    checkin: ck(8, {}),
    srpe: 7,
    minutes: 75,
  });
  // Day 10: a 130 min run with descent (minutes > 120 splits km into damage),
  // then deadlift and bench at 16:00 (run-before-lift on the lower lift only).
  run(10, 7, 0, 21000, 7800, {
    srpe: 6,
    descentM: 350,
    gradeProfile: [
      { grade: 0.02, meters: 8000 },
      { grade: -0.06, meters: 6000 },
      { grade: 0, meters: 7000 },
    ],
  });
  lift(10, 16, 0, [
    main("deadlift", 157.5, 5, 3, { rpe: 8.5 }),
    main("bench", 95, 5, 3, { rpe: 8 }),
  ], {
    checkin: ck(5.5, { quads: 4, hamstrings: 3 }),
    srpe: 8,
    minutes: 80,
  });
  run(11, 7, 0, 5200, 1800, { srpe: 3, minutes: 32 }); // tenth sRPE/rTSS pair
  // Day 12: no sRPE after ten pairs, so the fitted ratio is used. Then the
  // VDOT window edges: 3.4 min excluded, 3.5 min included.
  run(12, 8, 0, 8000, 2880);
  mark("fitted");
  run(12, 10, 0, 1000, 204, { srpe: 9 });
  mark("vdot34");
  run(12, 11, 0, 1000, 210, { srpe: 8 });
  mark("vdot35");
  run(13, 8, 0, 35000, 13800, { srpe: 8 }); // 230 min exactly: included
  mark("vdot230");
  run(14, 8, 0, 35000, 13806, { srpe: 9 }); // 230.1 min: excluded
  mark("vdot2301");
  lift(14, 17, 30, [main("squat", sqW(2), 5, 3, { rpe: 8 })], {
    checkin: ck(5, { quads: 4, glutes: 3 }),
    srpe: 8,
    minutes: 70,
  }); // 5.6 h after a 230 min run
  run(15, 12, 0, 10000, 3000, { srpe: 7.5 }); // in-window but sRPE < 8: no observation
  mark("srpe75");
  run(16, 7, 0, 4000, 1100, { srpe: 8 }); // in-window, sRPE 8: observation
  mark("srpe8");
  // Days 17-28: daily runs with descent (n of 200 m+ descent runs in the
  // last 42 d climbs past 10, so the repeated-bout factor hits its floor).
  for (let i = 0; i < 12; i++) {
    const day = 17 + i;
    const dist = 6000 + 300 * i;
    const sec = Math.round(dist / (2.9 + 0.05 * (i % 4)));
    const o: Partial<RunWorkout> = {};
    if (i === 5) o.descentM = 150;
    else if (i !== 8) o.descentM = 220 + 20 * (i % 5);
    if (i % 3 !== 2) o.srpe = 5 + (i % 4);
    run(day, 7, 0, dist, sec, o);
    if (day % 7 === 0) {
      lift(day, 17, 30, [main("squat", sqW(3), 5, 3, { rpe: 8 })], {
        srpe: 7,
        minutes: 60,
      });
    } else if (day % 7 === 3) {
      lift(day, 17, 30, [
        main("deadlift", 160, 5, 3, { rpe: 8.5 }),
        main("bench", 97.5, 5, 3, { rpe: 8 }),
      ], {
        checkin: ck(7, { hamstrings: 2 }),
        srpe: 7,
        minutes: 75,
      });
    }
  }
  // The 400 m best effort is dated 2026-02-04T12:00:00Z. A run at exactly
  // +90 d still sees it (critical speed exists); one second later it has
  // aged out (critical speed null, zone back to 1.0).
  out.push(
    runW(`b${++n}`, "2026-05-05T12:00:00.000Z", 10000, 3300, { srpe: 6 }),
  );
  out.push(
    runW(`b${++n}`, "2026-05-05T12:00:01.000Z", 10000, 3300, { srpe: 6 }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Scenario D: 30 squat sessions following a synthetic e1RM series
// ---------------------------------------------------------------------------

function scenarioD(): Workout[] {
  const rand = mulberryTest(7);
  const out: Workout[] = [];
  const base = Date.UTC(2026, 2, 2, 22, 30);
  for (let i = 0; i < 30; i++) {
    const noise = (rand() + rand() + rand() - 1.5) * 2 * 3;
    const y = 200 + 0.8 * i + noise;
    const w = Math.round(y * 0.811 * 2) / 2; // 5 @ 8 is 81.1% in the RTS table
    const entries = [
      entry("squat", [
        SET(60, 5, { warmup: true }),
        ...times(3, () => SET(w, 5, { rpe: 8 })),
      ]),
    ];
    if (i % 2 === 1) {
      entries.push(
        entry("legpress", times(3, () => SET(250, 10, { targetRpe: 9 }))),
      );
    }
    out.push(liftW(
      `d${i + 1}`,
      fmt(base + Math.floor((i * 7) / 3) * DAY, "z"),
      entries,
      i % 4 === 0
        ? {
          checkin: ck(6 + (i % 5) * 0.5, { quads: 1 + (i % 3) as 1 | 2 | 3 }),
          srpe: 7,
          minutes: 60,
        }
        : { srpe: 6 + (i % 3), minutes: 55 },
    ));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scenario E: 40 days of running with CS efforts, zones and 20+ VDOT updates
// ---------------------------------------------------------------------------

function scenarioE(): Workout[] {
  reseed(1005);
  const out: Workout[] = [];
  const base = Date.UTC(2026, 3, 6, 10, 30); // Mon 2026-04-06 06:30 EDT
  let n = 0;
  for (let i = 0; i < 40; i++) {
    if (i % 7 === 6) continue;
    const date = fmt(base + i * DAY, "-4");
    let dist: number;
    let sec: number;
    const o: Partial<RunWorkout> = {};
    if (i === 1) {
      dist = 400;
      sec = 80;
    } else if (i === 2) {
      dist = 800;
      sec = 168;
    } else if (i === 3) {
      dist = 5000;
      sec = 1230;
    } else if (i === 10) {
      dist = 5000;
      sec = 1195;
    } else {
      dist = 3000 + 400 * ((i * 7) % 11);
      const speed = 2.8 + Math.random() * 1.6;
      sec = Math.round(dist / speed);
    }
    if (i % 8 !== 5) o.srpe = 8 + Math.floor(Math.random() * 4) * 0.5;
    if (i % 5 === 2 && dist > 5000) {
      o.descentM = 100 + Math.round(Math.random() * 300);
    }
    out.push(runW(`e${++n}`, date, dist, sec, o));
  }
  return out;
}

// ---------------------------------------------------------------------------
// log_session.json
// ---------------------------------------------------------------------------

interface Scenarios {
  A: Scenario;
  B: Scenario;
  D: Scenario;
  E: Scenario;
}

const heavyLift = (id: string, date: string): LiftWorkout =>
  liftW(id, date, [
    entry("squat", [
      SET(60, 5, { warmup: true }),
      ...times(5, () => SET(140, 5, { rpe: 9 })),
    ]),
    entry("deadlift", times(3, () => SET(180, 3, { rpe: 8.5 }))),
    entry("legpress", times(3, () => SET(240, 10, { targetRpe: 9 }))),
  ], { checkin: ck(7, { quads: 2 }), srpe: 8, minutes: 75 });

const heavyRun = (id: string, date: string): RunWorkout =>
  runW(id, date, 12000, 4200, { srpe: 7, descentM: 250 });

function genLogSession(): Scenarios {
  const cs: GoldenCase[] = [];
  let nid = 0;
  const cid = () => `c${++nid}`;

  // (a) three weeks of lifting.
  const A = runScenario(cs, "a lift block", scenarioA());
  {
    const f = A.states[A.workouts.length];
    must(
      f.referenceRm["deadlift"]?.source === "tested",
      "a: tested deadlift sets referenceRm",
    );
    must(
      f.jointPainLog.length === 1,
      "a: one jointPain entry (warmup and incomplete ignored)",
    );
    must(
      (f.kalman["squat"]?.obs ?? 0) >= 4,
      "a: squat Kalman has several observations",
    );
    must(f.prsHistory.length >= 8, "a: check-ins recorded");
    must(f.sorenessPrevPrev !== undefined, "a: sorenessPrevPrev set");
  }
  // (b) mixed lift and run block.
  const B = runScenario(cs, "b lift+run block", scenarioB());
  {
    const f = B.states[B.workouts.length];
    must(f.srpeRtssPairs.length >= 10, "b: 10+ sRPE pairs");
    must(f.kalmanRun.obs >= 4, "b: several VDOT observations");
    must(f.runFatigueDamage["quads"] > 0, "b: run damage recorded");
    must(
      new Set(f.runs.map((r) => r.z)).size === 3,
      "b: all three run zones occur",
    );
    // Ten pairs exist before b13 (the first run without sRPE after them).
    const s13 = B.states[idxOf(B, B_IDS.fitted) + 1];
    must(
      s13.srpeRtssPairs.length === 10,
      "b: ten pairs before the fitted-ratio run",
    );
    must(
      srpeLoadRatio(s13.srpeRtssPairs) !== SRPE_PER_100_RTSS_PRIOR,
      "b: fitted ratio differs from the prior",
    );
    // The VDOT window: 3.4 min excluded, 3.5 min and 230 min included,
    // 230.1 min excluded, sRPE 7.5 excluded.
    const obsAfter = (id: string) => B.states[idxOf(B, id) + 1].kalmanRun.obs;
    const obsBefore = (id: string) => B.states[idxOf(B, id)].kalmanRun.obs;
    must(
      obsAfter(B_IDS.vdot34) === obsBefore(B_IDS.vdot34),
      "b: 3.4 min run is not an observation",
    );
    must(
      obsAfter(B_IDS.vdot35) === obsBefore(B_IDS.vdot35) + 1,
      "b: 3.5 min run is an observation",
    );
    must(
      obsAfter(B_IDS.vdot230) === obsBefore(B_IDS.vdot230) + 1,
      "b: 230 min run is an observation",
    );
    must(
      obsAfter(B_IDS.vdot2301) === obsBefore(B_IDS.vdot2301),
      "b: 230.1 min run is not an observation",
    );
    must(
      obsAfter(B_IDS.srpe75) === obsBefore(B_IDS.srpe75),
      "b: sRPE 7.5 run is not an observation",
    );
    must(
      obsAfter(B_IDS.srpe8) === obsBefore(B_IDS.srpe8) + 1,
      "b: sRPE 8 run is an observation",
    );
    // Run-before-lift: noise doubling changes the squat Kalman state.
    const iLift = idxOf(B, B_IDS.runBeforeLift);
    const pre = B.states[iLift];
    const noRun: EngineState = { ...pre };
    delete noRun.lastRun;
    must(
      JSON.stringify(logSession(noRun, B.workouts[iLift]).kalman["squat"]) !==
        JSON.stringify(B.states[iLift + 1].kalman["squat"]),
      "b: run-before-lift changes the squat update",
    );
    // The repeated-bout floor: the last descent run saw 10+ recent descent runs.
    const lastDescent = B.workouts.filter((w) =>
      w.kind === "run" && (w.descentM ?? 0) >= 200
    ).pop()!;
    const sPre = B.states[idxOf(B, lastDescent.id)];
    const recent =
      sPre.runs.filter((r) =>
        ms(lastDescent.date) - ms(r.date) <= 42 * DAY && r.descentM >= 200
      ).length;
    must(recent >= 10, "b: repeated-bout factor reaches its floor");
    // Critical speed: present at +90 d exactly, gone one second later.
    const a1 = B.states[B.workouts.length - 2];
    const a2 = B.states[B.workouts.length - 1];
    must(
      criticalSpeed(a1.bestEfforts, "2026-05-05T12:00:00.000Z") !== null,
      "b: CS at +90 d",
    );
    must(
      criticalSpeed(a2.bestEfforts, "2026-05-05T12:00:01.000Z") === null,
      "b: CS gone at +90 d + 1 s",
    );
  }
  // (d) 30 squat sessions: the 20-observation theta unlock through logSession.
  const D = runScenario(cs, "d squat series", scenarioD());
  {
    const k = D.states[30].kalman["squat"];
    must(k.obs === 30, "d: 30 squat observations");
    must(k.k2 !== k.thetaPrior * k.k1, "d: theta unlocked");
    const k20 = D.states[20].kalman["squat"];
    must(
      k20.k2 === k20.thetaPrior * k20.k1,
      "d: theta locked through 20 observations",
    );
  }
  // (e) 40 days of running.
  const E = runScenario(cs, "e run block", scenarioE());
  {
    const f = E.states[E.workouts.length];
    must(f.kalmanRun.obs >= 22, "e: 22+ VDOT observations");
    must(
      f.kalmanRun.k2 !== f.kalmanRun.thetaPrior * f.kalmanRun.k1,
      "e: run theta unlocked",
    );
    must(new Set(f.runs.map((r) => r.z)).size === 3, "e: all three zones");
  }

  edgeCases(cs, cid, A, B);
  emit("log_session", "ts", cs);
  return { A, B, D, E };
}

/** Branch-style edge cases (input states come from the scenario chains). */
function edgeCases(
  cs: GoldenCase[],
  cid: () => string,
  A: Scenario,
  B: Scenario,
): void {
  const stateA = (i: number) => A.states[i];
  const lastA = A.states[A.workouts.length];

  // c01 / c02 / c03: the first ever workouts, on initialState (updated = epoch 0).
  {
    const ch = new Chain(cs, "c01 first lift on initialState", initialState());
    ch.step(liftW(cid(), "2026-01-05T17:30:00-05:00", [
      entry("bench", [
        SET(60, 8, { warmup: true }),
        SET(100, 5, { rpe: 8 }),
        SET(100, 5, { rpe: 8.5 }),
        SET(100, 4, { targetRpe: 9 }),
      ]),
      entry("row", [SET(70, 8, { rpe: 8 })]),
    ], { checkin: ck(7, { chest: 2 }), srpe: 7, minutes: 60 }));
  }
  {
    const ch = new Chain(cs, "c02 first run on initialState", initialState());
    ch.step(runW(cid(), "2026-01-06T07:00:00-05:00", 8000, 2700, { srpe: 6 }));
  }
  {
    const ch = new Chain(
      cs,
      "c03 custom mainLifts",
      initialState(["backSquat", "benchPress"]),
    );
    ch.step(liftW(cid(), "2026-01-05T17:30:00-05:00", [
      entry("backSquat", times(3, () => SET(120, 5, { rpe: 8 })), {
        targets: ["quads", "glutes"],
      }),
      entry("benchPress", times(3, () => SET(90, 5, { rpe: 8 })), {
        targets: ["chest"],
      }),
      entry("squat", times(3, () => SET(100, 5, { rpe: 8 }))),
    ], { srpe: 7, minutes: 60 }));
    ch.step(runW(cid(), "2026-01-06T07:00:00-05:00", 5200, 1800, { srpe: 5 }));
  }

  // c04: a workout dated before state.updated (dt clamps to 0, updated goes backwards).
  {
    const ch = new Chain(cs, "c04 workout before updated", stateA(7));
    const u = ms(ch.state.updated);
    ch.step(
      liftW(cid(), fmt(u - 3 * DAY, "-5"), [
        entry("bench", times(3, () => SET(90, 5, { rpe: 8 }))),
      ], { srpe: 6, minutes: 50 }),
      "3 days before updated: no decay",
    );
    ch.step(
      liftW(cid(), fmt(ms(ch.state.updated) + DAY, "z"), [
        entry("squat", times(3, () => SET(125, 5, { rpe: 8 }))),
      ], { srpe: 6, minutes: 50 }),
      "decays from the rolled-back updated",
    );
    ch.step(
      runW(cid(), fmt(u - 10 * DAY, "zs"), 6000, 2100, { srpe: 5 }),
      "run 10 days before the original updated",
    );
  }
  // c05: identical timestamps (dt 0) written in three offset forms.
  {
    const ch = new Chain(cs, "c05 identical timestamps", stateA(4));
    const t = ms(ch.state.updated) + DAY;
    ch.step(
      liftW(cid(), fmt(t, "z"), [entry(
        "squat",
        times(3, () => SET(125, 5, { rpe: 8 })),
      )], { srpe: 6, minutes: 60 }),
    );
    ch.step(
      runW(cid(), fmt(t, "-5"), 5000, 1500, { srpe: 7 }),
      "same instant, offset form",
    );
    ch.step(
      liftW(cid(), fmt(t, "zs"), [entry(
        "bench",
        times(3, () => SET(90, 5, { rpe: 8 })),
      )], { srpe: 5, minutes: 40 }),
      "same instant, no ms",
    );
    ch.step(
      liftW(cid(), fmt(t, "+530"), [entry(
        "ohp",
        times(3, () => SET(55, 6, { rpe: 8 })),
      )]),
      "same instant, +05:30",
    );
  }
  // c06-c08: DST, month, year and leap-day boundaries (fatigue decay uses real elapsed ms).
  {
    const ch = new Chain(cs, "c06 DST spring forward", initialState());
    ch.step(heavyLift(cid(), "2026-03-06T19:00:00-05:00"));
    ch.step(heavyRun(cid(), "2026-03-07T07:00:00-05:00"));
    ch.step(
      heavyLift(cid(), "2026-03-08T19:00:00-04:00"),
      "35 h after the run, wall clock reads 36 h",
    );
    ch.step(heavyRun(cid(), "2026-03-09T08:00:00-04:00"));
    ch.step(
      heavyLift(cid(), "2026-03-09T23:59:59.500-04:00"),
      "fractional seconds with an offset",
    );
  }
  {
    const ch = new Chain(cs, "c07 DST fall back", initialState());
    ch.step(heavyLift(cid(), "2026-10-30T19:00:00-04:00"));
    ch.step(heavyRun(cid(), "2026-10-31T19:00:00-04:00"));
    ch.step(
      heavyLift(cid(), "2026-11-01T19:00:00-05:00"),
      "25 h after the run, wall clock reads 24 h",
    );
    ch.step(heavyRun(cid(), "2026-11-02T07:00:00-05:00"));
    ch.step(
      heavyLift(cid(), "2026-11-02T12:00:00Z"),
      "UTC form of 07:00 EST: dt 0",
    );
  }
  {
    const ch = new Chain(
      cs,
      "c08 month, year and leap day boundaries",
      initialState(),
    );
    ch.step(heavyLift(cid(), "2026-01-31T21:00:00-05:00"));
    ch.step(heavyRun(cid(), "2026-02-01T21:00:00-05:00"), "month boundary");
    ch.step(heavyLift(cid(), "2026-02-28T07:00:00Z"));
    ch.step(heavyRun(cid(), "2026-03-01T07:00:00Z"), "Feb to Mar boundary");
    ch.step(heavyLift(cid(), "2026-12-31T23:30:00-05:00"));
    ch.step(
      heavyRun(cid(), "2027-01-01T00:30:00-05:00"),
      "year boundary, one hour later",
    );
    ch.step(heavyLift(cid(), "2028-02-28T18:00:00Z"));
    ch.step(heavyRun(cid(), "2028-02-29T18:00:00Z"), "leap day");
    ch.step(heavyLift(cid(), "2028-03-01T18:00:00Z"), "day after the leap day");
    ch.step(
      heavyRun(cid(), "2026-09-14T13:30:00.250+05:30"),
      "back in time: dt clamps",
    );
  }
  // c09: empty entries and falsy minutes.
  {
    const ch = new Chain(cs, "c09 empty entries and falsy minutes", stateA(8));
    const t = ms(ch.state.updated);
    ch.step(liftW(cid(), fmt(t + DAY, "-5"), []), "empty entries, no sRPE");
    ch.step(
      liftW(cid(), fmt(t + 2 * DAY, "-5"), [], { srpe: 6, minutes: 0 }),
      "minutes 0 is falsy: sRPE ignored for load, still recorded",
    );
    ch.step(
      liftW(cid(), fmt(t + 3 * DAY, "-5"), [], { srpe: 0, minutes: 60 }),
      "sRPE 0 adds a zero load entry",
    );
    ch.step(
      liftW(cid(), fmt(t + 4 * DAY, "-5"), [], { minutes: 60 }),
      "minutes without sRPE",
    );
    ch.step(
      liftW(cid(), fmt(t + 5 * DAY, "-5"), [], {
        srpe: 7,
        minutes: 45,
        checkin: ck(6, {}),
      }),
      "empty check-in soreness",
    );
    ch.step(
      runW(cid(), fmt(t + 6 * DAY, "-5"), 5000, 1700, { srpe: 6, minutes: 0 }),
      "run minutes 0 is not replaced by movingSec/60",
    );
    ch.step(
      runW(cid(), fmt(t + 7 * DAY, "-5"), 5000, 1700, { srpe: 0, minutes: 30 }),
      "run sRPE 0",
    );
  }
  // c10: half-integer reps and RPE.
  {
    const ch = new Chain(cs, "c10 half-integer reps and RPE", stateA(5));
    const t = ms(ch.state.updated);
    ch.step(liftW(cid(), fmt(t + DAY, "-5"), [
      entry("squat", [
        SET(120, 4.5, { rpe: 8.5 }),
        SET(120, 5.5, { rpe: 7.5 }),
        SET(120, 5, { rpe: 8.25 }),
      ]),
      entry("bench", [SET(90, 2.5, { rpe: 9 }), SET(90, 3.5, { rpe: 9.5 })]),
      entry("deadlift", [
        SET(150, 0.5, { rpe: 9.5 }),
        SET(150, 1.5, { targetRpe: 9 }),
      ]),
      entry("ohp", [SET(55, 0, { rpe: 8 }), SET(55, 5.5, { targetRpe: 8.5 })]),
    ], { checkin: ck(7.5, { quads: 2 }), srpe: 7.5, minutes: 62.5 }));
    ch.step(liftW(cid(), fmt(t + 2 * DAY, "-5"), [
      entry("squat", [
        SET(122.5, 3.5, { rpe: 6.5 }),
        SET(122.5, 8.5, { targetRpe: 7 }),
      ]),
      entry("bench", [SET(92.5, 10.5, { rpe: 9 })]),
    ]));
  }
  // c11: entries with no targets, odd muscle spellings, duplicate targets.
  {
    const ch = new Chain(cs, "c11 targets and synergists", stateA(5));
    const t = ms(ch.state.updated);
    ch.step(
      liftW(cid(), fmt(t + DAY, "-5"), [
        entry("squat", times(3, () => SET(125, 5, { rpe: 8 })), {
          targets: [],
          synergists: ["glutes"],
        }),
      ]),
      "main lift with no targets",
    );
    ch.step(
      liftW(cid(), fmt(t + 2 * DAY, "-5"), [
        entry("bench", times(3, () => SET(92.5, 5, { rpe: 8 })), {
          targets: [],
          synergists: null,
        }),
        entry("curl", times(3, () => SET(15, 12, { rpe: 8 })), { targets: [] }),
      ]),
      "no targets and no synergists key",
    );
    ch.step(
      liftW(cid(), fmt(t + 3 * DAY, "-5"), [
        entry("squat", times(3, () => SET(125, 5, { rpe: 8 })), {
          targets: ["Quadriceps", "Lower Back", "quads"],
          synergists: ["Upper_Back", "quads"],
        }),
        entry("legcurl", times(2, () => SET(40, 10, { rpe: 8 })), {
          targets: ["hamstrings", "hamstrings"],
          synergists: [],
        }),
      ]),
      "odd spellings, duplicates, empty synergists",
    );
    ch.step(
      liftW(cid(), fmt(t + 4 * DAY, "-5"), [
        entry("bench", times(3, () => SET(92.5, 5, { rpe: 8 }))),
      ]),
      "decay of the oddly spelled keys",
    );
  }
  // c12: tested 1RM variants.
  {
    const ch = new Chain(cs, "c12 tested 1RM", stateA(9));
    const t = ms(ch.state.updated);
    ch.step(
      liftW(cid(), fmt(t + DAY, "-5"), [
        entry("squat", [
          SET(150, 1, { rpe: 8, tested1rm: true }),
          SET(130, 3, { rpe: 8 }),
        ]),
      ]),
      "flagged tested single on a main lift",
    );
    ch.step(
      liftW(cid(), fmt(t + 2 * DAY, "-5"), [
        entry("curl", [SET(40, 1, { rpe: 9.5, tested1rm: true })]),
      ]),
      "tested set on a non-main lift is ignored for Kalman and referenceRm",
    );
    ch.step(
      liftW(cid(), fmt(t + 3 * DAY, "-5"), [
        entry("bench", [
          SET(120, 1, { rpe: 10, tested1rm: true, completed: false }),
          SET(95, 5, { rpe: 8 }),
        ]),
      ]),
      "incomplete tested attempt",
    );
    ch.step(
      liftW(cid(), fmt(t + 4 * DAY, "-5"), [
        entry("deadlift", [SET(205, 1, { rpe: 9.5 })]),
      ]),
      "single at RPE 9.5 without the flag is tested",
    );
    ch.step(
      liftW(cid(), fmt(t + 5 * DAY, "-5"), [
        entry("ohp", [SET(70, 1, { tested1rm: true, rpe: 7 })]),
      ]),
      "tested attempt logged at RPE 7",
    );
  }
  // c13: jointPain flags.
  {
    const ch = new Chain(cs, "c13 jointPain", stateA(3));
    const t = ms(ch.state.updated);
    ch.step(
      liftW(cid(), fmt(t + DAY, "-5"), [
        entry("squat", [
          SET(60, 5, { warmup: true, jointPain: true }),
          SET(125, 5, { rpe: 8, jointPain: true }),
          SET(125, 5, { rpe: 8, jointPain: true }),
          SET(125, 3, { rpe: 10, jointPain: true, completed: false }),
        ]),
        entry("curl", [SET(15, 12, { rpe: 8, jointPain: true })]),
      ]),
      "two painful working sets, one on an accessory",
    );
  }
  // c14: isMain overrides and duplicate main entries in one session.
  {
    const ch = new Chain(cs, "c14 isMain overrides", stateA(3));
    const t = ms(ch.state.updated);
    ch.step(
      liftW(cid(), fmt(t + DAY, "-5"), [
        entry("curl", times(3, () => SET(15, 8, { rpe: 8 })), { isMain: true }),
        entry("squat", times(3, () => SET(125, 5, { rpe: 8 })), {
          isMain: false,
        }),
        entry("bench", times(3, () => SET(92.5, 5, { rpe: 8 })), {
          isMain: true,
        }),
      ]),
      "isMain true on an accessory, false on a main lift",
    );
    ch.step(
      liftW(cid(), fmt(t + 2 * DAY, "-5"), [
        entry("squat", times(3, () => SET(125, 5, { rpe: 8 }))),
        entry("squat", times(2, () => SET(130, 3, { rpe: 8.5 }))),
      ]),
      "two squat entries in one session (second sees the updated fitness)",
    );
    ch.step(
      liftW(cid(), fmt(t + 3 * DAY, "-5"), [
        entry("curl", times(3, () => SET(17.5, 8, { rpe: 8 })), {
          isMain: true,
        }),
      ]),
      "the accessory now has a Kalman entry",
    );
  }
  // c15: run-before-lift matrix. Each variant is a run step then a lift step,
  // both from the same start state. `gapSec` is the lift time minus the end of
  // the run, where the end is start + minutes (TS uses lastRun.minutes, which
  // is the `minutes` field when present, else movingSec / 60).
  {
    const S0 = lastA;
    const base = ms(S0.updated) + 2 * DAY;
    interface Variant {
      name: string;
      run: Partial<RunWorkout>;
      sec: number;
      lift: { id: string; gapSec: number; main?: boolean; sets?: SetLog[] };
      hit: boolean;
    }
    const sets = (): SetLog[] => times(3, () => SET(125, 5, { rpe: 8 }));
    const H = 3600;
    const v40 = { minutes: 40 };
    const variants: Variant[] = [
      {
        name: "squat 6 h after a 40 min run",
        run: v40,
        sec: 2400,
        lift: { id: "squat", gapSec: 6 * H },
        hit: true,
      },
      {
        name: "squat 7 h 59 min 59 s after the run",
        run: v40,
        sec: 2400,
        lift: { id: "squat", gapSec: 8 * H - 1 },
        hit: true,
      },
      {
        name: "squat exactly 8 h after the run",
        run: v40,
        sec: 2400,
        lift: { id: "squat", gapSec: 8 * H },
        hit: false,
      },
      {
        name: "squat 12 h after the run",
        run: v40,
        sec: 2400,
        lift: { id: "squat", gapSec: 12 * H },
        hit: false,
      },
      {
        name: "bench 6 h after the run (upper body)",
        run: v40,
        sec: 2400,
        lift: { id: "bench", gapSec: 6 * H },
        hit: false,
      },
      {
        name: "deadlift 6 h after the run",
        run: v40,
        sec: 2400,
        lift: { id: "deadlift", gapSec: 6 * H },
        hit: true,
      },
      {
        name: "ohp 6 h after the run",
        run: v40,
        sec: 2400,
        lift: { id: "ohp", gapSec: 6 * H },
        hit: false,
      },
      {
        name:
          "squat dated 20 min after the run starts (before it ends): negative gap still hits",
        run: v40,
        sec: 2400,
        lift: { id: "squat", gapSec: -20 * 60 },
        hit: true,
      },
      {
        name: "squat dated 2 days before the run: negative gap still hits",
        run: v40,
        sec: 2400,
        lift: { id: "squat", gapSec: -(2 * 86400 + 40 * 60) },
        hit: true,
      },
      {
        name: "run minutes 29.9: too short",
        run: { minutes: 29.9 },
        sec: 1794,
        lift: { id: "squat", gapSec: 2 * H },
        hit: false,
      },
      {
        name: "run minutes exactly 30",
        run: { minutes: 30 },
        sec: 1800,
        lift: { id: "squat", gapSec: 2 * H },
        hit: true,
      },
      {
        name: "run without minutes, movingSec 1790 (29.8 min)",
        run: {},
        sec: 1790,
        lift: { id: "squat", gapSec: 2 * H },
        hit: false,
      },
      {
        name: "run without minutes, movingSec 2400",
        run: {},
        sec: 2400,
        lift: { id: "squat", gapSec: 2 * H },
        hit: true,
      },
      {
        name: "minutes 35 with movingSec 1500: lastRun.minutes is 35",
        run: { minutes: 35 },
        sec: 1500,
        lift: { id: "squat", gapSec: 2 * H },
        hit: true,
      },
      {
        name: "run minutes 0",
        run: { minutes: 0 },
        sec: 2400,
        lift: { id: "squat", gapSec: 1 * H },
        hit: false,
      },
      {
        name: "lunge with isMain true after a 45 min run",
        run: { minutes: 45 },
        sec: 2700,
        lift: { id: "lunge", gapSec: 3 * H, main: true },
        hit: true,
      },
      {
        name: "front squat (first Kalman observation anchors, noise ignored)",
        run: v40,
        sec: 2400,
        lift: { id: "front_squat", gapSec: 3 * H, main: true },
        hit: true,
      },
      {
        name: "tested single squat after a 40 min run (noise 0.25 x 2)",
        run: v40,
        sec: 2400,
        lift: { id: "squat", gapSec: 3 * H, sets: [SET(165, 1, { rpe: 9.5 })] },
        hit: true,
      },
    ];
    variants.forEach((v, i) => {
      const run = runW(cid(), fmt(base, "-5"), 5000, v.sec, {
        srpe: 5,
        ...v.run,
      });
      const runMin = v.run.minutes ?? v.sec / 60;
      const liftAt = base + runMin * MIN + v.lift.gapSec * 1000;
      const pre = `c15 run-before-lift ${String(i + 1).padStart(2, "0")}`;
      const afterRun = applyCase(cs, `${pre} run: ${v.name}`, S0, run);
      const lift = liftW(cid(), fmt(liftAt, "-5"), [
        entry(v.lift.id, v.lift.sets ?? sets(), {
          targets: v.lift.id === "front_squat"
            ? ["quads", "glutes"]
            : undefined,
          isMain: v.lift.main,
        }),
      ]);
      const after = applyCase(cs, `${pre} lift: ${v.name}`, afterRun, lift);
      // The branch actually fires: compare with the same lift without a last run.
      const noRun: EngineState = { ...afterRun };
      delete noRun.lastRun;
      const without = logSession(noRun, lift);
      const ex = v.lift.id;
      const differs =
        JSON.stringify(without.kalman[ex]) !== JSON.stringify(after.kalman[ex]);
      const firstObs = (afterRun.kalman[ex]?.obs ?? 0) === 0;
      must(
        differs === (v.hit && !firstObs),
        `c15 ${v.name}: noise doubling ${
          v.hit && !firstObs ? "applies" : "is absent"
        } (differs=${differs})`,
      );
    });
  }
  // c16: run edge cases from a clean state.
  {
    const ch = new Chain(cs, "c16 run edge cases", initialState());
    const t = Date.UTC(2026, 3, 1, 11, 0);
    let d = 0;
    const next = () => fmt(t + d++ * DAY, "-4");
    ch.step(
      runW(cid(), next(), 0, 600, { srpe: 5 }),
      "zero distance: no best effort, IF 0",
    );
    ch.step(runW(cid(), next(), 5000, 0), "movingSec 0: speed 0");
    ch.step(
      runW(cid(), next(), 5000, 0, { srpe: 6 }),
      "movingSec 0 with sRPE: minutes 0",
    );
    ch.step(
      runW(cid(), next(), 6000, 2100, { gradeProfile: [] }),
      "empty grade profile",
    );
    ch.step(
      runW(cid(), next(), 6000, 2100, {
        gradeProfile: [{ grade: 0.05, meters: 0 }],
      }),
      "grade profile with zero meters",
    );
    ch.step(
      runW(cid(), next(), 6000, 2100, { descentM: 0, srpe: 0 }),
      "descentM 0 and sRPE 0",
    );
    ch.step(
      runW(cid(), next(), 800, 150, { srpe: 10, minutes: 3 }),
      "sRPE 10, 3 min",
    );
    ch.step(
      runW(cid(), next(), 6000, 2100, {
        elapsedSec: 4200,
        hrTrimp: 80,
        gradeProfile: [{ grade: -0.25, meters: 1000 }, {
          grade: 0.3,
          meters: 500,
        }, { grade: -0.1, meters: 2500 }],
        descentM: 600,
      }),
      "steep grades beyond -18% and +30%, unused fields",
    );
    ch.step(runW(cid(), next(), 100000, 36000, { srpe: 7 }), "100 km, 10 h");
    ch.step(runW(cid(), next(), 400, 80, { srpe: 9 }), "400 m");
    ch.step(runW(cid(), next(), 800, 165, { srpe: 9 }), "800 m");
    ch.step(
      runW(cid(), next(), 5000, 1260, { srpe: 9 }),
      "5000 m: critical speed now exists",
    );
    ch.step(
      runW(cid(), next(), 7000, 2000, { srpe: 6 }),
      "first run scored against a critical speed",
    );
  }
  // c17: minutes > 120 damage split, branches from one start state.
  {
    const S1 = B.states[idxOf(B, "b9") + 1];
    const t = ms(S1.updated) + 2 * DAY;
    const v: [string, number, Partial<RunWorkout>][] = [
      ["movingSec 7200 (exactly 120 min): no damage split", 7200, {}],
      ["movingSec 7260 (121 min): tiny damage split", 7260, {}],
      ["movingSec 14400 (240 min): half the km are damage", 14400, {}],
      ["minutes 150 with movingSec 3600: minutes drives the split", 3600, {
        minutes: 150,
      }],
      ["minutes 150 with sRPE 6: minutes drives sysLoad too", 3600, {
        minutes: 150,
        srpe: 6,
      }],
      ["minutes 119.99: no split", 7200, { minutes: 119.99 }],
    ];
    v.forEach(([name, sec, o], i) => {
      applyCase(
        cs,
        `c17 long run ${i + 1}: ${name}`,
        S1,
        runW(cid(), fmt(t, "-5"), 25000, sec, o),
      );
    });
  }
  // c18: repeated-bout window edge (42 d), two branches from the same state.
  {
    const ch = new Chain(cs, "c18 repeated-bout window", initialState());
    const d1 = Date.UTC(2026, 2, 2, 12, 0);
    ch.step(runW(cid(), fmt(d1, "z"), 8000, 2700, { descentM: 300, srpe: 6 }));
    ch.step(
      runW(cid(), fmt(d1 + 10 * DAY, "z"), 8000, 2700, {
        descentM: 300,
        srpe: 6,
      }),
    );
    const s2 = ch.state;
    const e = (offsetMs: number, name: string) => {
      const after = applyCase(
        cs,
        `c18 branch: ${name}`,
        s2,
        runW(cid(), fmt(d1 + 42 * DAY + offsetMs, "z"), 8000, 2700, {
          descentM: 400,
          srpe: 6,
        }),
      );
      return after.fatigueDamage["quads"] -
        s2.fatigueDamage["quads"] *
          Math.exp(-(ms(after.updated) - ms(s2.updated)) / DAY / 5);
    };
    const exact = e(
      0,
      "run exactly 42 d after the first descent run (counted)",
    );
    const late = e(
      1000,
      "run 42 d + 1 s after the first descent run (not counted)",
    );
    const early = e(
      -1000,
      "run 42 d - 1 s after the first descent run (counted)",
    );
    must(
      exact < late - 1e-6 && Math.abs(exact - early) < 1e-3,
      "c18: the 42 d edge changes the repeated-bout factor",
    );
    // The count has no lower bound on the date difference: descent runs
    // logged LATER than this run still count.
    const past = applyCase(
      cs,
      "c18 branch: run dated 5 days before both descent runs (later runs still count, n = 2)",
      s2,
      runW(cid(), fmt(d1 - 5 * DAY, "z"), 8000, 2700, {
        descentM: 400,
        srpe: 6,
      }),
    );
    must(
      Math.abs(
        past.fatigueDamage["quads"] - s2.fatigueDamage["quads"] -
          0.4 * 4 * rbeFactor(2),
      ) < 1e-9,
      "c18: runs dated after this one count toward n",
    );
  }
  // c19: mixed offset forms in one chain.
  {
    const ch = new Chain(cs, "c19 mixed offset forms", stateA(6));
    const t = ms(ch.state.updated);
    ch.step(
      liftW(cid(), fmt(t + 1 * DAY, "+530"), [entry(
        "squat",
        times(3, () => SET(125, 5, { rpe: 8 })),
      )], { srpe: 6, minutes: 60 }),
    );
    ch.step(
      runW(cid(), "2026-01-20T08:15:30.750-04:00", 5000, 1600, { srpe: 6 }),
    );
    ch.step(
      liftW(cid(), "2026-01-20T22:00:00Z", [entry(
        "bench",
        times(3, () => SET(92.5, 5, { rpe: 8 })),
      )]),
    );
  }
}

// ---------------------------------------------------------------------------
// calibrate.json
// ---------------------------------------------------------------------------

function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The validation_test.ts helpers, ported as is. */
function validationSession(
  date: string,
  sets: number,
  load: number,
  rpe: number,
  srpe: number,
): LiftWorkout {
  return {
    kind: "lift",
    id: date,
    date,
    entries: [{
      exerciseId: "squat",
      targets: ["quads", "glutes"],
      synergists: ["hamstrings"],
      isMain: true,
      sets: Array.from(
        { length: sets },
        () => ({ w: load, r: 5, rpe, completed: true }),
      ),
    }],
    checkin: { prs: 7, soreness: { quads: 2 } },
    srpe,
    minutes: 60,
  };
}

function validationDay(base: Date, off: number, h = 18): string {
  const d = new Date(base.getTime() + off * DAY);
  d.setUTCHours(h, 0, 0, 0);
  return d.toISOString();
}

function genCalibrate(sc: Scenarios): void {
  const cs: GoldenCase[] = [];
  const add = (
    name: string,
    history: Workout[],
    chainFinal?: EngineState,
  ): EngineState => {
    const c = mk(name, { history }, (i) => calibrate(i.history), TOL);
    noSpecials(c.expected, name);
    if (chainFinal) {
      must(
        JSON.stringify(c.expected) === JSON.stringify(freeze(chainFinal)),
        `calibrate equals the log_session chain: ${name}`,
      );
    }
    cs.push(c);
    return c.expected as EngineState;
  };
  const fin = (s: Scenario) => s.states[s.workouts.length];

  add("empty history gives initialState()", []);
  add("single lift", [sc.A.workouts[0]], sc.A.states[1]);
  add("single run", [sc.B.workouts[0]], sc.B.states[1]);
  add("a: three weeks of lifting, in date order", sc.A.workouts, fin(sc.A));
  add("a: same history, reversed", [...sc.A.workouts].reverse(), fin(sc.A));
  reseed(3001);
  add("b: lift+run block, shuffled", shuffled(sc.B.workouts), fin(sc.B));
  add("b: lift+run block, in date order", sc.B.workouts, fin(sc.B));
  add(
    "d: synthetic Kalman recovery, 30 squat observations",
    sc.D.workouts,
    fin(sc.D),
  );
  add(
    "d: synthetic Kalman recovery, shuffled",
    shuffled(sc.D.workouts),
    fin(sc.D),
  );
  add("e: 40 days of running, in date order", sc.E.workouts, fin(sc.E));
  add("e: 40 days of running, shuffled", shuffled(sc.E.workouts), fin(sc.E));

  // validation_test.ts: 3-week scenario plus three rest-day sessions.
  {
    const base = new Date("2026-01-05T00:00:00Z");
    const hist: Workout[] = [];
    for (let wk = 0; wk < 3; wk++) {
      const heavy = wk === 2;
      const days = heavy ? [0, 1, 2, 3, 4] : [0, 2, 4];
      for (const d of days) {
        hist.push(validationSession(
          validationDay(base, wk * 7 + d),
          heavy ? 14 : 8,
          100,
          heavy ? 9.5 : 8,
          heavy ? 9 : 6,
        ));
      }
    }
    const trained = add("validation_test: 3-week block", hist);
    must(trained.fatigueMuscle["quads"] > 0, "validation: fatigue present");
    for (let d = 0; d < 3; d++) {
      hist.push({
        kind: "lift",
        id: `rest${d}`,
        date: validationDay(base, 21 + d),
        entries: [],
        srpe: 0,
        minutes: 0,
      });
    }
    const rested = add(
      "validation_test: 3-week block plus 3 rest-day sessions",
      hist,
    );
    must(
      rested.fatigueMuscle["quads"] < trained.fatigueMuscle["quads"] &&
        rested.fatigueSystemic < trained.fatigueSystemic,
      "validation: fatigue decays on rest",
    );
    reseed(3002);
    add("validation_test: same history, shuffled", shuffled(hist));
    // "calibrate replays history in date order": two sessions, later one first.
    const w1 = validationSession(validationDay(base, 2), 8, 100, 8, 6);
    const w2 = validationSession(validationDay(base, 0), 8, 100, 8, 6);
    const s = add("validation_test: calibrate replays history in date order", [
      w1,
      w2,
    ]);
    must(s.updated === w1.date, "validation: ends at the latest date");
    // A tested 1RM writes referenceRm.
    add("validation_test: a tested 1RM writes referenceRm", [{
      kind: "lift",
      id: "t1",
      date: "2026-01-05T18:00:00Z",
      entries: [{
        exerciseId: "squat",
        targets: ["quads", "glutes"],
        isMain: true,
        sets: [{ w: 315, r: 1, rpe: 10, completed: true, tested1rm: true }],
      }],
      srpe: 9,
      minutes: 20,
    }]);
  }
  // Stable sort: equal instants keep input order (V8 sort is stable).
  {
    const t = "2026-03-02T12:00:00.000Z";
    const lift = liftW("tie-lift", t, [
      entry("squat", times(3, () => SET(125, 5, { rpe: 8 }))),
    ], { srpe: 7, minutes: 60 });
    const run = runW("tie-run", "2026-03-02T07:00:00-05:00", 8000, 2700, {
      srpe: 6,
    });
    const a = add(
      "tie: lift then run at the same instant (offset form for the run)",
      [lift, run],
    );
    const b = add(
      "tie: run then lift at the same instant (offset form for the run)",
      [run, lift],
    );
    must(
      JSON.stringify(a) !== JSON.stringify(b),
      "calibrate: order of tied workouts matters",
    );
    const third = liftW("tie-bench", "2026-03-02T17:30:00+05:30", [
      entry("bench", times(3, () => SET(90, 5, { rpe: 8 }))),
    ], { srpe: 6, minutes: 50 });
    const early = runW("tie-early", "2026-03-01T08:00:00Z", 5000, 1600, {
      srpe: 5,
    });
    add("tie in the middle of an unsorted history, three offset forms", [
      third,
      lift,
      early,
      run,
    ]);
  }
  // Unsorted history across the March DST change, offset forms throughout.
  {
    const h: Workout[] = [
      heavyLift("dst1", "2026-03-06T19:00:00-05:00"),
      heavyRun("dst2", "2026-03-07T07:00:00-05:00"),
      heavyLift("dst3", "2026-03-08T19:00:00-04:00"),
      heavyRun("dst4", "2026-03-09T08:00:00-04:00"),
      heavyLift("dst5", "2026-03-09T23:59:59.500-04:00"),
    ];
    add("DST spring forward, in order", h);
    reseed(3003);
    add("DST spring forward, shuffled", shuffled(h));
  }
  emit("calibrate", "ts", cs);
}

// ---------------------------------------------------------------------------
// readiness.json, fatigue_local.json, readiness_decay.json
// ---------------------------------------------------------------------------

const mkState = (over: Partial<EngineState> = {}): EngineState => ({
  ...initialState(),
  ...over,
});

interface ReadinessArgs {
  state: EngineState;
  checkin: Checkin;
  sessionMuscles?: string[];
  now: string;
}

function readinessInput(
  state: EngineState,
  checkin: Checkin,
  sessionMuscles?: string[],
  now: string = state.updated,
): ReadinessArgs {
  const a: ReadinessArgs = { state, checkin, now };
  if (sessionMuscles !== undefined) a.sessionMuscles = sessionMuscles;
  return a;
}

function genReadiness(sc: Scenarios): void {
  const cs: GoldenCase[] = [];
  const add = (
    name: string,
    state: EngineState,
    checkin: Checkin,
    sessionMuscles?: string[],
  ): Readiness => {
    const input = readinessInput(state, checkin, sessionMuscles);
    must(
      input.now === state.updated,
      `readiness: now equals updated in ${name}`,
    );
    const c = mk(
      name,
      input,
      (i) => predictReadinessTs(i.state, i.checkin, i.sessionMuscles),
      TOL,
    );
    cs.push(c);
    return c.expected as Readiness;
  };
  const U = "2026-02-10T12:00:00.000Z";
  const um = ms(U);
  const hist = (...pts: [number, number][]) =>
    pts.map(([daysAgo, value]) => ({ date: fmt(um - daysAgo * DAY), value }));
  const withHist = (
    h: { date: string; value: number }[],
    over: Partial<EngineState> = {},
  ) => mkState({ updated: U, prsHistory: h, ...over });

  // metrics_test.ts lines 68-81.
  {
    const s = initialState();
    const low = add(
      "metrics_test: prs 3 flags and scores below 1",
      s,
      ck(3),
      [],
    );
    must(low.prsFlag && low.score < 1, "readiness: prs<=4 flags");
    const sore = add(
      "metrics_test: soreness 4 blocks quads",
      s,
      ck(8, { quads: 4 }),
      ["quads"],
    );
    must(sore.soreBlockedMuscles.includes("quads"), "readiness: sore 4 blocks");
    const ok = add(
      "metrics_test: fresh session scores 1",
      s,
      ck(8, { quads: 1 }),
      ["quads"],
    );
    must(ok.score === 1 && !ok.prsFlag, "readiness: fresh scores 1");
    // The z-score path with variance. initialState().updated is epoch 0 while the
    // history is dated 2026: prsZScore has no upper bound, so all 7 points count
    // (a TS quirk, recorded in the README).
    const s2 = mkState({
      prsHistory: [7, 7, 7, 8, 7, 8, 7].map((v, i) => ({
        date: `2026-01-0${i + 1}T00:00:00Z`,
        value: v,
      })),
    });
    const dip = add(
      "metrics_test: z <= -1.5 flags (history dated after now)",
      s2,
      ck(4),
      [],
    );
    must(
      dip.prsZ !== null && dip.prsZ <= -1.5 && dip.prsFlag,
      "readiness: z<=-1.5 flags",
    );
  }
  // hybrid_test.ts lines 47-50: quad readiness after a 10 km tempo.
  {
    const tempo = runW(
      "tempo1",
      fmt(Date.parse("2026-01-06T22:30:00Z") - 45 * MIN),
      10000,
      2700,
      {
        srpe: 8,
        minutes: 45,
      },
    );
    const after = logSession(initialState(), tempo);
    const fresh = add(
      "hybrid_test: fresh state, quads 1",
      initialState(),
      ck(7, { quads: 1 }),
      ["quads"],
    );
    const rRun = add(
      "hybrid_test: after a 10 km tempo, quads 1",
      after,
      ck(7, { quads: 1 }),
      ["quads"],
    );
    must(
      rRun.score < fresh.score,
      "readiness: quad readiness lower after tempo",
    );
  }

  // sessionMuscles omitted vs [] vs explicit.
  add(
    "fresh state, empty soreness, sessionMuscles omitted",
    mkState({ updated: U }),
    ck(8),
  );
  add(
    "sessionMuscles omitted defaults to the soreness keys (quads 4 blocks)",
    mkState({ updated: U }),
    ck(8, { quads: 4, chest: 2 }),
  );
  add(
    "sessionMuscles [] is an empty list (nothing blocked)",
    mkState({ updated: U }),
    ck(8, { quads: 4, chest: 2 }),
    [],
  );
  add(
    "sessionMuscles excludes the sore muscle",
    mkState({ updated: U }),
    ck(8, { quads: 4, chest: 2 }),
    ["chest"],
  );
  add(
    "blocked muscles keep sessionMuscles order (chest, quads)",
    mkState({ updated: U }),
    ck(8, { quads: 4, chest: 4 }),
    ["chest", "quads"],
  );
  add(
    "blocked muscles keep sessionMuscles order (quads, chest)",
    mkState({ updated: U }),
    ck(8, { quads: 4, chest: 4 }),
    ["quads", "chest"],
  );
  add(
    "duplicate sessionMuscles are kept as given",
    mkState({ updated: U }),
    ck(8, { quads: 4 }),
    ["quads", "quads"],
  );
  add(
    "sessionMuscles names a muscle missing from soreness",
    mkState({ updated: U }),
    ck(8, { quads: 4 }),
    ["quads", "calves"],
  );
  add(
    "soreness 3 only: sore-healing",
    mkState({ updated: U }),
    ck(8, { quads: 3 }),
    ["quads"],
  );
  add(
    "soreness 3 and 4: only sore-blocked",
    mkState({ updated: U }),
    ck(8, { quads: 3, glutes: 4 }),
    ["quads", "glutes"],
  );
  add(
    "soreness 1 and 2: nothing",
    mkState({ updated: U }),
    ck(8, { quads: 1, glutes: 2 }),
    ["quads", "glutes"],
  );
  add(
    "soreness 3 outside the session: nothing",
    mkState({ updated: U }),
    ck(8, { quads: 3 }),
    ["chest"],
  );
  add(
    "empty soreness with sessionMuscles given",
    mkState({ updated: U }),
    ck(8),
    ["quads", "chest"],
  );

  // prs z-score paths.
  add("no prs history: z null", withHist([]), ck(7), []);
  add("one history point: z null", withHist(hist([3, 7])), ck(7), []);
  add(
    "two equal history points: sd 0 gives z 0",
    withHist(hist([3, 7], [2, 7])),
    ck(5),
    [],
  );
  add(
    "two different points (6, 8), prs 6",
    withHist(hist([3, 6], [2, 8])),
    ck(6),
    [],
  );
  add(
    "history only older than 28 d: z null",
    withHist(hist([40, 7], [35, 8], [30, 6])),
    ck(7),
    [],
  );
  add(
    "window edge: a point exactly 28 d old is included",
    withHist(hist([28, 8], [27, 6], [1, 7])),
    ck(7),
    [],
  );
  add(
    "window edge: a point 28 d + 1 ms old is excluded",
    withHist([
      { date: fmt(um - 28 * DAY - 1), value: 8 },
      ...hist([27, 6], [1, 7]),
    ]),
    ck(7),
    [],
  );
  add(
    "window edge in offset form (-05:00), exactly 28 d",
    withHist([
      { date: fmt(um - 28 * DAY, "-5"), value: 8 },
      { date: fmt(um - 27 * DAY, "-5"), value: 6 },
      { date: fmt(um - 1 * DAY, "+530"), value: 7 },
    ]),
    ck(7),
    [],
  );
  add(
    "a history point dated after now still counts (no upper bound)",
    withHist(hist([-5, 9], [3, 7], [2, 6])),
    ck(7),
    [],
  );
  add(
    "z exactly -1.5 (history 8, 10, 12, prs 7): prs-z-low",
    withHist(hist([5, 8], [4, 10], [3, 12])),
    ck(7),
    [],
  );
  add(
    "z just above -1.5 (prs 7.001): prs-dipping",
    withHist(hist([5, 8], [4, 10], [3, 12])),
    ck(7.001),
    [],
  );
  add(
    "z exactly -1 (prs 8): nothing",
    withHist(hist([5, 8], [4, 10], [3, 12])),
    ck(8),
    [],
  );
  add(
    "z -1.25 (prs 7.5): prs-dipping",
    withHist(hist([5, 8], [4, 10], [3, 12])),
    ck(7.5),
    [],
  );
  add(
    "z below -1.5 with prs above 4: prs-z-low",
    withHist(hist([6, 9], [5, 9.5], [4, 10], [3, 9.8], [2, 9.9])),
    ck(7),
    [],
  );
  add("prs exactly 4 with z null: prs-low", withHist([]), ck(4), []);
  add("prs 4.5 with z null: nothing", withHist([]), ck(4.5), []);
  add(
    "prs 4 and z <= -1.5: prs-low takes the reason",
    withHist(hist([6, 9], [5, 9.5], [4, 10], [3, 9.8])),
    ck(4),
    [],
  );
  add("prs 0", withHist([]), ck(0), []);
  add("prs 10", withHist(hist([3, 6], [2, 7])), ck(10), []);
  add(
    "positive z (prs well above the mean)",
    withHist(hist([3, 5], [2, 6], [1, 7])),
    ck(9),
    [],
  );
  add(
    "high-variance history",
    withHist(hist([9, 2], [8, 9], [7, 4], [6, 10], [5, 3])),
    ck(6),
    [],
  );
  add(
    "duplicate dates in history",
    withHist([
      { date: U, value: 6 },
      { date: U, value: 8 },
      { date: U, value: 7 },
    ]),
    ck(5),
    [],
  );

  // Local fatigue: mean of (G + D) over the session muscles.
  const g = (quads: number, damage = 0, extra: Partial<EngineState> = {}) =>
    mkState({
      updated: U,
      fatigueMuscle: { quads },
      fatigueDamage: damage ? { quads: damage } : {},
      ...extra,
    });
  for (const q of [0.3, 0.4, 0.41, 1, 2, 4, 8, 20]) {
    add(`local fatigue: quads G ${q}`, g(q), ck(8), ["quads"]);
  }
  add("local fatigue: quads G 2 + D 2", g(2, 2), ck(8), ["quads"]);
  add(
    "local fatigue: damage only (D 6)",
    mkState({ updated: U, fatigueDamage: { quads: 6 } }),
    ck(8),
    ["quads"],
  );
  add("local fatigue: mean over two muscles, one fatigued", g(8), ck(8), [
    "quads",
    "chest",
  ]);
  add(
    "local fatigue: mean over two fatigued muscles",
    mkState({
      updated: U,
      fatigueMuscle: { quads: 6, glutes: 2 },
      fatigueDamage: { glutes: 3 },
    }),
    ck(8),
    ["quads", "glutes"],
  );
  add(
    "local fatigue ignores muscles outside the session",
    mkState({
      updated: U,
      fatigueMuscle: { quads: 20, chest: 0 },
    }),
    ck(8),
    ["chest"],
  );
  add("local fatigue: negative G clamps to 0", g(-4), ck(8), ["quads"]);
  add("local fatigue: empty sessionMuscles gives 0", g(20), ck(8), []);
  add(
    "local fatigue: key case matters (Quads is not quads)",
    mkState({ updated: U, fatigueMuscle: { Quads: 8 } }),
    ck(8),
    ["quads"],
  );

  // Systemic fatigue.
  for (const gs of [0, 0.3, 0.4, 0.41, 0.5, 3, 6, 12]) {
    add(
      `systemic fatigue ${gs}`,
      mkState({ updated: U, fatigueSystemic: gs }),
      ck(8),
      [],
    );
  }
  // Combinations, including the maximum penalty.
  add(
    "everything at once: prs 4, blocked, local and systemic",
    mkState({
      updated: U,
      fatigueMuscle: { quads: 10 },
      fatigueDamage: { quads: 4 },
      fatigueSystemic: 9,
    }),
    ck(4, { quads: 4 }),
    ["quads"],
  );
  add(
    "local and systemic only",
    mkState({
      updated: U,
      fatigueMuscle: { quads: 4, glutes: 4 },
      fatigueSystemic: 3,
    }),
    ck(8, { quads: 1 }),
    ["quads", "glutes"],
  );
  add(
    "dipping prs with sore-healing and fatigue",
    withHist(hist([5, 8], [4, 10], [3, 12]), {
      fatigueMuscle: { chest: 3 },
      fatigueSystemic: 1.5,
    }),
    ck(7.5, { chest: 3 }),
    ["chest"],
  );

  // States produced by the scenario chains (realistic fatigue and history).
  const states: [string, EngineState][] = [
    ["a final", sc.A.states[sc.A.workouts.length]],
    ["a after 6 sessions", sc.A.states[6]],
    [
      "b after the 130 min run and deadlift",
      sc.B.states[idxOf(sc.B, B_IDS.runBeforeLift) + 12],
    ],
    ["b after the 230 min run", sc.B.states[idxOf(sc.B, B_IDS.vdot230) + 1]],
    ["d final", sc.D.states[30]],
    ["e day 20", sc.E.states[20]],
  ];
  for (const [nm, st] of states) {
    for (const [ckName, c, sm] of CHECKINS) {
      add(`${nm}: ${ckName}`, st, c, sm);
    }
  }
  emit("readiness", "ts", cs);
}

/** Check-in variants applied to scenario states (name, check-in, sessionMuscles). */
const CHECKINS: [string, Checkin, string[] | undefined][] = [
  [
    "prs 7, quads/glutes/hamstrings soreness, sessionMuscles omitted",
    ck(7, { quads: 2, glutes: 1, hamstrings: 2 }),
    undefined,
  ],
  ["prs 8, chest day", ck(8, { chest: 1 }), ["chest", "shoulders", "triceps"]],
  ["prs 5.5, quads 4", ck(5.5, { quads: 4 }), ["quads", "glutes", "calves"]],
  ["prs 4, quads and hamstrings 3", ck(4, { quads: 3, hamstrings: 3 }), [
    "quads",
    "hamstrings",
  ]],
  ["prs 9, five lower-body muscles", ck(9, {}), [
    "quads",
    "glutes",
    "hamstrings",
    "calves",
    "lowerback",
  ]],
];

function genFatigueLocal(): void {
  const cs: GoldenCase[] = [];
  const f = (name: string, gm: number) =>
    cs.push(mk(name, { gm }, (i) => fatigueLocal(i.gm), TOL));
  for (
    const gm of [
      -5,
      -0.0001,
      0,
      0.001,
      0.4,
      1,
      2,
      4,
      6.5,
      7.99,
      8,
      8.001,
      12,
      100,
      1e6,
    ]
  ) {
    f(`gm ${gm}`, gm);
  }
  f("nonfinite: NaN propagates (Math.max / Math.min)", NaN);
  f("nonfinite: Infinity clamps to 1", Infinity);
  f("nonfinite: -Infinity clamps to 0", -Infinity);
  emit("fatigue_local", "ts", cs);
}

// readiness_decay: decay a clone of the state with the engine's own helpers
// (a copy of decayAll in packages/engine/mod.ts, which is not exported), then
// run the TS readiness core with `now` as the reference time.

function clone(s: EngineState): EngineState {
  return JSON.parse(JSON.stringify(s)) as EngineState;
}

function decayAll(s: EngineState, dt: number): void {
  if (!(dt > 0)) return;
  for (const k of Object.keys(s.fitness)) {
    s.fitness[k] = decayValue(s.fitness[k], dt, TAU_FITNESS_LIFT);
  }
  s.fatigueMuscle = decayRecord(s.fatigueMuscle, dt, muscleTau);
  s.runFatigueMuscle = decayRecord(s.runFatigueMuscle, dt, muscleTau);
  for (const k of Object.keys(s.fatigueDamage)) {
    s.fatigueDamage[k] = decayValue(s.fatigueDamage[k], dt, TAU_DAMAGE);
  }
  for (const k of Object.keys(s.runFatigueDamage)) {
    s.runFatigueDamage[k] = decayValue(s.runFatigueDamage[k], dt, TAU_DAMAGE);
  }
  s.fatigueSystemic = decayValue(s.fatigueSystemic, dt, TAU_SYSTEMIC);
  s.fitnessRun = decayValue(s.fitnessRun, dt, TAU_FITNESS_RUN);
}

function decayThenReadiness(
  state: EngineState,
  checkin: Checkin,
  sessionMuscles: string[] | undefined,
  now: string,
): Readiness {
  const s = clone(state);
  decayAll(s, daysBetween(s.updated, now));
  // The decay must be the one logSession applies: an empty session at `now`
  // decays the same fields (and logSession clamps dt at 0).
  const viaLog = logSession(state, liftW("decay-check", now, []));
  for (
    const k of [
      "fitness",
      "fatigueMuscle",
      "runFatigueMuscle",
      "fatigueDamage",
      "runFatigueDamage",
      "fatigueSystemic",
      "fitnessRun",
    ] as const
  ) {
    must(
      JSON.stringify(s[k]) === JSON.stringify(viaLog[k]),
      `decayAll copy matches mod.ts for ${k} at ${now}`,
    );
  }
  const names = sessionMuscles ?? Object.keys(checkin.soreness);
  const out = readinessCore(s, checkin, names, now);
  // Robustness: ulp-level differences in exp must not flip a branch.
  for (const f of [1 + 1e-12, 1 - 1e-12]) {
    const p = clone(s);
    for (const rec of [p.fatigueMuscle, p.fatigueDamage]) {
      for (const k of Object.keys(rec)) rec[k] *= f;
    }
    p.fatigueSystemic *= f;
    const q = readinessCore(p, checkin, names, now);
    must(
      JSON.stringify(q.reasons) === JSON.stringify(out.reasons) &&
        q.prsFlag === out.prsFlag &&
        Math.abs(q.score - out.score) < 1e-9,
      `readiness_decay is stable under 1e-12 perturbation at ${now}`,
    );
  }
  return out;
}

function genReadinessDecay(sc: Scenarios): void {
  const cs: GoldenCase[] = [];
  const add = (
    name: string,
    state: EngineState,
    checkin: Checkin,
    sessionMuscles: string[] | undefined,
    now: string,
  ) => {
    cs.push(
      mk(
        name,
        readinessInput(state, checkin, sessionMuscles, now),
        (i) => decayThenReadiness(i.state, i.checkin, i.sessionMuscles, i.now),
        TOL,
      ),
    );
  };
  const offsets: [string, number, Style][] = [
    ["1 h", HOUR, "z"],
    ["6 h", 6 * HOUR, "-5"],
    ["12 h", 12 * HOUR, "zs"],
    ["1 d", DAY, "-5"],
    ["2.5 d", 2.5 * DAY, "+530"],
    ["3.5 d", 3.5 * DAY, "z"],
    ["7 d", 7 * DAY, "-5"],
    ["14 d", 14 * DAY, "zs"],
    ["21 d", 21 * DAY, "z"],
  ];
  const states: [string, EngineState][] = [
    ["a final", sc.A.states[sc.A.workouts.length]],
    [
      "b after the 130 min run and deadlift",
      sc.B.states[idxOf(sc.B, B_IDS.runBeforeLift) + 12],
    ],
    ["b after the 230 min run", sc.B.states[idxOf(sc.B, B_IDS.vdot230) + 1]],
    ["e day 20", sc.E.states[20]],
  ];
  states.forEach(([nm, st], si) => {
    const u = ms(st.updated);
    offsets.forEach(([on, off, style], oi) => {
      const [ckName, c, sm] = CHECKINS[(si + oi) % CHECKINS.length];
      add(
        `${nm}, now ${on} after updated (${style}): ${ckName}`,
        st,
        c,
        sm,
        fmt(u + off, style),
      );
    });
    for (const [ckName, c, sm] of CHECKINS) {
      add(
        `${nm}, now 1 d after updated: ${ckName}`,
        st,
        c,
        sm,
        fmt(u + DAY, "z"),
      );
    }
    add(
      `${nm}, now == updated`,
      st,
      CHECKINS[2][1],
      CHECKINS[2][2],
      st.updated,
    );
    add(
      `${nm}, now 200 d later (everything decayed)`,
      st,
      CHECKINS[0][1],
      CHECKINS[0][2],
      fmt(u + 200 * DAY, "z"),
    );
    add(
      `${nm}, now 1 d BEFORE updated: no decay, window anchored at now`,
      st,
      CHECKINS[2][1],
      CHECKINS[2][2],
      fmt(u - DAY, "-5"),
    );
    add(
      `${nm}, now 1 ms after updated`,
      st,
      CHECKINS[0][1],
      CHECKINS[0][2],
      fmt(u + 1, "z"),
    );
  });

  // Hand-built states: DST, month boundary, key normalisation, prs window.
  {
    const spring = [
      heavyLift("h1", "2026-03-06T19:00:00-05:00"),
      heavyRun("h2", "2026-03-07T20:00:00-05:00"),
    ].reduce(
      logSession as (s: EngineState, w: Workout) => EngineState,
      initialState(),
    );
    must(
      spring.updated === "2026-03-07T20:00:00-05:00",
      "decay: spring state date",
    );
    add(
      "DST spring forward: updated Sat 20:00 EST, now Mon 09:00 EDT",
      spring,
      ck(7, { quads: 2 }),
      ["quads", "glutes", "calves"],
      "2026-03-09T09:00:00-04:00",
    );
    add(
      "DST spring forward: now 23 h after in wall-clock-looking 24 h",
      spring,
      ck(7, { quads: 2 }),
      ["quads", "glutes", "calves"],
      "2026-03-08T20:00:00-04:00",
    );
    const fall = [
      heavyLift("h3", "2026-10-30T19:00:00-04:00"),
      heavyRun("h4", "2026-10-31T20:00:00-04:00"),
    ].reduce(
      logSession as (s: EngineState, w: Workout) => EngineState,
      initialState(),
    );
    add(
      "DST fall back: updated Sat 20:00 EDT, now Mon 07:00 EST",
      fall,
      ck(7, { quads: 2 }),
      ["quads", "glutes", "calves"],
      "2026-11-02T07:00:00-05:00",
    );
    add(
      "DST fall back: now 25 h later (wall clock 24 h)",
      fall,
      ck(7, { quads: 2 }),
      ["quads", "glutes", "calves"],
      "2026-11-01T20:00:00-05:00",
    );
    const feb = [
      heavyLift("h5", "2026-02-26T19:00:00-05:00"),
      heavyRun("h6", "2026-02-27T20:00:00-05:00"),
    ].reduce(
      logSession as (s: EngineState, w: Workout) => EngineState,
      initialState(),
    );
    add(
      "month boundary: updated Feb 27, now Mar 2",
      feb,
      ck(6.5, { quads: 3 }),
      ["quads", "glutes"],
      "2026-03-02T08:00:00-05:00",
    );
    add("month boundary in UTC forms", feb, ck(6.5, { quads: 3 }), [
      "quads",
      "glutes",
    ], "2026-03-01T01:00:00Z");
    const year = [
      heavyLift("h7", "2026-12-30T19:00:00-05:00"),
      heavyRun("h8", "2026-12-31T20:00:00-05:00"),
    ].reduce(
      logSession as (s: EngineState, w: Workout) => EngineState,
      initialState(),
    );
    add(
      "year boundary: updated Dec 31, now Jan 2",
      year,
      ck(6.5, { quads: 3 }),
      ["quads", "glutes"],
      "2027-01-02T10:00:00+05:30",
    );
  }
  // Key normalisation in muscleTau: spellings that map to 2.5 and 2.0.
  {
    const st = mkState({
      updated: "2026-02-10T12:00:00.000Z",
      fatigueMuscle: {
        "Lower Back": 6,
        upper_back: 6,
        "upper-back": 6,
        UpperBack: 6,
        Quadriceps: 6,
        quads: 6,
        chest: 6,
        "lower-back": 6,
        shoulders: 6,
      },
      runFatigueMuscle: { quads: 3, "Lower Back": 3 },
      fatigueDamage: { "Lower Back": 4, quads: 2 },
      runFatigueDamage: { quads: 1 },
      fatigueSystemic: 5,
      fitnessRun: 2,
      fitness: { squat: 10 },
    });
    const names = [
      "Lower Back",
      "upper_back",
      "upper-back",
      "UpperBack",
      "Quadriceps",
      "quads",
      "chest",
      "lower-back",
      "shoulders",
    ];
    add(
      "muscleTau spellings decay with 2.5 d or 2.0 d (1 d later)",
      st,
      ck(8),
      names,
      "2026-02-11T12:00:00.000Z",
    );
    add(
      "muscleTau spellings decay with 2.5 d or 2.0 d (4 d later)",
      st,
      ck(8),
      names,
      "2026-02-14T12:00:00.000Z",
    );
    add(
      "same state, a single spelling (Lower Back)",
      st,
      ck(8),
      ["Lower Back"],
      "2026-02-13T12:00:00.000Z",
    );
  }
  // The prs window follows `now`, not `updated`.
  {
    const U = "2026-02-10T12:00:00.000Z";
    const um = ms(U);
    const st = mkState({
      updated: U,
      prsHistory: [
        { date: fmt(um - 27 * DAY), value: 9 },
        { date: fmt(um - 20 * DAY), value: 8 },
        { date: fmt(um - 10 * DAY), value: 7 },
        { date: fmt(um - 1 * DAY), value: 6 },
      ],
      fatigueMuscle: { quads: 4 },
      fatigueSystemic: 2,
    });
    add("prs window: now == updated, 4 points", st, ck(5), ["quads"], U);
    add(
      "prs window: now 1 d later drops the 27 d point",
      st,
      ck(5),
      ["quads"],
      fmt(um + 2 * DAY),
    );
    add("prs window: now 18 d later keeps only the last two", st, ck(5), [
      "quads",
    ], fmt(um + 18 * DAY));
    add(
      "prs window: now 40 d later leaves none",
      st,
      ck(5),
      ["quads"],
      fmt(um + 40 * DAY),
    );
    add("prs window: now exactly 28 d after the first point + 1 d", st, ck(5), [
      "quads",
    ], fmt(um - 27 * DAY + 28 * DAY));
    add("prs window: before updated, window anchored earlier", st, ck(5), [
      "quads",
    ], fmt(um - 5 * DAY));
  }
  emit("readiness_decay", "ts+decay", cs);
}

// ---------------------------------------------------------------------------
// availability.json
// ---------------------------------------------------------------------------

function genAvailability(): void {
  const cs: GoldenCase[] = [];
  const day = "2026-09-13";
  const ACTIVE: Availability = { status: "active" };
  const REASONS: SkipReason[] = [
    "break",
    "vacation",
    "sick",
    "injured",
    "scheduling",
  ];

  const sp = (name: string, reason: SkipReason) =>
    cs.push(fcase("shiftsPlan", name, { reason }, (a) => shiftsPlan(a.reason)));
  for (const r of REASONS) sp(`reason ${r}`, r);

  const cv = (name: string, a: Availability, dateKey: string) =>
    cs.push(
      fcase(
        "coversDay",
        name,
        { a, dateKey },
        (x) => coversDay(x.a, x.dateKey),
      ),
    );
  // availability_test.ts: status spans cover since through until, inclusive.
  const vac: Availability = {
    status: "vacation",
    since: "2026-09-10",
    until: "2026-09-12",
  };
  cv("closed span: before since", vac, "2026-09-09");
  cv("closed span: since day", vac, "2026-09-10");
  cv("closed span: middle", vac, "2026-09-11");
  cv("closed span: until day", vac, "2026-09-12");
  cv("closed span: after until", vac, "2026-09-13");
  cv("active status never covers", ACTIVE, "2026-09-11");
  cv(
    "open span: far future stays on",
    { status: "sick", since: "2026-09-10" },
    "2027-01-01",
  );
  cv(
    "open span: before since",
    { status: "sick", since: "2026-09-10" },
    "2026-09-09",
  );
  cv(
    "open span: since day",
    { status: "sick", since: "2026-09-10" },
    "2026-09-10",
  );
  // Extras.
  cv("active status with since and until never covers", {
    status: "active",
    since: "2026-09-10",
    until: "2026-09-20",
  }, "2026-09-15");
  cv(
    "non-active status without since never covers",
    { status: "break" },
    "2026-09-15",
  );
  cv("non-active status with until only never covers", {
    status: "break",
    until: "2026-09-20",
  }, "2026-09-15");
  cv("one-day span", {
    status: "injured",
    since: "2026-09-13",
    until: "2026-09-13",
    muscle: "quads",
  }, "2026-09-13");
  cv("one-day span, day before", {
    status: "injured",
    since: "2026-09-13",
    until: "2026-09-13",
    muscle: "quads",
  }, "2026-09-12");
  cv("one-day span, day after", {
    status: "injured",
    since: "2026-09-13",
    until: "2026-09-13",
    muscle: "quads",
  }, "2026-09-14");
  cv("empty span (until before since): inside the reversed range", {
    status: "break",
    since: "2026-09-12",
    until: "2026-09-10",
  }, "2026-09-11");
  cv("empty span (until before since): at since", {
    status: "break",
    since: "2026-09-12",
    until: "2026-09-10",
  }, "2026-09-12");
  cv("span across the year boundary: Dec 31", {
    status: "vacation",
    since: "2026-12-28",
    until: "2027-01-03",
  }, "2026-12-31");
  cv("span across the year boundary: Jan 1", {
    status: "vacation",
    since: "2026-12-28",
    until: "2027-01-03",
  }, "2027-01-01");
  cv("span across the year boundary: Jan 4", {
    status: "vacation",
    since: "2026-12-28",
    until: "2027-01-03",
  }, "2027-01-04");
  for (const st of REASONS) {
    cv(
      `status ${st} covers its since day`,
      { status: st, since: "2026-09-10" },
      "2026-09-10",
    );
  }
  cv("note and muscle are ignored", {
    status: "sick",
    since: "2026-09-10",
    note: "flu",
    muscle: "quads",
  }, "2026-09-11");

  const ro = (
    name: string,
    dateKey: string,
    availability: Availability,
    skips: DaySkip[],
  ) =>
    cs.push(
      fcase("reasonOn", name, { dateKey, availability, skips }, (a) =>
        reasonOn(a.dateKey, a.availability, a.skips)),
    );
  // availability_test.ts.
  ro("a clear day trains", day, ACTIVE, []);
  const sick: Availability = { status: "sick", since: "2026-09-10" };
  ro("a one-day skip wins over the persistent status", day, sick, [{
    date: day,
    reason: "break",
  }]);
  ro("a skip on another day is ignored", day, sick, [{
    date: "2026-09-12",
    reason: "break",
  }]);
  // Extras.
  ro("status covers the day, no skips", day, sick, []);
  ro("status span lapsed, no skips", day, {
    status: "sick",
    since: "2026-09-01",
    until: "2026-09-12",
  }, []);
  ro("status span not started, no skips", day, {
    status: "sick",
    since: "2026-09-14",
  }, []);
  ro("skip on a day outside any status", day, ACTIVE, [{
    date: day,
    reason: "scheduling",
  }]);
  ro("skip beats a covering injured status", day, {
    status: "injured",
    since: "2026-09-10",
    muscle: "quads",
  }, [{ date: day, reason: "vacation" }]);
  ro("first skip wins when two share a day", day, ACTIVE, [
    { date: day, reason: "break" },
    { date: day, reason: "sick" },
  ]);
  ro("first skip wins (reversed order)", day, ACTIVE, [
    { date: day, reason: "sick" },
    { date: day, reason: "break" },
  ]);
  ro("other skips before the matching one", day, ACTIVE, [
    { date: "2026-09-11", reason: "break" },
    { date: day, reason: "injured", muscle: "quads" },
    { date: "2026-09-15", reason: "sick" },
  ]);
  ro("injured status yields 'injured'", day, {
    status: "injured",
    since: "2026-09-10",
    muscle: "calves",
  }, []);
  ro("vacation status yields 'vacation'", day, {
    status: "vacation",
    since: "2026-09-10",
    until: "2026-09-20",
  }, []);
  ro("active status with a stale since", day, {
    status: "active",
    since: "2026-09-10",
  }, []);
  ro("skip with a note", day, ACTIVE, [{
    date: day,
    reason: "sick",
    note: "flu",
  }]);
  ro("empty skips and status in the past", day, {
    status: "break",
    since: "2026-08-01",
    until: "2026-08-10",
  }, []);

  const cd = (
    name: string,
    dateKey: string,
    availability: Availability,
    skips: DaySkip[],
  ) =>
    cs.push(
      fcase("classifyDay", name, { dateKey, availability, skips }, (a) =>
        classifyDay(a.dateKey, a.availability, a.skips)),
    );
  cd("a clear day trains", day, ACTIVE, []);
  for (const r of REASONS) {
    cd(`one-day skip ${r}`, day, ACTIVE, [{ date: day, reason: r }]);
  }
  for (const r of REASONS) {
    cd(`status ${r}`, day, {
      status: r,
      since: "2026-09-10",
      ...(r === "injured" ? { muscle: "quads" } : {}),
    }, []);
  }
  cd("skip break beats a vacation status", day, {
    status: "vacation",
    since: "2026-09-10",
  }, [{ date: day, reason: "break" }]);
  cd("skip vacation beats an injured status", day, {
    status: "injured",
    since: "2026-09-10",
    muscle: "quads",
  }, [{ date: day, reason: "vacation" }]);
  cd("lapsed status trains", day, {
    status: "sick",
    since: "2026-09-01",
    until: "2026-09-12",
  }, []);

  const io = (
    name: string,
    dateKey: string,
    availability: Availability,
    skips: DaySkip[],
  ) =>
    cs.push(
      fcase("injuredOn", name, { dateKey, availability, skips }, (a) =>
        injuredOn(a.dateKey, a.availability, a.skips)),
    );
  // availability_test.ts.
  io("skip muscle", day, ACTIVE, [{
    date: day,
    reason: "injured",
    muscle: "quads",
  }]);
  io("non-injured skip", day, ACTIVE, [{ date: day, reason: "sick" }]);
  io("status muscle", day, {
    status: "injured",
    since: "2026-09-10",
    muscle: "calves",
  }, []);
  io("lapsed status", day, {
    status: "injured",
    since: "2026-09-10",
    until: "2026-09-12",
    muscle: "calves",
  }, []);
  // Extras.
  io("skip target beats status target", day, {
    status: "injured",
    since: "2026-09-10",
    muscle: "quads",
  }, [{ date: day, reason: "injured", muscle: "calves" }]);
  io("injured skip without a muscle beats a status that has one", day, {
    status: "injured",
    since: "2026-09-10",
    muscle: "quads",
  }, [{ date: day, reason: "injured" }]);
  io(
    "any skip on the day beats the injured status (sick skip gives none)",
    day,
    { status: "injured", since: "2026-09-10", muscle: "quads" },
    [{ date: day, reason: "sick" }],
  );
  io("status injured without a muscle", day, {
    status: "injured",
    since: "2026-09-10",
  }, []);
  io("status vacation with a muscle set", day, {
    status: "vacation",
    since: "2026-09-10",
    muscle: "quads",
  }, []);
  io("status active with a muscle set", day, {
    status: "active",
    since: "2026-09-10",
    muscle: "quads",
  }, []);
  io("status injured, open span, far future", "2027-03-01", {
    status: "injured",
    since: "2026-09-10",
    muscle: "hamstrings",
  }, []);
  io("status injured, day before since", "2026-09-09", {
    status: "injured",
    since: "2026-09-10",
    muscle: "hamstrings",
  }, []);
  io("status injured, until day inclusive", "2026-09-12", {
    status: "injured",
    since: "2026-09-10",
    until: "2026-09-12",
    muscle: "hamstrings",
  }, []);
  io("status injured without since never covers", day, {
    status: "injured",
    muscle: "hamstrings",
  }, []);
  io("first skip on the day decides", day, ACTIVE, [
    { date: day, reason: "injured", muscle: "quads" },
    { date: day, reason: "injured", muscle: "calves" },
  ]);
  io("non-injured skip first, injured skip second", day, ACTIVE, [
    { date: day, reason: "break" },
    { date: day, reason: "injured", muscle: "calves" },
  ]);
  io("muscle spelling is returned as stored", day, ACTIVE, [{
    date: day,
    reason: "injured",
    muscle: "Quadriceps",
  }]);
  io("no skips, active", day, ACTIVE, []);

  const nm = (name: string, muscle: string) =>
    cs.push(fcase("normMuscle", name, { muscle }, (a) => normMuscle(a.muscle)));
  nm("quadriceps aliases to quads", "quadriceps");
  nm("Quadriceps (case)", "Quadriceps");
  nm("QUADRICEPS", "QUADRICEPS");
  nm("quads stays", "quads");
  nm("Quads (case)", "Quads");
  nm("space inside an alias: Quad Riceps", "Quad Riceps");
  nm("hyphen inside an alias: quadri-ceps", "quadri-ceps");
  nm("underscore inside an alias: quadri_ceps", "quadri_ceps");
  nm("hyphen: upper-back", "upper-back");
  nm("space: upper back", "upper back");
  nm("underscore: upper_back", "upper_back");
  nm("joined: upperback", "upperback");
  nm("hyphen and case: Lower-Back", "Lower-Back");
  nm("mixed separators: ' _-Lower_-Back- '", " _-Lower_-Back- ");
  nm("tab and newline", "\tchest\n");
  nm("non-breaking space: upper\\u00a0back", "upper back");
  nm("plain: chest", "chest");
  nm("plain: hamstrings", "hamstrings");
  nm("plural kept: glutes", "glutes");
  nm("quad (not aliased)", "quad");
  nm("empty string", "");
  nm("only separators", " _- ");

  const ge = (
    name: string,
    targets: string[],
    synergists: string[] | undefined,
    injured: string[],
  ) => {
    const args: {
      targets: string[];
      synergists?: string[];
      injured: string[];
    } = { targets, injured };
    if (synergists !== undefined) args.synergists = synergists;
    cs.push(
      fcase(
        "guardExercise",
        name,
        args,
        (a) => guardExercise(a.targets, a.synergists, a.injured),
      ),
    );
  };
  // availability_test.ts.
  ge("direct target injured: skip", ["quads"], ["glutes"], ["quads"]);
  ge("synergist only injured: halve", ["chest"], ["triceps"], ["triceps"]);
  ge("unrelated injury: train", ["chest"], ["triceps"], ["quads"]);
  ge("no synergists key", ["chest"], undefined, ["triceps"]);
  ge("nobody hurt", ["chest"], ["triceps"], []);
  ge("body-map alias and case (Quadriceps vs quads)", ["quads"], [], [
    "Quadriceps",
  ]);
  // Extras.
  ge(
    "alias on the target side (quadriceps target, quads injured)",
    ["quadriceps"],
    [],
    ["quads"],
  );
  ge("alias on both sides", ["Quadriceps"], [], ["QUADS"]);
  ge("separators: upper-back target, upper_back injured", ["upper-back"], [], [
    "upper_back",
  ]);
  ge("separators: lower back synergist, Lower-Back injured", ["chest"], [
    "lower back",
  ], ["Lower-Back"]);
  ge("target and synergist both injured: skip wins", ["quads"], ["glutes"], [
    "glutes",
    "quads",
  ]);
  ge("two injured, only a synergist matches", ["chest"], [
    "triceps",
    "shoulders",
  ], ["quads", "shoulders"]);
  ge("two injured, none match", ["chest"], ["triceps"], ["quads", "calves"]);
  ge("empty targets, synergist injured: halve", [], ["triceps"], ["triceps"]);
  ge("empty targets and synergists: train", [], [], ["triceps"]);
  ge("empty targets, no synergists key: train", [], undefined, ["triceps"]);
  ge("several targets, the second is injured", ["quads", "glutes", "calves"], [
    "hamstrings",
  ], ["calves"]);
  ge("injured spelling with only separators and case", ["glutes"], [], [
    " G_l-U tes ",
  ]);
  ge("injured name that matches nothing", ["glutes"], ["hamstrings"], [
    "elbow",
  ]);

  const ai = (name: string, checkin: Checkin, injured: string[]) =>
    cs.push(
      fcase("applyInjuryToCheckin", name, { checkin, injured }, (a) =>
        applyInjuryToCheckin(a.checkin, a.injured)),
    );
  // availability_test.ts.
  ai("injured muscles check in at soreness 4", ck(7, { quads: 2, glutes: 3 }), [
    "quads",
  ]);
  ai("no injuries, no change", ck(7, { quads: 2 }), []);
  // Extras.
  ai(
    "injured muscle absent from the check-in is added at 4",
    ck(7, { chest: 1 }),
    ["quads"],
  );
  ai("soreness already 4 stays 4", ck(7, { quads: 4 }), ["quads"]);
  ai("soreness 1 is raised to 4", ck(9, { quads: 1, chest: 1 }), ["quads"]);
  ai("alias: Quadriceps is stored under the key quads", ck(7, { chest: 2 }), [
    "Quadriceps",
  ]);
  ai(
    "both spellings kept: an existing Quadriceps key plus the new quads key",
    ck(7, { Quadriceps: 2 }),
    ["quads"],
  );
  ai("separators are stripped: Upper Back becomes upperback", ck(7, {}), [
    "Upper Back",
  ]);
  ai("several injured muscles", ck(5.5, { quads: 2, calves: 1, chest: 3 }), [
    "quads",
    "calves",
    "Upper_Back",
  ]);
  ai("empty soreness, no injuries", ck(6, {}), []);
  ai("empty soreness with an injury", ck(6, {}), ["hamstrings"]);
  ai("prs is untouched", ck(3.5, { quads: 2 }), ["quads"]);

  const ad = (name: string, dateKey: string, days: number) =>
    cs.push(
      fcase("addDaysKey", name, { dateKey, days }, (a) =>
        addDaysKey(a.dateKey, a.days)),
    );
  // availability_test.ts.
  ad("plus zero", "2026-09-13", 0);
  ad("month roll", "2026-09-30", 1);
  ad("plus week", "2026-09-13", 7);
  // Extras.
  ad("minus one day within a month", "2026-09-13", -1);
  ad("minus one day across the month start", "2026-03-01", -1);
  ad("February end (non-leap)", "2026-02-28", 1);
  ad("February end plus two (non-leap)", "2026-02-28", 2);
  ad("year end plus one", "2026-12-31", 1);
  ad("year start minus one", "2027-01-01", -1);
  ad("leap day 2028: Feb 28 plus one", "2028-02-28", 1);
  ad("leap day 2028: Feb 28 plus two", "2028-02-28", 2);
  ad("leap day 2028: Feb 29 plus one", "2028-02-29", 1);
  ad("leap day 2028: Mar 1 minus one", "2028-03-01", -1);
  ad("leap day 2028: Feb 29 plus 365", "2028-02-29", 365);
  ad("leap day 2028: Feb 29 minus 365", "2028-02-29", -365);
  ad("leap day 2028: Feb 29 plus 1461 (four years)", "2028-02-29", 1461);
  ad("plus 365 over a leap year", "2027-03-01", 366);
  ad("century rule: 2100 is not a leap year", "2100-02-28", 1);
  ad("US spring-forward date (UTC math, no DST effect)", "2026-03-07", 1);
  ad("US spring-forward date plus two", "2026-03-07", 2);
  ad("US fall-back date plus one", "2026-10-31", 1);
  ad("US fall-back date plus two", "2026-10-31", 2);
  ad("over a month: plus 31", "2026-01-31", 31);
  ad("a long way back", "2026-09-13", -10000);
  ad("a long way forward", "2026-09-13", 10000);
  ad("Sunday to next Monday", "2026-09-13", 1);
  ad("minus 30 across a month", "2026-10-15", -30);
  // An invalid key throws RangeError in TS (new Date(NaN).toISOString()).
  const thrown = (name: string, dateKey: string, days: number) =>
    cs.push(
      fcase("addDaysKey", name, { dateKey, days }, (a) => {
        try {
          return addDaysKey(a.dateKey, a.days);
        } catch (e) {
          const err = e as Error;
          return { "$throws": err.name, message: err.message };
        }
      }),
    );
  thrown("invalid key throws: not a date", "not-a-date", 1);
  thrown("invalid key throws: empty string", "", 1);
  emit("availability", "ts", cs);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): void {
  genDecay();
  genE1rm();
  genKalman();
  genRunning();
  const sc = genLogSession();
  genCalibrate(sc);
  genReadiness(sc);
  genFatigueLocal();
  genReadinessDecay(sc);
  genAvailability();
  console.log(`done: ${counts.reduce((a, [, n]) => a + n, 0)} cases`);
}

main();
