// Golden-file oracle for the Rust port of packages/run (crates/qala-core/src/run).
//
//   deno task golden:run     # same as: deno run -A scripts/golden_run.ts
//
// Runs the real TS run pipeline and writes testdata/golden/run/*.json. The file
// formats and the conventions Rust must follow are in testdata/golden/run/README.md.
// Output is deterministic: every generator draws from the seeded Rng in
// fuzz_lib.ts, so regenerating gives byte-identical files.
//
// After writing, the script re-runs every case with the trig functions and
// Math.hypot nudged by one ulp in each direction and aborts when any discrete
// output (a point count, a flag, a pause, an event, a split count) changes, so no
// vector sits on a decision that another libm could flip. The worst relative
// error of the nudged runs is printed (the engine goldens do the same).

import { canon, toJson } from "./golden_liftoscript_lib.ts";
import { Rng } from "./fuzz_lib.ts";
import {
  filterFixes,
  FixFilter,
  haversineM,
  vincentyM,
} from "../packages/run/filter.ts";
import type { FilterOptions } from "../packages/run/filter.ts";
import {
  AutoPause,
  type AutoPauseOptions,
  causalClockTrace,
  computePauses,
  movingElapsedAt,
  pausedOverlap,
} from "../packages/run/autopause.ts";
import { computeSplits, KM_M, MILE_M } from "../packages/run/splits.ts";
import type { SplitOptions } from "../packages/run/splits.ts";
import {
  averagePace,
  cuePace,
  currentPace,
  distAt,
  windowSpeed,
} from "../packages/run/pace.ts";
import {
  expandWorkout,
  type GuidedOptions,
  GuidedRun,
} from "../packages/run/guided.ts";
import { processRun } from "../packages/run/mod.ts";
import type { ProcessRunOptions } from "../packages/run/mod.ts";
import type {
  FilteredPoint,
  Fix,
  RunWorkout,
  WorkoutStep,
} from "../packages/run/types.ts";
import { lineFixes, stopFixes } from "../packages/run/testutil.ts";

// ---------------------------------------------------------------------------
// Output plumbing
// ---------------------------------------------------------------------------

const OUT_DIR = new URL("../testdata/golden/run/", import.meta.url).pathname;

/** Relative tolerance recorded on every case whose output holds floats. */
const TOL = 1e-9;

/**
 * Absolute floor of the float comparison (the engine README's rule with 1e-9 in
 * place of 1e-12): `|a - e| <= tolerance * max(|a|, |e|) + 1e-9`. A stationary
 * run's speed or distance step is a few micro-units left over from a difference
 * of large numbers; it moves in the 11th digit with the last bit of a libm call
 * and means nothing.
 */
const ABS_FLOOR = 1e-9;

interface GoldenCase {
  name: string;
  input: unknown;
  expected: unknown;
  tolerance?: number;
}

/** Fail the generation when a scenario did not reach the branch it targets. */
function must(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`golden_run: scenario check failed: ${msg}`);
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

/** Closures that recompute a case's output, for the one-ulp nudge pass. */
const recompute = new Map<GoldenCase, () => unknown>();

/**
 * One case of a single-function file. `input` is frozen to canonical JSON first
 * and `call` runs on a fresh revived copy of it, so Rust replays exactly what TS
 * ran on.
 */
function mk<I>(
  name: string,
  input: I,
  call: (input: I) => unknown,
  tolerance: number | undefined = TOL,
): GoldenCase {
  const frozen = freeze(input);
  const run = () => freeze(call(revive(freeze(input)) as I));
  const c: GoldenCase = { name, input: frozen, expected: run() };
  if (tolerance !== undefined) c.tolerance = tolerance;
  recompute.set(c, run);
  return c;
}

/** A case of a multi-function file: input is `{fn, args}`. */
function fcase<A>(
  fn: string,
  name: string,
  args: A,
  call: (args: A) => unknown,
  tolerance: number | undefined = TOL,
): GoldenCase {
  const frozen = freeze(args);
  const run = () => freeze(call(revive(freeze(args)) as A));
  const c: GoldenCase = {
    name,
    input: { fn, args: frozen },
    expected: run(),
  };
  if (tolerance !== undefined) c.tolerance = tolerance;
  recompute.set(c, run);
  return c;
}

const counts: [string, number][] = [];
const emitted: GoldenCase[] = [];

/** Write one golden file. */
function emit(file: string, cases: GoldenCase[]): void {
  const names = new Set<string>();
  for (const c of cases) {
    const key = `${(c.input as { fn?: string }).fn ?? ""}::${c.name}`;
    must(!names.has(key), `duplicate case name in ${file}: ${key}`);
    names.add(key);
  }
  const lines = cases.map((c) => "  " + toJson(c, undefined).trimEnd());
  const text = `{\n "fn": ${
    JSON.stringify(file)
  },\n "version": 1,\n "oracle": "ts",\n "cases": [\n${
    lines.join(",\n")
  }\n ]\n}\n`;
  Deno.mkdirSync(OUT_DIR, { recursive: true });
  Deno.writeTextFileSync(`${OUT_DIR}${file}.json`, text);
  counts.push([file, cases.length]);
  emitted.push(...cases);
  console.log(`${file}.json: ${cases.length} cases, ${text.length} bytes`);
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/** Metres per degree of latitude the repo's test helpers use. */
const M_PER_DEG = 111319.49;

/** Standard normal from two uniforms (Box-Muller). */
function gauss(rng: Rng): number {
  const u = Math.max(rng.next(), 1e-12);
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Round to a number of decimals the way a timestamp in seconds usually looks. */
function dec(x: number, places: number): number {
  const k = 10 ** places;
  return Math.round(x * k) / k;
}

interface Leg {
  /** Seconds this leg lasts. */
  sec: number;
  /** Ground speed in m/s (0 for a stop). */
  speed: number;
  /** Heading change over the leg in degrees (default 0). */
  turn?: number;
}

interface TrackSpec {
  rng: Rng;
  legs: Leg[];
  t0?: number;
  /** Nominal seconds between fixes. */
  dt?: number;
  /** Uniform jitter on dt as a fraction of dt (0 gives a metronome). */
  dtJitter?: number;
  /** Decimals kept on timestamps (default 3). */
  tPlaces?: number;
  lat?: number;
  lon?: number;
  heading?: number;
  /** Position noise sd in metres, applied on both axes. */
  noiseM?: number;
  /** Reported accuracy: base plus uniform jitter. */
  acc?: number;
  accJitter?: number;
  /** Mean HR (a gentle random walk around it); omit for no HR field. */
  hr?: number;
  /** Chance a fix drops its HR field when hr is set. */
  hrMissing?: number;
}

/** A random walk along legs of constant speed, sampled with noise. */
function track(spec: TrackSpec): Fix[] {
  const {
    rng,
    legs,
    t0 = 0,
    dt = 1,
    dtJitter = 0,
    tPlaces = 3,
    noiseM = 0,
    acc = 4,
    accJitter = 0,
  } = spec;
  let lat = spec.lat ?? 47.6062;
  let lon = spec.lon ?? -122.3321;
  let heading = spec.heading ?? 30;
  let hr = spec.hr;
  const out: Fix[] = [];
  let t = t0;
  let clock = t0;
  for (const leg of legs) {
    const end = clock + leg.sec;
    const turnPerSec = (leg.turn ?? 0) / leg.sec;
    while (t < end) {
      const step = dt * (1 + dtJitter * (rng.next() * 2 - 1));
      t += step;
      heading += turnPerSec * step;
      const dist = leg.speed * step;
      const h = heading * Math.PI / 180;
      lat += (dist * Math.cos(h)) / M_PER_DEG;
      lon += (dist * Math.sin(h)) /
        (M_PER_DEG * Math.cos(lat * Math.PI / 180));
      const fix: Fix = {
        t: dec(t, tPlaces),
        lat: lat + (noiseM > 0 ? gauss(rng) * noiseM / M_PER_DEG : 0),
        lon: lon +
          (noiseM > 0
            ? gauss(rng) * noiseM /
              (M_PER_DEG * Math.cos(lat * Math.PI / 180))
            : 0),
        acc: dec(acc + rng.next() * accJitter, 1),
      };
      if (hr !== undefined) {
        hr = Math.min(190, Math.max(90, hr + gauss(rng) * 0.8));
        if (!rng.chance(spec.hrMissing ?? 0)) fix.hr = Math.round(hr);
      }
      out.push(fix);
    }
    clock = end;
  }
  return out;
}

// ---------------------------------------------------------------------------
// geodesy.json
// ---------------------------------------------------------------------------

function genGeodesy(): void {
  const cs: GoldenCase[] = [];
  const both = (
    name: string,
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ) => {
    const args = { lat1, lon1, lat2, lon2 };
    const v = fcase(
      "vincentyM",
      name,
      args,
      (a) => vincentyM(a.lat1, a.lon1, a.lat2, a.lon2),
    );
    // sinSigma comes from a difference of two products near 1, so a segment of d
    // metres carries about 1e-16 * 6.4e6 / d relative error from the last bit of
    // any trig result. Short segments get a tolerance that says so.
    const d = v.expected as number;
    if (Number.isFinite(d) && d > 0) {
      v.tolerance = Math.max(TOL, 2e-8 / Math.max(d, 1e-3));
    }
    cs.push(v);
    cs.push(fcase(
      "haversineM",
      name,
      args,
      (a) => haversineM(a.lat1, a.lon1, a.lat2, a.lon2),
    ));
  };

  // Known distances.
  both("one degree of latitude on the equator", 0, 0, 1, 0);
  both("one degree of longitude on the equator", 0, 0, 0, 1);
  both("Seattle to Portland", 47.6062, -122.3321, 45.5152, -122.6784);
  both("London to Paris", 51.5074, -0.1278, 48.8566, 2.3522);
  both(
    "Flinders Peak to Buninyong",
    -37.95103341,
    144.42486789,
    -37.65282113,
    143.92649552,
  );
  both("New York to Sydney", 40.7128, -74.006, -33.8688, 151.2093);
  both("meridian arc 45 N to 46 N", 45, 10, 46, 10);
  both("along the 60th parallel", 60, 0, 60, 10);
  both("across the antimeridian", 10, 179.9, 10, -179.9);
  both("across the antimeridian by longitude delta", 0, 179.5, 0, -179.5);
  both("pole to equator", 90, 0, 0, 0);
  both("pole to pole", 90, 0, -90, 0);
  both("south pole to near south pole", -90, 33, -89, 120);
  both("north of the polar circle", 80, 20, 80.5, 22);

  // Coincident and equal points (Vincenty returns 0 on sinSigma === 0).
  both("identical points", 47.6062, -122.3321, 47.6062, -122.3321);
  both("identical points at the origin", 0, 0, 0, 0);
  both("identical longitudes wrapped by 360", 12, 20, 12, 380);
  both("equatorial line", 0, 10, 0, 60);
  both("equatorial line, west to east across zero", 0, -30, 0, 30);

  // Sub-metre to metre scale, the segments a 1 Hz filter produces.
  for (const m of [0.001, 0.01, 0.1, 0.5, 1, 3, 10, 100]) {
    const dLat = m / M_PER_DEG;
    both(`${m} m north`, 47.6062, -122.3321, 47.6062 + dLat, -122.3321);
    both(
      `${m} m east`,
      47.6062,
      -122.3321,
      47.6062,
      -122.3321 + dLat / Math.cos(47.6062 * Math.PI / 180),
    );
    both(
      `${m} m diagonal`,
      47.6062,
      -122.3321,
      47.6062 + dLat * 0.6,
      -122.3321 + dLat * 0.8 / Math.cos(47.6062 * Math.PI / 180),
    );
  }

  // Near-antipodal pairs, where Vincenty fails to converge and falls back to
  // haversine, and the ones just on either side of that.
  both("antipodal", 0, 0, 0, 180);
  both("antipodal off the equator", 30, 40, -30, -140);
  both("near antipodal, 0.5 degrees short", 0, 0, 0, 179.5);
  both("near antipodal, 0.1 degrees short", 10, 0, -10, 179.9);
  both("near antipodal, 1 degree short", 20, 10, -20, 189);
  both("near antipodal, 0.01 degrees short", 5, 5, -5, 184.99);
  both("near antipodal, north south", 89.9, 0, -89.9, 180);
  both("meridional near antipode", 0.5, 0, -0.5, 179.8);

  // Seeded scatter at every scale from a stride to the far side of the earth.
  const rng = new Rng(710001);
  for (let i = 0; i < 60; i++) {
    const lat = rng.float(-85, 85);
    const lon = rng.float(-180, 180);
    const scale = rng.pick([1e-5, 1e-4, 1e-3, 1e-2, 0.1, 1, 10, 60]);
    both(
      `scatter ${i} (scale ${scale} degrees)`,
      lat,
      lon,
      Math.max(-90, Math.min(90, lat + rng.float(-scale, scale))),
      lon + rng.float(-scale, scale),
    );
  }

  // Non-finite input: Vincenty and haversine propagate NaN or fail to converge.
  const nf = (
    name: string,
    la1: number,
    lo1: number,
    la2: number,
    lo2: number,
  ) => both(`nonfinite: ${name}`, la1, lo1, la2, lo2);
  nf("NaN latitude", NaN, 0, 1, 1);
  nf("NaN longitude", 0, 0, 1, NaN);
  nf("infinite longitude", 0, 0, 1, Infinity);
  nf("infinite latitude", Infinity, 0, 1, 1);
  nf("latitude past the pole", 95, 0, 0, 0);
  nf("huge longitude", 0, 0, 0, 1e9);

  emit("geodesy", cs);
}

// ---------------------------------------------------------------------------
// filter.json
// ---------------------------------------------------------------------------

interface FilterInput {
  fixes: Fix[];
  opts?: FilterOptions;
  /**
   * A very long input stored as a generator: Rust rebuilds the line (lineFixes
   * arithmetic) instead of reading 14,400 fixes, and the expected output is a
   * summary (see filterSummary).
   */
  line?: {
    count: number;
    speedMps: number;
    t0?: number;
    dt?: number;
    startLat?: number;
    startLon?: number;
    acc?: number;
  };
  /** Compare only a summary of the points (for a very long input). */
  summary?: number;
}

function runFilter(input: FilterInput) {
  const f = new FixFilter(input.opts ?? {});
  const fixes = input.line ? lineFixes(input.line) : input.fixes;
  const emittedPerPush: number[] = [];
  for (const fix of fixes) {
    const before = f.points.length;
    f.push(fix);
    emittedPerPush.push(f.points.length - before);
  }
  if (input.summary !== undefined) {
    const step = input.summary;
    const pts = f.points;
    return {
      count: pts.length,
      first: pts[0] ?? null,
      last: pts[pts.length - 1] ?? null,
      sampled: pts.filter((_, i) => i % step === 0),
      gaps: pts.filter((p) => p.gap === true).length,
      emittedTotal: emittedPerPush.reduce((a, b) => a + b, 0),
    };
  }
  return { points: f.points, emitted: emittedPerPush };
}

function genFilter(): void {
  const cs: GoldenCase[] = [];
  const add = (name: string, input: FilterInput) =>
    cs.push(mk(name, input, runFilter));
  const accepted = (c: GoldenCase) =>
    (c.expected as { points: unknown[] }).points.length;

  // ---- ported from filter_test.ts ----
  add("straight 300 m line", { fixes: lineFixes({ count: 101, speedMps: 3 }) });

  const base = lineFixes({ count: 60, speedMps: 3 });
  const doubled: Fix[] = [];
  for (const f of base) doubled.push(f, { ...f });
  add("jara dup: the same fix delivered twice", { fixes: doubled });
  add("jara dup: the clean run for comparison", { fixes: base });
  must(
    accepted(cs[cs.length - 1]) === accepted(cs[cs.length - 2]),
    "doubled run keeps as many points",
  );

  add("jara accuracy: a 60 m fix is dropped", {
    fixes: base.map((f, i) =>
      i === 30 ? { ...f, lat: f.lat + 0.002, acc: 60 } : f
    ),
  });

  const l100 = lineFixes({ count: 100, speedMps: 3 });
  const jump = {
    ...l100[50],
    lat: l100[50].lat + 200 / M_PER_DEG,
    acc: 5,
  };
  add("speed gate: a lone 200 m jump is rejected", {
    fixes: [...l100.slice(0, 50), jump, ...l100.slice(50)],
  });

  const l50 = lineFixes({ count: 50, speedMps: 3 });
  const moved = lineFixes({
    count: 6,
    speedMps: 3,
    t0: 50,
    startLat: l50[0].lat + 500 / M_PER_DEG,
  });
  add("speed gate: 3 consecutive fixes re-anchor without counting the jump", {
    fixes: [...l50, ...moved],
  });
  must(
    (cs[cs.length - 1].expected as { points: { gap?: boolean }[] }).points
      .filter((p) => p.gap).length === 1,
    "one re-anchor gap",
  );

  // jara long run, 4 h at 1 Hz: kept as a generated line and a sampled output.
  add("jara long run: 4 h at 1 Hz keeps its first point (generated, sampled)", {
    fixes: [],
    line: { count: 14400, speedMps: 2.5 },
    summary: 500,
  });
  must(
    (cs[cs.length - 1].expected as { count: number }).count === 14400,
    "no point cap",
  );

  // The streaming test: the same fixes pushed in batches of seven. The filter
  // is push-based, so this is the one-shot case again.
  add("streaming in batches matches one-shot filtering", {
    fixes: lineFixes({ count: 300, speedMps: 3.2 }),
  });

  // ---- empty, short ----
  add("empty input", { fixes: [] });
  add("one fix", { fixes: [{ t: 5, lat: 47.6, lon: -122.3, acc: 6 }] });
  add("two fixes", {
    fixes: [
      { t: 5, lat: 47.6, lon: -122.3, acc: 6 },
      { t: 6, lat: 47.60002, lon: -122.3, acc: 6 },
    ],
  });
  add("a single fix with every optional field", {
    fixes: [{
      t: 12.5,
      lat: -33.86,
      lon: 151.2,
      acc: 3.5,
      hr: 142,
      cad: 168,
      ele: 41.5,
    }],
  });

  // ---- accuracy gate ----
  const rngA = new Rng(720001);
  const accRun = track({
    rng: rngA,
    legs: [{ sec: 120, speed: 3 }],
    noiseM: 2,
    acc: 5,
    accJitter: 40,
  });
  add("accuracy jitter 5 to 45 m drops the bad ones", { fixes: accRun });
  must(
    accepted(cs[cs.length - 1]) < accRun.length &&
      accepted(cs[cs.length - 1]) > 20,
    "accuracy gate drops some fixes",
  );
  const onGate = lineFixes({ count: 40, speedMps: 3 }).map((f, i) =>
    i % 3 === 0
      ? { ...f, acc: 25 }
      : i % 3 === 1
      ? { ...f, acc: 25.0000001 }
      : f
  );
  add("accuracy exactly on the gate is kept, a hair above is dropped", {
    fixes: onGate,
  });
  add("custom accuracy gate", {
    fixes: accRun,
    opts: { accuracyGateM: 10 },
  });
  add("accuracy zero is kept, negative is dropped", {
    fixes: lineFixes({ count: 30, speedMps: 3 }).map((f, i) =>
      i % 4 === 0 ? { ...f, acc: 0 } : i % 4 === 1 ? { ...f, acc: -1 } : f
    ),
  });

  // ---- dedupe and ordering ----
  const dupRng = new Rng(720002);
  const steady = track({
    rng: dupRng,
    legs: [{ sec: 150, speed: 3.2, turn: 40 }],
    noiseM: 1.5,
    acc: 4,
    accJitter: 3,
  });
  const late: Fix[] = [];
  for (let i = 0; i < steady.length; i += 5) {
    late.push(...steady.slice(i, i + 5).reverse());
  }
  add("late batches delivered newest first: older fixes are dropped as dups", {
    fixes: late,
  });
  const dupT: Fix[] = [];
  for (const f of steady) {
    dupT.push(f);
    if (dupRng.chance(0.25)) {
      dupT.push({ ...f, lat: f.lat + 0.00003, lon: f.lon - 0.00002 });
    }
  }
  add("duplicate timestamps with different positions keep the first", {
    fixes: dupT,
  });
  add("same fixes in order, delivered as one batch", { fixes: steady });
  add("timestamps going backwards then recovering", {
    fixes: [
      ...steady.slice(0, 20),
      ...steady.slice(10, 15),
      ...steady.slice(20),
    ],
  });
  const zeroDt = steady.slice(0, 30).map((f, i) =>
    i === 15 ? { ...f, t: steady[14].t } : f
  );
  add("a fix repeating the previous timestamp is dropped", { fixes: zeroDt });
  add("a bad-accuracy fix must not consume its timestamp", {
    fixes: [
      { t: 0, lat: 47.6, lon: -122.3, acc: 4 },
      { t: 1, lat: 47.60003, lon: -122.3, acc: 80 },
      { t: 1, lat: 47.600027, lon: -122.3, acc: 4 },
      { t: 2, lat: 47.600054, lon: -122.3, acc: 4 },
    ],
  });
  add("the first fix may carry any timestamp, even a negative one", {
    fixes: lineFixes({ count: 20, speedMps: 3, t0: -10 }),
  });
  add("the first fix has a huge timestamp", {
    fixes: lineFixes({ count: 20, speedMps: 3, t0: 1e9 + 0.25 }),
  });

  // ---- speed gate and re-anchor ----
  const jRng = new Rng(720003);
  const runJ = track({
    rng: jRng,
    legs: [{ sec: 240, speed: 3.3, turn: 90 }],
    noiseM: 1,
    acc: 4,
    accJitter: 2,
  });
  const spiked = runJ.map((f, i) =>
    i % 40 === 20 ? { ...f, lat: f.lat + 150 / M_PER_DEG } : f
  );
  add("isolated 150 m spikes are rejected, no gaps", { fixes: spiked });
  must(
    !(cs[cs.length - 1].expected as { points: { gap?: boolean }[] }).points
      .some((p) => p.gap),
    "spikes never re-anchor",
  );
  const relocate = (from: number, count: number, metres: number) =>
    runJ.map((f, i) =>
      i >= from && i < from + count
        ? { ...f, lat: f.lat + metres / M_PER_DEG }
        : f
    );
  add("teleport for 2 fixes then back: rejected, buffer discarded", {
    fixes: relocate(60, 2, 400),
  });
  add("teleport that stays for 3 fixes re-anchors", {
    fixes: relocate(60, 3, 400),
  });
  add("teleport that stays for 40 fixes re-anchors once, then returns", {
    fixes: relocate(60, 40, 400),
  });
  add("two teleports in a row re-anchor twice", {
    fixes: relocate(150, 40, -300).map((f, i) =>
      i >= 60 && i < 100 ? { ...f, lon: f.lon + 0.004 } : f
    ),
  });
  const ra = cs[cs.length - 1].expected as { points: { gap?: boolean }[] };
  must(ra.points.filter((p) => p.gap).length >= 2, "two re-anchors");
  add("re-anchor quorum of 2", {
    fixes: relocate(60, 3, 400),
    opts: { reanchorCount: 2 },
  });
  add("re-anchor quorum of 5", {
    fixes: relocate(60, 8, 400),
    opts: { reanchorCount: 5 },
  });
  add("re-anchor quorum of 1 accepts any jump at once", {
    fixes: relocate(60, 1, 400),
    opts: { reanchorCount: 1 },
  });
  add("tight speed gate of 4 m/s rejects a hard sprint, later relocates", {
    fixes: track({
      rng: new Rng(720004),
      legs: [{ sec: 40, speed: 3 }, { sec: 40, speed: 6 }, {
        sec: 40,
        speed: 3,
      }],
      noiseM: 0.8,
      acc: 3,
    }),
    opts: { speedGateMps: 4 },
  });
  add("loose speed gate of 20 m/s accepts a 100 m hop", {
    fixes: relocate(60, 1, 100),
    opts: { speedGateMps: 20 },
  });
  add("a 60 s gap with no fixes, then the run goes on", {
    fixes: [
      ...runJ.slice(0, 80),
      ...runJ.slice(140).map((f) => f),
    ],
  });
  // After a tunnel the next fix is 150 m on, 30 s later: 5 m/s, accepted.
  add("a plausible jump after a long gap is accepted", {
    fixes: [
      { t: 0, lat: 47.6, lon: -122.3, acc: 5 },
      { t: 1, lat: 47.600027, lon: -122.3, acc: 5 },
      { t: 31, lat: 47.601375, lon: -122.3, acc: 5 },
      { t: 32, lat: 47.601402, lon: -122.3, acc: 5 },
    ],
  });
  add("pending jump fixes do not agree with each other", {
    fixes: [
      ...lineFixes({ count: 10, speedMps: 3 }),
      { t: 10, lat: 47.62, lon: -122.3321, acc: 5 },
      { t: 11, lat: 47.64, lon: -122.3321, acc: 5 },
      { t: 12, lat: 47.62, lon: -122.3321, acc: 5 },
      { t: 13, lat: 47.60, lon: -122.3321, acc: 5 },
      { t: 14, lat: 47.6064, lon: -122.3321, acc: 5 },
    ],
  });

  // ---- Kalman behaviour ----
  add("stationary fixes at one spot", {
    fixes: stopFixes({ count: 60, t0: 0, lat: 47.6, lon: -122.3 }),
  });
  add("stationary with GPS noise: speed stays near zero", {
    fixes: track({
      rng: new Rng(720005),
      legs: [{ sec: 120, speed: 0 }],
      noiseM: 2.5,
      acc: 5,
      accJitter: 5,
    }),
  });
  add("run, stop, run", {
    fixes: track({
      rng: new Rng(720006),
      legs: [
        { sec: 60, speed: 3.2 },
        { sec: 40, speed: 0 },
        { sec: 60, speed: 3.2, turn: 180 },
      ],
      noiseM: 1.2,
      acc: 3.5,
      accJitter: 2,
    }),
  });
  add("fractional sample interval of 0.37 s", {
    fixes: track({
      rng: new Rng(720007),
      legs: [{ sec: 40, speed: 4.1, turn: 60 }],
      dt: 0.37,
      noiseM: 1,
      acc: 4,
    }),
  });
  add("sparse samples every 5 s with jitter", {
    fixes: track({
      rng: new Rng(720008),
      legs: [{ sec: 400, speed: 3, turn: 200 }],
      dt: 5,
      dtJitter: 0.4,
      noiseM: 2,
      acc: 6,
      accJitter: 4,
    }),
  });
  add("Android style timestamps with six decimals", {
    fixes: track({
      rng: new Rng(720009),
      legs: [{ sec: 90, speed: 3.6 }],
      dtJitter: 0.05,
      tPlaces: 6,
      noiseM: 1.5,
      acc: 3,
      accJitter: 4,
    }),
  });
  add("south-west run in the southern hemisphere", {
    fixes: track({
      rng: new Rng(720010),
      legs: [{ sec: 100, speed: 3.4, turn: -45 }],
      lat: -33.8688,
      lon: 151.2093,
      heading: 225,
      noiseM: 1.5,
      acc: 4,
    }),
  });
  add("run near the pole", {
    fixes: track({
      rng: new Rng(720011),
      legs: [{ sec: 100, speed: 3, turn: 50 }],
      lat: 84.5,
      lon: 40,
      noiseM: 1,
      acc: 4,
    }),
  });
  add("run across the antimeridian", {
    fixes: track({
      rng: new Rng(720012),
      legs: [{ sec: 80, speed: 3.5 }],
      lat: 10,
      lon: 179.9995,
      heading: 90,
      noiseM: 0.5,
      acc: 3,
    }).map((f) => ({ ...f, lon: f.lon > 180 ? f.lon - 360 : f.lon })),
  });
  add("optional fields are carried through", {
    fixes: track({
      rng: new Rng(720013),
      legs: [{ sec: 60, speed: 3 }],
      noiseM: 1,
      acc: 4,
      hr: 150,
      hrMissing: 0.3,
    }).map((f, i) => ({
      ...f,
      ...(i % 3 === 0 ? { cad: 160 + (i % 9) } : {}),
      ...(i % 4 === 0 ? { ele: 30 + i * 0.1 } : {}),
    })),
  });
  add("accel noise 0.3", {
    fixes: runJ.slice(0, 100),
    opts: { accelNoise: 0.3 },
  });
  add("accel noise 6", {
    fixes: runJ.slice(0, 100),
    opts: { accelNoise: 6 },
  });
  add("accel noise zero", {
    fixes: runJ.slice(0, 100),
    opts: { accelNoise: 0 },
  });

  // ---- non-finite and missing fields: dropped, never an error in TS ----
  const clean = lineFixes({ count: 30, speedMps: 3 });
  const broken: [string, (f: Fix, i: number) => Record<string, unknown>][] = [
    ["NaN timestamp", (f, i) => i === 10 ? { ...f, t: NaN } : f],
    ["infinite timestamp", (f, i) => i === 10 ? { ...f, t: Infinity } : f],
    ["NaN latitude", (f, i) => i === 10 ? { ...f, lat: NaN } : f],
    ["infinite longitude", (f, i) => i === 10 ? { ...f, lon: -Infinity } : f],
    ["NaN accuracy", (f, i) => i === 10 ? { ...f, acc: NaN } : f],
    ["infinite accuracy", (f, i) => i === 10 ? { ...f, acc: Infinity } : f],
    ["missing timestamp", (f, i) => {
      if (i !== 10) return f;
      const { t: _t, ...rest } = f;
      return rest;
    }],
    ["missing latitude", (f, i) => {
      if (i !== 10) return f;
      const { lat: _l, ...rest } = f;
      return rest;
    }],
    ["missing longitude", (f, i) => {
      if (i !== 10) return f;
      const { lon: _l, ...rest } = f;
      return rest;
    }],
    ["missing accuracy", (f, i) => {
      if (i !== 10) return f;
      const { acc: _a, ...rest } = f;
      return rest;
    }],
  ];
  for (const [name, fn] of broken) {
    add(`nonfinite: ${name} is dropped`, {
      fixes: clean.map(fn) as unknown as Fix[],
    });
  }
  add("nonfinite: a NaN first fix never anchors", {
    fixes: clean.map((f, i) => i === 0 ? { ...f, lat: NaN } : f),
  });
  add("nonfinite: optional fields that are NaN are carried through", {
    fixes: clean.map((f, i) =>
      i === 5 ? { ...f, hr: NaN, cad: Infinity, ele: -Infinity } : f
    ),
  });
  add("nonfinite: infinite options", {
    fixes: clean,
    opts: { accuracyGateM: Infinity, speedGateMps: Infinity },
  });
  add("nonfinite: NaN accuracy gate drops everything", {
    fixes: clean,
    opts: { accuracyGateM: NaN },
  });
  add("nonfinite: NaN speed gate rejects every second fix", {
    fixes: clean,
    opts: { speedGateMps: NaN },
  });

  emit("filter", cs);
}

// ---------------------------------------------------------------------------
// autopause.json
// ---------------------------------------------------------------------------

interface SpeedPt {
  t: number;
  speedMps: number;
}

function hold(speed: number, from: number, count: number, dt = 1): SpeedPt[] {
  const out: SpeedPt[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ t: from + i * dt, speedMps: speed });
  }
  return out;
}

function runMachine(a: { points: SpeedPt[]; opts?: AutoPauseOptions }) {
  const m = new AutoPause(a.opts ?? {});
  const states: string[] = [];
  const open: (number | null)[] = [];
  const closed: number[] = [];
  for (const p of a.points) {
    states.push(m.update(p.t, p.speedMps));
    open.push(m.openPauseStart);
    closed.push(m.intervals.length);
  }
  const finished = m.finish().map((i) => ({ ...i }));
  return { states, open, closed, finished };
}

function genAutopause(): void {
  const cs: GoldenCase[] = [];
  type A = { points: SpeedPt[]; opts?: AutoPauseOptions };
  const all = (name: string, a: A) => {
    cs.push(
      fcase(
        "computePauses",
        name,
        a,
        (x: A) => computePauses(x.points, x.opts),
      ),
    );
    cs.push(
      fcase(
        "causalClockTrace",
        name,
        a,
        (x: A) => causalClockTrace(x.points, x.opts),
      ),
    );
    cs.push(fcase("autoPauseMachine", name, a, runMachine));
  };

  // ported from autopause_test.ts
  all("60 s stop mid-run pauses once", {
    points: [...hold(3, 0, 60), ...hold(0, 60, 60), ...hold(3, 120, 61)],
  });
  all("a 3 s dip never pauses; resume needs 3 s above 1.0", {
    points: [...hold(3, 0, 30), ...hold(0, 30, 3), ...hold(3, 33, 30)],
  });
  all("run ending mid-pause closes the interval at the last fix", {
    points: [...hold(3, 0, 30), ...hold(0, 30, 30)],
  });

  // empty and short
  all("empty", { points: [] });
  all("one sample", { points: hold(3, 0, 1) });
  all("one still sample", { points: hold(0, 0, 1) });
  all("two samples", { points: hold(3, 0, 2) });
  all("never moves", { points: hold(0, 0, 40) });
  all("never moves, three samples", { points: hold(0, 10, 3) });

  // exact gates: below 0.6 pauses, 0.6 itself does not; above 1.0 resumes, 1.0 does not
  all("speed exactly 0.6 never starts the low timer", {
    points: [...hold(3, 0, 10), ...hold(0.6, 10, 30), ...hold(3, 40, 10)],
  });
  all("speed a hair under 0.6 pauses", {
    points: [
      ...hold(3, 0, 10),
      ...hold(0.5999999999999999, 10, 30),
      ...hold(3, 40, 10),
    ],
  });
  all("speed exactly 1.0 never resumes", {
    points: [...hold(3, 0, 10), ...hold(0, 10, 20), ...hold(1.0, 30, 30)],
  });
  all("speed a hair over 1.0 resumes", {
    points: [
      ...hold(3, 0, 10),
      ...hold(0, 10, 20),
      ...hold(1.0000000000000002, 30, 30),
    ],
  });
  all("hold times exactly at the threshold: 5 s still, 3 s moving", {
    points: [...hold(3, 0, 10), ...hold(0, 10, 6), ...hold(3, 16, 4)],
  });
  all("hold time one sample short of the threshold", {
    points: [...hold(3, 0, 10), ...hold(0, 10, 5), ...hold(3, 15, 10)],
  });
  all("a dip back above 0.6 resets the low timer", {
    points: [
      ...hold(3, 0, 10),
      ...hold(0, 10, 4),
      ...hold(0.8, 14, 1),
      ...hold(0, 15, 4),
      ...hold(3, 19, 10),
    ],
  });
  all("a dip back under 1.0 resets the resume timer", {
    points: [
      ...hold(3, 0, 10),
      ...hold(0, 10, 10),
      ...hold(3, 20, 2),
      ...hold(0.9, 22, 1),
      ...hold(3, 23, 2),
      ...hold(0.9, 25, 1),
      ...hold(3, 26, 10),
    ],
  });
  all("several stops", {
    points: [
      ...hold(3, 0, 20),
      ...hold(0, 20, 15),
      ...hold(3, 35, 20),
      ...hold(0.2, 55, 30),
      ...hold(3, 85, 20),
      ...hold(0, 105, 8),
    ],
  });
  all("sample times with fractions and gaps", {
    points: [
      ...hold(3, 0.25, 12, 0.25),
      ...hold(0.1, 3.25, 40, 0.25),
      { t: 40, speedMps: 0.1 },
      { t: 55.5, speedMps: 3 },
      { t: 57.1, speedMps: 3 },
      { t: 59, speedMps: 3 },
      { t: 60.2, speedMps: 3 },
    ],
  });
  all("time-spaced pauses of 0.1 s steps (rounding ties)", {
    points: [
      ...hold(3, 0, 20, 0.1),
      ...hold(0, 2, 70, 0.1),
      ...hold(3, 9, 40, 0.1),
    ],
  });

  // options
  const opts: AutoPauseOptions[] = [
    { lowMps: 0.8 },
    { lowHoldSec: 2 },
    { highMps: 1.5, highHoldSec: 1 },
    { lowMps: 0.3, lowHoldSec: 10, highMps: 0.5, highHoldSec: 6 },
    { lowHoldSec: 0, highHoldSec: 0 },
  ];
  const stops: SpeedPt[] = [
    ...hold(3, 0, 20),
    ...hold(0.4, 20, 15),
    ...hold(1.2, 35, 10),
    ...hold(0.7, 45, 12),
    ...hold(3, 57, 20),
  ];
  for (const o of opts) {
    all(`options ${JSON.stringify(o)}`, { points: stops, opts: o });
  }

  // seeded noisy speed series: a run with stops
  const rng = new Rng(730001);
  for (let k = 0; k < 4; k++) {
    const pts: SpeedPt[] = [];
    let t = 0;
    let v = 3;
    for (let i = 0; i < 400; i++) {
      t += rng.pick([1, 1, 1, 2, 0.5]);
      if (rng.chance(0.03)) v = rng.pick([0, 0.2, 3, 3.5, 0.9, 1.2]);
      pts.push({ t, speedMps: Math.max(0, v + gauss(rng) * 0.25) });
    }
    all(`seeded noisy speed series ${k}`, { points: pts });
  }

  // non-finite
  all("nonfinite: a NaN speed counts as not below 0.6 and not above 1.0", {
    points: [...hold(3, 0, 10), { t: 10, speedMps: NaN }, ...hold(0, 11, 20)],
  });
  all("nonfinite: infinite speed", {
    points: [
      ...hold(0, 0, 10),
      { t: 10, speedMps: Infinity },
      ...hold(3, 11, 5),
    ],
  });

  // pausedOverlap and movingElapsedAt
  const iv = [{ startT: 10, endT: 20 }, { startT: 30, endT: 45 }, {
    startT: 60,
    endT: 61,
  }];
  for (
    const [from, to] of [
      [0, 100],
      [15, 40],
      [10, 20],
      [20, 30],
      [-5, 5],
      [50, 70],
      [100, 0],
      [12, 12],
      [0, 61],
    ]
  ) {
    cs.push(
      fcase("pausedOverlap", `[${from}, ${to}]`, {
        intervals: iv,
        fromT: from,
        toT: to,
      }, (a) => pausedOverlap(a.intervals, a.fromT, a.toT)),
    );
    cs.push(
      fcase("movingElapsedAt", `[${from}, ${to}]`, {
        intervals: iv,
        fromT: from,
        toT: to,
      }, (a) => movingElapsedAt(a.intervals, a.fromT, a.toT)),
    );
  }
  cs.push(
    fcase(
      "pausedOverlap",
      "no intervals",
      { intervals: [], fromT: 0, toT: 10 },
      (a) => pausedOverlap(a.intervals, a.fromT, a.toT),
    ),
  );
  cs.push(
    fcase("pausedOverlap", "nonfinite: NaN bound", {
      intervals: iv,
      fromT: NaN,
      toT: 50,
    }, (a) => pausedOverlap(a.intervals, a.fromT, a.toT)),
  );

  const m = cs.find((c) =>
    c.name === "60 s stop mid-run pauses once" &&
    (c.input as { fn: string }).fn === "computePauses"
  );
  must((m!.expected as { paused: unknown[] }).paused.length === 1, "one pause");
  emit("autopause", cs);
}

// ---------------------------------------------------------------------------
// splits.json
// ---------------------------------------------------------------------------

interface SplitPt {
  t: number;
  distM: number;
  hr?: number;
}

function genSplits(): void {
  const cs: GoldenCase[] = [];
  const add = (name: string, points: SplitPt[], opts?: SplitOptions) =>
    cs.push(
      mk(
        name,
        { points, opts },
        (i: { points: SplitPt[]; opts?: SplitOptions }) =>
          computeSplits(i.points, i.opts),
      ),
    );
  const strip = (pts: FilteredPoint[]): SplitPt[] =>
    pts.map((p) => ({
      t: p.t,
      distM: p.distM,
      ...(p.hr !== undefined ? { hr: p.hr } : {}),
    }));

  // ported from splits_test.ts
  add(
    "two miles at 3 m/s",
    strip(filterFixes(lineFixes({ count: 1100, speedMps: 3 }))),
  );
  add(
    "crossings interpolate between sparse fixes",
    strip(filterFixes(lineFixes({ count: 120, speedMps: 3, dt: 10 }))),
  );
  const l1300 = strip(filterFixes(lineFixes({ count: 1300, speedMps: 3 })));
  add(
    "split unit is configurable (km), partial trailing split included",
    l1300,
    { splitM: KM_M },
  );
  add("no points, no splits", []);

  // exact arithmetic series
  const steady = (n: number, speed: number, dt = 1, t0 = 0): SplitPt[] =>
    Array.from(
      { length: n },
      (_, i) => ({ t: t0 + i * dt, distM: i * dt * speed }),
    );
  add("points exactly on the boundaries", steady(41, 100, 1), { splitM: 1000 });
  add("last point exactly on a boundary", steady(21, 100, 1), { splitM: 1000 });
  add(
    "one point on a boundary, rest of the run short of the minimum",
    steady(11, 100, 1),
    { splitM: 1000, minPartialM: 5 },
  );
  add("one point", steady(1, 3));
  add("two points under one split", steady(2, 3));
  add("two points, one split", [{ t: 0, distM: 0 }, { t: 600, distM: 2000 }], {
    splitM: 1000,
  });
  add("a long gap in time straddles two boundaries", [
    { t: 0, distM: 0 },
    { t: 10, distM: 400 },
    { t: 400, distM: 2600 },
    { t: 410, distM: 2650 },
  ], { splitM: 1000 });
  add("a stationary stretch exactly on a boundary", [
    { t: 0, distM: 0 },
    { t: 100, distM: 1000 },
    { t: 200, distM: 1000 },
    { t: 300, distM: 1000 },
    { t: 400, distM: 1500 },
  ], { splitM: 1000 });
  add("distance never moves", steady(50, 0));
  add(
    "trailing partial under the default minimum of 1 m",
    steady(11, 99.9, 1),
    { splitM: 1000 },
  );
  add("trailing partial exactly 1 m", [{ t: 0, distM: 0 }, {
    t: 10,
    distM: 1000,
  }, { t: 11, distM: 1001 }], { splitM: 1000 });
  add("minPartialM 0 keeps an empty tail", [{ t: 0, distM: 0 }, {
    t: 10,
    distM: 1000,
  }, { t: 11, distM: 1000 }], { splitM: 1000, minPartialM: 0 });
  add("minPartialM large drops the tail", steady(31, 100, 1), {
    splitM: 1000,
    minPartialM: 1000,
  });
  add("split unit of 400 m", steady(91, 4.4, 1), { splitM: 400 });
  add("split unit of 0.5 mile", steady(701, 3, 1), { splitM: MILE_M / 2 });
  add("fractional timestamps", steady(300, 3.3, 0.37, 12.5), { splitM: 100 });

  // HR
  const hrRng = new Rng(740001);
  const withHr = steady(900, 3.3).map((p, i) => ({
    ...p,
    ...(hrRng.chance(0.85)
      ? { hr: Math.round(140 + 20 * Math.sin(i / 60) + hrRng.float(-3, 3)) }
      : {}),
  }));
  add("hr averaged per split, some samples missing", withHr, { splitM: 1000 });
  add(
    "hr only in the trailing partial",
    steady(400, 3.3).map((p, i) => i > 350 ? { ...p, hr: 150 + (i % 7) } : p),
    { splitM: 1000 },
  );
  add("hr only on the boundary-crossing sample", [
    { t: 0, distM: 0 },
    { t: 100, distM: 500 },
    { t: 200, distM: 1100, hr: 161 },
    { t: 300, distM: 1400 },
  ], { splitM: 1000 });
  add(
    "hr on every point, mile splits",
    steady(1500, 3.2).map((p, i) => ({ ...p, hr: 120 + (i % 50) })),
  );
  add(
    "fractional hr",
    steady(500, 3).map((p, i) => ({ ...p, hr: 120.5 + i * 0.1 })),
    { splitM: 500 },
  );

  // degenerate options
  const tenK = steady(1000, 3);
  add("splitM 0 gives nothing", tenK, { splitM: 0 });
  add("splitM negative gives nothing", tenK, { splitM: -1000 });
  add("nonfinite: splitM NaN gives nothing", tenK, { splitM: NaN });
  add("nonfinite: splitM Infinity gives one partial", tenK, {
    splitM: Infinity,
  });
  add("nonfinite: minPartialM NaN drops the tail", steady(31, 100, 1), {
    splitM: 1000,
    minPartialM: NaN,
  });
  add("splitM 1 m", steady(21, 3, 1), { splitM: 1 });

  // from the real pipeline: noisy run, stops, km and mile splits
  const rng = new Rng(740002);
  const pts = strip(filterFixes(track({
    rng,
    legs: [
      { sec: 400, speed: 3.4, turn: 90 },
      { sec: 60, speed: 0 },
      { sec: 500, speed: 3.9, turn: -60 },
    ],
    noiseM: 1.3,
    acc: 4,
    accJitter: 3,
    hr: 150,
    hrMissing: 0.1,
  })));
  add("filtered noisy run with a stop, mile splits", pts);
  add("same run, 1 km splits", pts, { splitM: 1000 });
  add("same run, 200 m splits", pts, { splitM: 200 });

  must((cs[0].expected as unknown[]).length === 3, "two miles and a tail");
  emit("splits", cs);
}

// ---------------------------------------------------------------------------
// pace.json
// ---------------------------------------------------------------------------

interface PacePt {
  t: number;
  distM: number;
}

function genPace(): void {
  const cs: GoldenCase[] = [];
  const steady = (n: number, speed: number, dt = 1, t0 = 0): PacePt[] =>
    Array.from(
      { length: n },
      (_, i) => ({ t: t0 + i * dt, distM: i * dt * speed }),
    );

  const winAll = (
    name: string,
    points: PacePt[],
    nows: (number | undefined)[],
  ) => {
    cs.push(
      fcase(
        "currentPace",
        `${name}, default now`,
        { points },
        (a: { points: PacePt[] }) => currentPace(a.points),
      ),
    );
    cs.push(
      fcase(
        "cuePace",
        `${name}, default now`,
        { points },
        (a: { points: PacePt[] }) => cuePace(a.points),
      ),
    );
    for (const nowT of nows) {
      if (nowT === undefined) continue;
      const args = { points, nowT };
      cs.push(
        fcase(
          "currentPace",
          `${name}, now ${nowT}`,
          args,
          (a: typeof args) => currentPace(a.points, a.nowT),
        ),
      );
      cs.push(
        fcase(
          "cuePace",
          `${name}, now ${nowT}`,
          args,
          (a: typeof args) => cuePace(a.points, a.nowT),
        ),
      );
      for (const windowSec of [10, 20, 30, 60]) {
        const w = { points, nowT, windowSec };
        cs.push(
          fcase(
            "windowSpeed",
            `${name}, now ${nowT}, window ${windowSec}`,
            w,
            (a: typeof w) => windowSpeed(a.points, a.nowT, a.windowSec),
          ),
        );
      }
    }
  };

  // ported from pace_test.ts: a steady run reads out the same pace in each window
  const pts121 = filterFixes(lineFixes({ count: 121, speedMps: 3 })).map((
    p,
  ) => ({ t: p.t, distM: p.distM }));
  winAll("steady filtered run", pts121, [60, 120]);
  cs.push(
    fcase(
      "averagePace",
      "300 m over 100 s",
      { distanceM: 300, movingSec: 100 },
      (a) => averagePace(a.distanceM, a.movingSec),
    ),
  );
  cs.push(
    fcase("averagePace", "filtered steady run over 120 s", {
      distanceM: pts121[120].distM,
      movingSec: 120,
    }, (a) => averagePace(a.distanceM, a.movingSec)),
  );
  const fixes = lineFixes({ count: 120, speedMps: 2.8 });
  const onTime = filterFixes(fixes).map((p) => ({ t: p.t, distM: p.distM }));
  winAll("on-time 2.8 m/s", onTime, [59, 119]);
  cs.push(
    fcase("windowSpeed", "a window ignores the future (first 60 points)", {
      points: onTime.slice(0, 60),
      nowT: 59,
      windowSec: 20,
    }, (a) => windowSpeed(a.points, a.nowT, a.windowSec)),
  );
  cs.push(
    fcase("windowSpeed", "a window ignores the future (all points)", {
      points: onTime,
      nowT: 59,
      windowSec: 20,
    }, (a) => windowSpeed(a.points, a.nowT, a.windowSec)),
  );

  // averagePace corners
  for (
    const [d, m] of [[300, 0], [0, 100], [-5, 100], [300, -1], [1e6, 1e-9], [
      100,
      3,
    ], [5, 1e6]]
  ) {
    cs.push(
      fcase("averagePace", `distance ${d}, moving ${m}`, {
        distanceM: d,
        movingSec: m,
      }, (a) => averagePace(a.distanceM, a.movingSec)),
    );
  }
  cs.push(
    fcase("averagePace", "nonfinite: NaN distance", {
      distanceM: NaN,
      movingSec: 10,
    }, (a) => averagePace(a.distanceM, a.movingSec)),
  );
  cs.push(
    fcase("averagePace", "nonfinite: infinite distance", {
      distanceM: Infinity,
      movingSec: 10,
    }, (a) => averagePace(a.distanceM, a.movingSec)),
  );
  cs.push(
    fcase("averagePace", "nonfinite: NaN time", {
      distanceM: 10,
      movingSec: NaN,
    }, (a) => averagePace(a.distanceM, a.movingSec)),
  );

  // empty, one, two points; short spans around the 5 s minimum
  winAll("empty", [], [10]);
  winAll("one point", steady(1, 3), [0, 10]);
  winAll("two points 5 s apart (span exactly the minimum)", steady(2, 3, 5), [
    5,
    8,
  ]);
  winAll("two points just under 5 s apart", steady(2, 3, 4.999), [4.999]);
  winAll("five seconds of 1 Hz points", steady(6, 3), [5, 4.9]);
  winAll("a stopped run (no distance)", steady(60, 0), [30, 59]);
  winAll("a run that starts late", steady(60, 3, 1, 1000), [
    1030,
    1059,
    900,
    2000,
  ]);
  winAll(
    "accelerating run",
    Array.from({ length: 100 }, (_, i) => ({ t: i, distM: 0.02 * i * i })),
    [20, 50, 99],
  );
  winAll("stop in the middle", [
    ...steady(30, 3),
    ...Array.from({ length: 30 }, (_, i) => ({ t: 30 + i, distM: 87 })),
    ...Array.from({ length: 30 }, (_, i) => ({ t: 60 + i, distM: 87 + i * 3 })),
  ], [45, 59, 89]);
  winAll("sparse samples every 7 s", steady(30, 3, 7), [100, 203, 50.5]);
  winAll("duplicate timestamps (zero-length segment)", [
    { t: 0, distM: 0 },
    { t: 10, distM: 30 },
    { t: 10, distM: 30 },
    { t: 20, distM: 60 },
    { t: 30, distM: 90 },
  ], [10, 25, 30]);
  winAll("distance going backwards", [
    { t: 0, distM: 100 },
    { t: 10, distM: 90 },
    { t: 20, distM: 80 },
    { t: 30, distM: 70 },
  ], [20, 30]);
  winAll("nonfinite: NaN in the middle of the track", [
    { t: 0, distM: 0 },
    { t: 10, distM: NaN },
    { t: 20, distM: 60 },
    { t: 30, distM: 90 },
  ], [20, 30]);
  winAll("nonfinite: NaN now", steady(60, 3), [NaN]);
  winAll("nonfinite: infinite now", steady(60, 3), [Infinity, -Infinity]);
  cs.push(
    fcase("windowSpeed", "nonfinite: NaN window", {
      points: steady(60, 3),
      nowT: 59,
      windowSec: NaN,
    }, (a) => windowSpeed(a.points, a.nowT, a.windowSec)),
  );
  cs.push(
    fcase("windowSpeed", "window of zero", {
      points: steady(60, 3),
      nowT: 59,
      windowSec: 0,
    }, (a) => windowSpeed(a.points, a.nowT, a.windowSec)),
  );
  cs.push(
    fcase("windowSpeed", "negative window", {
      points: steady(60, 3),
      nowT: 59,
      windowSec: -5,
    }, (a) => windowSpeed(a.points, a.nowT, a.windowSec)),
  );
  cs.push(
    fcase("windowSpeed", "huge window", {
      points: steady(60, 3),
      nowT: 59,
      windowSec: 1e9,
    }, (a) => windowSpeed(a.points, a.nowT, a.windowSec)),
  );

  // distAt
  const da = steady(11, 2);
  for (const t of [-5, 0, 0.3, 2.5, 5, 9.999, 10, 100]) {
    cs.push(
      fcase(
        "distAt",
        `t ${t}`,
        { points: da, t },
        (a: { points: PacePt[]; t: number }) => distAt(a.points, a.t),
      ),
    );
  }
  cs.push(
    fcase(
      "distAt",
      "empty",
      { points: [], t: 3 },
      (a: { points: PacePt[]; t: number }) => distAt(a.points, a.t),
    ),
  );
  cs.push(
    fcase(
      "distAt",
      "one point",
      { points: da.slice(0, 1), t: 3 },
      (a: { points: PacePt[]; t: number }) => distAt(a.points, a.t),
    ),
  );
  cs.push(
    fcase("distAt", "zero-length segment", {
      points: [{ t: 0, distM: 0 }, { t: 5, distM: 10 }, { t: 5, distM: 12 }, {
        t: 9,
        distM: 20,
      }],
      t: 5,
    }, (a: { points: PacePt[]; t: number }) => distAt(a.points, a.t)),
  );
  cs.push(
    fcase(
      "distAt",
      "nonfinite: NaN time",
      { points: da, t: NaN },
      (a: { points: PacePt[]; t: number }) => distAt(a.points, a.t),
    ),
  );
  // One long track queried at many times (a single case keeps the file small).
  const big = Array.from(
    { length: 2000 },
    (_, i) => ({ t: i * 1.3, distM: i * 3.7 + (i % 5) * 0.1 }),
  );
  const rng = new Rng(750001);
  const ts = Array.from({ length: 40 }, () => rng.float(-10, 2700));
  cs.push(
    fcase(
      "distAtMany",
      "2000 points, 40 random times",
      { points: big, ts },
      (a: { points: PacePt[]; ts: number[] }) =>
        a.ts.map((t) => distAt(a.points, t)),
    ),
  );

  must(
    cs.some((c) => (c.expected as unknown) === null),
    "some paces read null",
  );
  must(
    cs.some((c) =>
      (c.expected as { speedMps?: number } | null)?.speedMps !== undefined
    ),
    "some paces read out",
  );
  emit("pace", cs);
}

// ---------------------------------------------------------------------------
// guided.json
// ---------------------------------------------------------------------------

interface UpdateOp {
  update: { cueSpeedMps: number | null; distM: number; timeSec: number };
}
interface AdvanceOp {
  advance: { distM: number; timeSec: number };
}
type GuidedOp = UpdateOp | AdvanceOp;

function runGuided(
  a: { workout: RunWorkout; opts?: GuidedOptions; ops: GuidedOp[] },
) {
  const g = new GuidedRun(a.workout, a.opts);
  const events: unknown[][] = [];
  for (const op of a.ops) {
    events.push(
      "update" in op
        ? g.update(op.update)
        : g.advance(op.advance.distM, op.advance.timeSec),
    );
  }
  return {
    events,
    summaries: g.stepSummaries,
    currentStepIndex: g.currentStepIndex,
    complete: g.complete,
  };
}

function genGuided(): void {
  const cs: GoldenCase[] = [];
  const add = (
    name: string,
    workout: RunWorkout,
    ops: GuidedOp[],
    opts?: GuidedOptions,
  ) => {
    const c = fcase("guidedRun", name, { workout, opts, ops }, runGuided);
    cs.push(c);
    return c;
  };
  const upd = (
    cueSpeedMps: number | null,
    distM: number,
    timeSec: number,
  ): UpdateOp => ({
    update: { cueSpeedMps, distM, timeSec },
  });
  /** Second by second at one speed from a starting state; returns the ops and the end state. */
  const drive = (
    seconds: number,
    speed: number,
    from: { dist: number; time: number },
    cue: number | null = speed,
  ) => {
    const ops: GuidedOp[] = [];
    let { dist, time } = from;
    for (let i = 0; i < seconds; i++) {
      dist += speed;
      time += 1;
      ops.push(upd(cue, dist, time));
    }
    return { ops, end: { dist, time } };
  };

  const INTERVALS: RunWorkout = {
    type: "intervals",
    steps: [
      { kind: "warmup", seconds: 60 },
      { kind: "work", seconds: 120, paceLoMps: 2.9, paceHiMps: 3.1 },
      { kind: "recover", seconds: 60 },
      { kind: "work", seconds: 120, paceLoMps: 2.9, paceHiMps: 3.1 },
      { kind: "recover", seconds: 60 },
      { kind: "cooldown" },
    ],
  };

  // ported: on-pace intervals step through with no nagging
  {
    const d = drive(600, 3, { dist: 0, time: 0 });
    add("on-pace intervals step through with no nagging", INTERVALS, [
      ...d.ops,
      { advance: { distM: d.end.dist, timeSec: d.end.time } },
    ]);
    const last = cs[cs.length - 1].expected as {
      complete: boolean;
      summaries: unknown[];
    };
    must(
      last.complete && last.summaries.length === 6,
      "workout completes by advance",
    );
  }
  // ported: slow work pace prompts speedUp, rate-limited, then backInZone
  {
    const a = drive(61, 3, { dist: 0, time: 0 });
    const b = drive(60, 2.5, a.end);
    const c = drive(60, 3, b.end);
    add(
      "slow work pace prompts speedUp, rate-limited, then backInZone",
      INTERVALS,
      [...a.ops, ...b.ops, ...c.ops],
      { promptCooldownSec: 45 },
    );
    const flat =
      (cs[cs.length - 1].expected as { events: { type: string }[][] }).events
        .flat();
    must(
      flat.some((e) => e.type === "speedUp") &&
        flat.some((e) => e.type === "backInZone"),
      "speedUp then backInZone",
    );
  }
  // ported: hysteresis and repeats
  {
    const w: RunWorkout = {
      type: "intervals",
      steps: [{ kind: "work", seconds: 60, targetMps: 3 }],
    };
    const ops: GuidedOp[] = [upd(3, 0, 0)];
    for (let i = 1; i <= 30; i++) ops.push(upd(2.85, i * 2.85, i));
    add("hysteresis: edge pace does not flap", w, ops, { toleranceMps: 0.1 });
  }
  for (
    const [name, wo] of [
      ["repeat expands to 3 steps", {
        type: "intervals",
        steps: [{ kind: "work", seconds: 60, repeat: 3 }],
      }],
      ["no-repeat steps expand to 1", INTERVALS],
      ["repeat 0 runs once", {
        type: "intervals",
        steps: [{ kind: "work", seconds: 60, repeat: 0 }],
      }],
      ["repeat negative runs once", {
        type: "intervals",
        steps: [{ kind: "work", repeat: -3 }],
      }],
      ["repeat 2.9 floors to 2", {
        type: "intervals",
        steps: [{ kind: "work", repeat: 2.9 }, {
          kind: "recover",
          repeat: 1.2,
        }],
      }],
      ["no steps", { type: "easy", steps: [] }],
      ["nonfinite: repeat NaN expands to none", {
        type: "easy",
        steps: [{ kind: "work", repeat: NaN }, { kind: "recover" }],
      }],
      ["step fields are carried", {
        type: "tempo",
        name: "x",
        steps: [{
          kind: "work",
          distanceM: 1000,
          seconds: 300,
          targetMps: 3.3,
          paceLoMps: 3.1,
          paceHiMps: 3.5,
          hrZone: 4,
          repeat: 2,
        }],
      }],
    ] as [string, RunWorkout][]
  ) {
    cs.push(
      fcase(
        "expandWorkout",
        name,
        { workout: wo },
        (a: { workout: RunWorkout }) => expandWorkout(a.workout),
      ),
    );
  }

  // distance-based and mixed steps
  {
    const w: RunWorkout = {
      type: "intervals",
      steps: [
        { kind: "warmup", distanceM: 300 },
        { kind: "work", distanceM: 400, seconds: 100, targetMps: 4 },
        { kind: "recover", seconds: 30, distanceM: 1000 },
        { kind: "cooldown", distanceM: 200 },
      ],
    };
    const a = drive(110, 3, { dist: 0, time: 0 });
    const b = drive(120, 4.2, a.end);
    const c = drive(60, 2, b.end);
    add("distance and time steps, first of the two wins", w, [
      ...a.ops,
      ...b.ops,
      ...c.ops,
    ]);
  }
  // targetMps zone only, reversed lo/hi, partial zones
  {
    const mk1 = (step: Record<string, unknown>): RunWorkout => ({
      type: "tempo",
      steps: [{ kind: "work", seconds: 400, ...step } as never],
    });
    const profile: GuidedOp[] = [];
    let dist = 0;
    const speeds = [
      3.0,
      3.0,
      2.4,
      2.4,
      2.4,
      3.0,
      3.0,
      4.0,
      4.0,
      4.0,
      4.0,
      3.0,
      3.0,
      2.0,
      2.0,
      4.5,
      2.0,
    ];
    for (let i = 0; i < 400; i++) {
      const v = speeds[Math.floor(i / 25) % speeds.length];
      dist += v;
      profile.push(upd(v, dist, i));
    }
    const band = add(
      "targetMps gives a band of tolerance either side",
      mk1({ targetMps: 3 }),
      profile,
    );
    add(
      "pace zone given high first (swapped)",
      mk1({ paceLoMps: 3.4, paceHiMps: 2.8 }),
      profile,
    );
    add(
      "only one edge given: no zone, no prompts",
      mk1({ paceLoMps: 2.8 }),
      profile,
    );
    add(
      "zone and target: the zone wins",
      mk1({ targetMps: 5, paceLoMps: 2.8, paceHiMps: 3.2 }),
      profile,
    );
    add("tolerance 0", mk1({ paceLoMps: 2.8, paceHiMps: 3.2 }), profile, {
      toleranceMps: 0,
    });
    add("wide tolerance", mk1({ paceLoMps: 2.8, paceHiMps: 3.2 }), profile, {
      toleranceMps: 1,
    });
    add(
      "cooldown 0 prompts at every change",
      mk1({ paceLoMps: 2.8, paceHiMps: 3.2 }),
      profile,
      { promptCooldownSec: 0 },
    );
    add(
      "cooldown 1000 prompts once",
      mk1({ paceLoMps: 2.8, paceHiMps: 3.2 }),
      profile,
      { promptCooldownSec: 1000 },
    );
    add(
      "no cue pace: no prompts",
      mk1({ paceLoMps: 2.8, paceHiMps: 3.2 }),
      profile.map((p) => ({
        update: { ...(p as UpdateOp).update, cueSpeedMps: null },
      })),
    );
    const flat = (band.expected as { events: { type: string }[][] }).events
      .flat();
    must(
      flat.some((e) => e.type === "slowDown") &&
        flat.some((e) => e.type === "speedUp"),
      "both prompts fire",
    );
  }
  // side flips while out of zone
  {
    const w: RunWorkout = {
      type: "tempo",
      steps: [{ kind: "work", seconds: 1000, paceLoMps: 3, paceHiMps: 3.2 }],
    };
    const ops: GuidedOp[] = [];
    const seq = [2.5, 2.5, 4, 4, 2.5, 3.1, 4, 4, 2.0, 2.0, 5, 5];
    for (let i = 0; i < 12 * 50; i++) {
      ops.push(upd(seq[Math.floor(i / 50)], i * 3, i));
    }
    add(
      "still out on the same side re-prompts; a flip is not announced directly",
      w,
      ops,
    );
  }
  // clock stepping back (the causal moving clock does this at a confirmed pause)
  {
    const w: RunWorkout = {
      type: "intervals",
      steps: [{ kind: "warmup", seconds: 32 }, { kind: "work", seconds: 5 }, {
        kind: "cooldown",
      }],
    };
    const ops: GuidedOp[] = [];
    for (let t = 0; t < 40; t++) ops.push(upd(null, t * 3, t));
    for (let t = 40; t < 60; t++) ops.push(upd(null, 117, 30)); // clock held after a step back
    for (let t = 60; t < 90; t++) {
      ops.push(upd(null, 117 + (t - 60) * 3, 30 + (t - 59)));
    }
    add("the clock steps back after a step ended: nothing restarts", w, ops);
    const evs = (cs[cs.length - 1].expected as { events: { type: string }[][] })
      .events.flat();
    must(evs.filter((e) => e.type === "stepEnd").length === 2, "two steps end");
  }
  // advance: open-ended steps, mid-run skip, after complete, before start
  {
    const w: RunWorkout = {
      type: "easy",
      steps: [{ kind: "work" }, { kind: "cooldown" }],
    };
    add("advance before any update", w, [
      { advance: { distM: 0, timeSec: 0 } },
      upd(null, 10, 5),
    ]);
    add("advance through open-ended steps", w, [
      upd(null, 10, 5),
      upd(3, 50, 20),
      { advance: { distM: 55, timeSec: 22 } },
      upd(3, 80, 30),
      { advance: { distM: 90, timeSec: 33 } },
      { advance: { distM: 95, timeSec: 35 } },
      upd(3, 100, 40),
    ]);
    add("advance skips a timed step", INTERVALS, [
      upd(3, 10, 5),
      { advance: { distM: 20, timeSec: 8 } },
      upd(3, 30, 10),
      upd(3, 400, 140),
    ]);
    add("the first update starts at a nonzero distance and time", INTERVALS, [
      upd(3, 5000, 900),
      upd(3, 5180, 960),
      upd(3, 5190, 961),
      upd(3, 5400, 1020),
    ]);
  }
  add("empty workout completes on the first update", {
    type: "easy",
    steps: [],
  }, [upd(3, 0, 0), upd(3, 5, 5), { advance: { distM: 5, timeSec: 5 } }]);
  add("empty workout, advance first", { type: "easy", steps: [] }, [{
    advance: { distM: 0, timeSec: 0 },
  }, upd(3, 0, 0)]);
  add("one step ends at once when its time is zero", {
    type: "easy",
    steps: [{ kind: "work", seconds: 0 }],
  }, [upd(3, 0, 0), upd(3, 5, 5)]);
  add("one step ends at once when its distance is zero", {
    type: "easy",
    steps: [{ kind: "work", distanceM: 0 }, { kind: "cooldown" }],
  }, [upd(3, 7, 3), upd(3, 9, 4)]);
  add("a step that ends on the first update", {
    type: "easy",
    steps: [{ kind: "work", seconds: 0 }, { kind: "work", seconds: 0 }, {
      kind: "cooldown",
    }],
  }, [upd(3, 0, 0), upd(3, 5, 5), upd(3, 8, 8)]);
  add("fractional clock and distance, end checks are >=", {
    type: "easy",
    steps: [{ kind: "work", seconds: 0.3, distanceM: 1e9 }, {
      kind: "cooldown",
      distanceM: 0.1,
    }],
  }, [upd(3, 0, 0.1), upd(3, 0.1, 0.2), upd(3, 0.2, 0.4), upd(3, 0.3, 0.5)]);

  // seeded random profiles through a full workout
  const rng = new Rng(760001);
  const W2: RunWorkout = {
    type: "intervals",
    steps: [
      { kind: "warmup", seconds: 120 },
      { kind: "work", seconds: 90, paceLoMps: 3.5, paceHiMps: 4.1, repeat: 3 },
      { kind: "recover", distanceM: 150, targetMps: 2.2 },
      { kind: "work", distanceM: 300, paceLoMps: 3.6, paceHiMps: 4.0 },
      { kind: "cooldown" },
    ],
  };
  for (let k = 0; k < 5; k++) {
    const ops: GuidedOp[] = [];
    let dist = 0;
    let time = 0;
    let v = 3;
    for (let i = 0; i < 700; i++) {
      if (rng.chance(0.04)) v = rng.pick([2, 2.6, 3.2, 3.8, 4.4, 5]);
      time += rng.pick([1, 1, 1, 2]);
      dist += v;
      ops.push(
        upd(rng.chance(0.05) ? null : v + rng.float(-0.15, 0.15), dist, time),
      );
      if (rng.chance(0.004)) {
        ops.push({ advance: { distM: dist, timeSec: time } });
      }
    }
    add(`seeded profile ${k} through a full workout`, W2, ops);
  }
  add(
    "nonfinite: NaN cue speed gives no prompts",
    INTERVALS,
    drive(100, 3, { dist: 0, time: 0 }, NaN).ops,
  );
  add(
    "nonfinite: infinite cue speed prompts slowDown",
    INTERVALS,
    drive(120, 3, { dist: 0, time: 0 }, Infinity).ops,
  );

  emit("guided", cs);
}

// ---------------------------------------------------------------------------
// process_run.json and process_run_2h.json
// ---------------------------------------------------------------------------

interface ProcessInput {
  fixes: Fix[];
  opts?: ProcessRunOptions;
}

/** processRun plus the guided clock at every point, which the TS result does not expose. */
function runProcess(i: ProcessInput) {
  const run = processRun(i.fixes, i.opts);
  return {
    ...run,
    clock: causalClockTrace(run.points, i.opts?.autopause),
  };
}

const WORKOUT_EASY: RunWorkout = {
  type: "tempo",
  steps: [
    { kind: "warmup", seconds: 300 },
    { kind: "work", seconds: 600, paceLoMps: 2.9, paceHiMps: 3.2 },
    { kind: "cooldown" },
  ],
};

function genProcessRun(): void {
  const cs: GoldenCase[] = [];
  const add = (name: string, fixes: Fix[], opts?: ProcessRunOptions) =>
    cs.push(mk(name, { fixes, opts }, runProcess));

  // ---- ported from pipeline_test.ts ----
  const leg1 = lineFixes({ count: 545, speedMps: 3 });
  const end1 = leg1[leg1.length - 1];
  const stop = stopFixes({ count: 30, t0: 545, lat: end1.lat, lon: end1.lon });
  const leg2 = lineFixes({
    count: 545,
    speedMps: 3,
    t0: 575,
    startLat: end1.lat,
  });
  add("pipeline: 2 miles with a stop, guided tempo", [
    ...leg1,
    ...stop,
    ...leg2,
  ], { workout: WORKOUT_EASY });
  {
    const e = cs[cs.length - 1].expected as {
      splits: unknown[];
      paused: unknown[];
      guidedEvents: { type: string }[];
    };
    must(
      e.splits.length >= 2 && e.paused.length === 1,
      "pipeline: splits and a pause",
    );
    must(
      e.guidedEvents.some((g) => g.type === "stepEnd"),
      "pipeline: a step ends",
    );
  }

  // ---- from autopause_test.ts: filtered stop ----
  const moving = lineFixes({ count: 60, speedMps: 3 });
  const last = moving[moving.length - 1];
  const stop2 = stopFixes({ count: 60, t0: 60, lat: last.lat, lon: last.lon });
  const more = lineFixes({
    count: 60,
    speedMps: 3,
    t0: 120,
    startLat: last.lat,
  });
  add("integration: filtered stop yields one pause", [
    ...moving,
    ...stop2,
    ...more,
  ]);

  // ---- from pace_test.ts ----
  add(
    "steady run: 20 s, 30 s and average pace agree",
    lineFixes({ count: 121, speedMps: 3 }),
  );
  add(
    "jara timestamps: on-time delivery",
    lineFixes({ count: 120, speedMps: 2.8 }),
  );
  // the batched delivery is the same fixes in the same order; the case above is its twin
  add("jara timestamps: three late batches (same input, same output)", [
    ...lineFixes({ count: 120, speedMps: 2.8 }).slice(0, 40),
    ...lineFixes({ count: 120, speedMps: 2.8 }).slice(40, 80),
    ...lineFixes({ count: 120, speedMps: 2.8 }).slice(80),
  ]);
  must(
    JSON.stringify(cs[cs.length - 1].expected) ===
      JSON.stringify(cs[cs.length - 2].expected),
    "batched equals on-time",
  );

  // ---- small and degenerate ----
  add("no fixes", []);
  add("no fixes, with a workout", [], { workout: WORKOUT_EASY });
  add("one fix", [{ t: 3, lat: 47.6, lon: -122.3, acc: 5 }]);
  add("one fix, with a workout", [{ t: 3, lat: 47.6, lon: -122.3, acc: 5 }], {
    workout: WORKOUT_EASY,
  });
  add("two fixes", lineFixes({ count: 2, speedMps: 3 }));
  add(
    "every fix dropped by the accuracy gate",
    lineFixes({ count: 30, speedMps: 3, acc: 90 }),
    { workout: WORKOUT_EASY },
  );
  add(
    "a run that never moves",
    stopFixes({ count: 120, t0: 0, lat: 47.6, lon: -122.3 }),
    {
      workout: {
        type: "easy",
        steps: [{ kind: "work", seconds: 20 }, { kind: "cooldown" }],
      },
    },
  );
  add("start with a stop, then run", [
    ...stopFixes({ count: 40, t0: 0, lat: 47.6, lon: -122.3 }),
    ...lineFixes({
      count: 80,
      speedMps: 3,
      t0: 40,
      startLat: 47.6,
      startLon: -122.3,
    }),
  ]);
  add("a stop at the very end", [
    ...lineFixes({ count: 60, speedMps: 3 }),
    ...stopFixes({
      count: 30,
      t0: 60,
      lat: lineFixes({ count: 60, speedMps: 3 })[59].lat,
      lon: -122.3321,
    }),
  ]);

  // ---- generated runs ----
  const rng = (n: number) => new Rng(770000 + n);
  add(
    "easy run, GPS noise and accuracy jitter, 20 minutes at 2 s",
    track({
      rng: rng(1),
      legs: [{ sec: 1200, speed: 2.9, turn: 120 }],
      dt: 2,
      dtJitter: 0.1,
      noiseM: 1.6,
      acc: 3.5,
      accJitter: 6,
      hr: 140,
      hrMissing: 0.05,
    }),
    { workout: WORKOUT_EASY },
  );
  add(
    "stoplights: three stops of 20, 8 and 45 s",
    track({
      rng: rng(2),
      legs: [
        { sec: 150, speed: 3.1 },
        { sec: 20, speed: 0 },
        { sec: 120, speed: 3.3, turn: 90 },
        { sec: 8, speed: 0 },
        { sec: 100, speed: 3.0, turn: -90 },
        { sec: 45, speed: 0 },
        { sec: 100, speed: 3.4 },
      ],
      dt: 1,
      noiseM: 1.2,
      acc: 4,
      accJitter: 3,
    }),
    {
      workout: {
        type: "easy",
        steps: [{ kind: "warmup", seconds: 100 }, {
          kind: "work",
          seconds: 200,
        }, { kind: "cooldown", seconds: 120 }],
      },
    },
  );
  add(
    "intervals with a pace zone and nags",
    track({
      rng: rng(3),
      legs: [
        { sec: 120, speed: 2.7 },
        { sec: 90, speed: 3.9 },
        { sec: 60, speed: 2.2 },
        { sec: 90, speed: 3.0 },
        { sec: 60, speed: 2.2 },
        { sec: 90, speed: 4.5 },
        { sec: 120, speed: 2.5 },
      ],
      noiseM: 0.9,
      acc: 3,
      accJitter: 1,
    }),
    {
      workout: {
        type: "intervals",
        steps: [
          { kind: "warmup", seconds: 120 },
          { kind: "work", seconds: 90, paceLoMps: 3.6, paceHiMps: 4.2 },
          { kind: "recover", seconds: 60, targetMps: 2.2 },
          { kind: "work", seconds: 90, paceLoMps: 3.6, paceHiMps: 4.2 },
          { kind: "recover", seconds: 60 },
          { kind: "work", distanceM: 300, paceLoMps: 3.6, paceHiMps: 4.2 },
          { kind: "cooldown" },
        ],
      },
    },
  );
  add(
    "GPS dropouts: 25 and 40 second holes in the stream",
    (() => {
      const f = track({
        rng: rng(4),
        legs: [{ sec: 500, speed: 3.2, turn: 60 }],
        noiseM: 1.4,
        acc: 4,
        accJitter: 2,
      });
      return f.filter((x) =>
        !(x.t > 150 && x.t < 175) && !(x.t > 300 && x.t < 340)
      );
    })(),
  );
  add(
    "jumps: spikes and one real relocation",
    (() => {
      const f = track({
        rng: rng(5),
        legs: [{ sec: 400, speed: 3.3, turn: -45 }],
        noiseM: 1.2,
        acc: 4,
        accJitter: 2,
      });
      return f.map((x, i) =>
        i % 57 === 20
          ? { ...x, lat: x.lat + 180 / M_PER_DEG }
          : i >= 250 && i < 300
          ? { ...x, lon: x.lon + 0.003 }
          : x
      );
    })(),
    { workout: WORKOUT_EASY },
  );
  must(
    (cs[cs.length - 1].expected as { points: { gap?: boolean }[] }).points.some(
      (p) => p.gap,
    ),
    "a re-anchor in the run",
  );
  add(
    "late and duplicate fixes",
    (() => {
      const f = track({
        rng: rng(6),
        legs: [{ sec: 300, speed: 3 }],
        noiseM: 1,
        acc: 4,
      });
      const out: Fix[] = [];
      for (let i = 0; i < f.length; i += 6) {
        const chunk = f.slice(i, i + 6);
        out.push(...chunk, ...chunk.slice(0, 2));
      }
      return out;
    })(),
  );
  add(
    "km splits with HR",
    track({
      rng: rng(7),
      legs: [{ sec: 700, speed: 3.6, turn: 200 }],
      noiseM: 1,
      acc: 3.5,
      hr: 155,
      hrMissing: 0.1,
    }),
    { splitM: 1000 },
  );
  add(
    "splits option nested form and a minimum partial",
    track({
      rng: rng(8),
      legs: [{ sec: 400, speed: 3.6 }],
      noiseM: 1,
      acc: 3.5,
      hr: 150,
    }),
    { splits: { splitM: 400, minPartialM: 50 } },
  );
  add(
    "splitM shorthand wins over the nested splitM",
    track({
      rng: rng(9),
      legs: [{ sec: 300, speed: 3.6 }],
      noiseM: 1,
      acc: 3.5,
    }),
    { splitM: 500, splits: { splitM: 100 } },
  );
  add(
    "filter options: tight gates and quorum of 2",
    track({
      rng: rng(10),
      legs: [{ sec: 300, speed: 3.3 }],
      noiseM: 2,
      acc: 8,
      accJitter: 8,
    }).map((x, i) =>
      i >= 100 && i < 103 ? { ...x, lat: x.lat + 250 / M_PER_DEG } : x
    ),
    {
      filter: {
        accuracyGateM: 12,
        speedGateMps: 5,
        reanchorCount: 2,
        accelNoise: 0.8,
      },
    },
  );
  add(
    "autopause options: a faster pause, a slower resume",
    track({
      rng: rng(11),
      legs: [
        { sec: 120, speed: 3 },
        { sec: 30, speed: 0 },
        { sec: 120, speed: 3 },
        { sec: 20, speed: 0.4 },
        { sec: 60, speed: 3 },
      ],
      noiseM: 0.8,
      acc: 3,
    }),
    { autopause: { lowHoldSec: 2, highHoldSec: 6, lowMps: 0.8, highMps: 1.4 } },
  );
  add(
    "guided: step boundary inside the 5 s pause hold",
    (() => {
      const l = lineFixes({ count: 30, speedMps: 3 });
      return [
        ...l,
        ...stopFixes({ count: 40, t0: 30, lat: l[29].lat, lon: l[29].lon }),
      ];
    })(),
    {
      workout: {
        type: "intervals",
        steps: [{ kind: "warmup", seconds: 32 }, { kind: "work", seconds: 5 }, {
          kind: "cooldown",
        }],
      },
    },
  );
  add(
    "guided: distance step and zone prompts",
    track({
      rng: rng(12),
      legs: [{ sec: 100, speed: 3 }, { sec: 100, speed: 2.2 }, {
        sec: 100,
        speed: 4.5,
      }],
      noiseM: 0.7,
      acc: 3,
    }),
    {
      workout: {
        type: "tempo",
        steps: [
          { kind: "work", distanceM: 250, paceLoMps: 2.8, paceHiMps: 3.2 },
          { kind: "work", distanceM: 250, paceLoMps: 2.8, paceHiMps: 3.2 },
          { kind: "cooldown", seconds: 60 },
        ],
      },
      guided: { toleranceMps: 0.2, promptCooldownSec: 20 },
    },
  );
  add(
    "guided: workout with an empty step list",
    lineFixes({ count: 30, speedMps: 3 }),
    { workout: { type: "easy", steps: [] } },
  );
  add(
    "southern hemisphere, optional fields",
    track({
      rng: rng(13),
      legs: [{ sec: 200, speed: 3.5, turn: -100 }],
      lat: -33.86,
      lon: 151.2,
      heading: 200,
      noiseM: 1,
      acc: 4,
      hr: 150,
    }).map((x, i) => ({
      ...x,
      ...(i % 3 === 0 ? { cad: 165 } : {}),
      ...(i % 5 === 0 ? { ele: 20 + i * 0.05 } : {}),
    })),
    { splitM: 400 },
  );
  add(
    "sparse fixes every 4 s with a workout",
    track({
      rng: rng(14),
      legs: [{ sec: 600, speed: 3.2, turn: 90 }],
      dt: 4,
      dtJitter: 0.3,
      noiseM: 2,
      acc: 5,
    }),
    { workout: WORKOUT_EASY },
  );
  add(
    "nonfinite: broken fixes in the stream are dropped",
    (() => {
      const f = lineFixes({ count: 120, speedMps: 3 });
      return f.map((x, i) =>
        i === 20
          ? { ...x, lat: NaN }
          : i === 40
          ? { ...x, t: NaN }
          : i === 60
          ? { ...x, acc: NaN }
          : i === 80
          ? { ...x, lon: Infinity }
          : x
      );
    })(),
    { workout: WORKOUT_EASY },
  );

  emit("process_run", cs);
}

function genProcessRun2h(): void {
  // Two hours at 1 Hz: warm-up, four 4-minute reps with a stoplight in the middle, GPS noise,
  // bad-accuracy fixes, spikes, one relocation, HR with dropouts, and a guided workout.
  const rng = new Rng(780001);
  const legs: Leg[] = [{ sec: 900, speed: 2.8, turn: 90 }];
  for (let r = 0; r < 4; r++) {
    legs.push({ sec: 240, speed: 3.9 + 0.05 * r, turn: 30 }, {
      sec: 120,
      speed: 2.3,
      turn: -30,
    });
  }
  legs.push({ sec: 60, speed: 0 }, { sec: 1500, speed: 3.0, turn: 360 }, {
    sec: 45,
    speed: 0,
  });
  const used = legs.reduce((s, l) => s + l.sec, 0);
  legs.push({ sec: 7200 - used, speed: 2.6, turn: -180 });
  const fixes = track({
    rng,
    legs,
    noiseM: 1.4,
    acc: 3,
    accJitter: 9,
    dtJitter: 0.01,
    hr: 148,
    hrMissing: 0.03,
  }).map((f, i) =>
    i % 997 === 400
      ? { ...f, lat: f.lat + 160 / M_PER_DEG }
      : i >= 3000 && i < 3040
      ? { ...f, lon: f.lon + 0.004 }
      : i % 613 === 100
      ? { ...f, acc: 45 }
      : f
  );
  const steps: WorkoutStep[] = [{ kind: "warmup", seconds: 900 }];
  for (let r = 0; r < 4; r++) {
    steps.push({ kind: "work", seconds: 240, paceLoMps: 3.6, paceHiMps: 4.3 });
    steps.push({ kind: "recover", seconds: 120 });
  }
  steps.push({ kind: "cooldown" });
  const workout: RunWorkout = { type: "intervals", steps };
  const cs = [
    mk(
      "two hours at 1 Hz, intervals workout",
      { fixes, opts: { workout } },
      runProcess,
    ),
    mk("the same two hours without a workout", { fixes }, runProcess),
  ];
  const e = cs[0].expected as {
    points: { gap?: boolean }[];
    splits: unknown[];
    paused: unknown[];
    guidedEvents: { type: string }[];
  };
  must(
    e.points.length > 6500,
    `most of the 7200 fixes accepted (${e.points.length})`,
  );
  must(e.points.some((p) => p.gap), "the relocation re-anchors");
  must(e.paused.length >= 2, "both stops pause");
  must(e.splits.length >= 12, "mile splits");
  must(
    e.guidedEvents.filter((g) => g.type === "stepEnd").length >= 8,
    "steps end",
  );
  must(
    e.guidedEvents.some((g) => g.type === "speedUp" || g.type === "slowDown"),
    "prompts fire",
  );
  emit("process_run_2h", cs);
}

// ---------------------------------------------------------------------------
// One-ulp nudge pass
// ---------------------------------------------------------------------------

const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

/** The double one ulp away from x in the direction of dir (+1 or -1). */
function nudgeUlp(x: number, dir: 1 | -1): number {
  // Every libm returns exactly 0 and +-1 where the true value is exactly that
  // (sin 0, cos 0, tan 0, atan 0), and Vincenty's `sinSigma === 0` test for
  // coincident points relies on it, so those results are not nudged.
  if (!Number.isFinite(x) || x === 0 || Math.abs(x) === 1) return x;
  f64[0] = x;
  const away = (x > 0) === (dir > 0);
  u64[0] = away ? u64[0] + 1n : u64[0] - 1n;
  return f64[0];
}

const NUDGED = ["sin", "cos", "tan", "atan", "atan2", "asin", "hypot"] as const;

function withNudge<T>(dir: 1 | -1, fn: () => T): T {
  const saved: Record<string, (...a: number[]) => number> = {};
  for (const name of NUDGED) {
    const orig = Math[name] as (...a: number[]) => number;
    saved[name] = orig;
    (Math as unknown as Record<string, unknown>)[name] = (...a: number[]) =>
      nudgeUlp(orig(...a), dir);
  }
  try {
    return fn();
  } finally {
    for (const name of NUDGED) {
      (Math as unknown as Record<string, unknown>)[name] = saved[name];
    }
  }
}

/**
 * Compare two outputs: everything but numbers must be equal, numbers must agree
 * within 1e-6 relative (a nudge moves values by about 1e-9 at the very most; a
 * larger move means a discrete decision flipped). Returns the worst relative
 * difference seen, or throws a message naming the first discrete difference.
 */
function nudgeDiff(
  a: unknown,
  b: unknown,
  path: string,
  limit: number,
): number {
  if (typeof a === "number" && typeof b === "number") {
    if (a === b) return 0;
    const abs = Math.abs(a - b);
    const rel = abs / Math.max(Math.abs(a), Math.abs(b), 1e-12);
    // Values at the 1e-6 level (a speed decaying toward zero at a stop) are
    // differences of much larger numbers and carry absolute, not relative, noise.
    if (rel > limit && abs > ABS_FLOOR) {
      throw new Error(`${path}: ${a} vs ${b}`);
    }
    if (abs > ABS_FLOOR && rel > nudgeWorst.rel) {
      nudgeWorst.rel = rel;
      nudgeWorst.path = `${path} (${a} vs ${b})`;
    }
    return abs > ABS_FLOOR ? rel : 0;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      throw new Error(`${path}: length ${a.length} vs ${b.length}`);
    }
    let worst = 0;
    for (let i = 0; i < a.length; i++) {
      worst = Math.max(
        worst,
        nudgeDiff(a[i], b[i], `${path}[${i}]`, limit),
      );
    }
    return worst;
  }
  if (
    a !== null && b !== null && typeof a === "object" && typeof b === "object"
  ) {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.join() !== kb.join()) {
      throw new Error(`${path}: keys ${ka.join()} vs ${kb.join()}`);
    }
    let worst = 0;
    for (const k of ka) {
      worst = Math.max(
        worst,
        nudgeDiff(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
          `${path}.${k}`,
          limit,
        ),
      );
    }
    return worst;
  }
  if (a !== b) {
    throw new Error(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
  return 0;
}

const nudgeWorst = { rel: 0, path: "" };

function nudgePass(): void {
  let worst = 0;
  let worstWhere = "";
  const failures: string[] = [];
  for (const c of emitted) {
    const run = recompute.get(c);
    if (!run) continue;
    // Constants and trig-free cases would pass trivially; the geodesy cases
    // are exempt from the structure check and only report their error.
    for (const dir of [1, -1] as const) {
      let nudged: unknown;
      try {
        nudged = withNudge(dir, run);
      } catch (e) {
        failures.push(`${c.name}: threw under nudge: ${(e as Error).message}`);
        continue;
      }
      try {
        // A case that declares a loose tolerance (a sub-metre Vincenty segment
        // loses digits to cancellation) is allowed a proportionally larger move.
        const limit = Math.max(1e-6, (c.tolerance ?? 0) * 100);
        const w = nudgeDiff(nudged, c.expected, "$", limit);
        if (w > worst) {
          worst = w;
          worstWhere = c.name;
        }
      } catch (e) {
        failures.push(
          `${c.name} (${dir > 0 ? "+" : "-"}1 ulp): ${(e as Error).message}`,
        );
      }
    }
  }
  if (failures.length > 0) {
    console.error(
      `golden_run: ${failures.length} case(s) change under a one-ulp nudge. ` +
        `Move their inputs off the decision they sit on:\n  ` +
        failures.slice(0, 40).join("\n  "),
    );
    Deno.exit(1);
  }
  console.log(
    `nudge pass: ${emitted.length} cases, worst relative error ${
      worst.toExponential(2)
    } (${worstWhere}) at ${nudgeWorst.path}`,
  );
}

// ---------------------------------------------------------------------------

genGeodesy();
genFilter();
genAutopause();
genSplits();
genPace();
genGuided();
genProcessRun();
genProcessRun2h();
nudgePass();
console.log(counts.map(([f, n]) => `${f}: ${n}`).join(", "));
