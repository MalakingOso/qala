// Differential fuzz oracle for the Rust run pipeline (crates/qala-core/src/run, docs/rust-core.md R1).
//
//   deno task fuzz:run        # same as: deno run -A scripts/gen_run_fuzz.ts
//
// Runs the real TS packages/run and writes random cases with the TS answers as JSON Lines under
// testdata/golden/run/fuzz/ (gitignored):
//
//   geo_fuzz_00..09.jsonl      1,000,000 geodesy pairs (vincentyM, haversineM)
//   stream_fuzz_00..09.jsonl   20,000 random fix streams through the filter, auto-pause, splits,
//                              pace and the guided machine (processRun)
//   manifest.json              what a complete run wrote
//
// The replay test is crates/qala-core/tests/fuzz_core.rs (fuzz_run). Output is deterministic: a
// private seeded PRNG drives everything (FUZZ_SEED varies the corpus) and chunk k is seeded from
// (seed, k), so the worker count (FUZZ_WORKERS) changes nothing. FUZZ_PILOT=n limits every chunk to
// n cases for a quick look.
//
// Numbers that are NaN or +-Infinity are the strings "NaN", "Infinity" and "-Infinity", and -0 is
// "-0" (fuzz_lib.ts `en`).
//
//   ["g", lat1, lon1, lat2, lon2, vincenty, haversine]
//
//   ["s", fixes, opts, expected]
//     fix      [t, lat, lon, acc] or [t, lat, lon, acc, hr]; null stands for a field the TS fix
//              does not have (TS sees undefined, which every gate treats like NaN)
//     opts     the ProcessRunOptions subset {filter?, autopause?, splitM?, workout?, guided?}
//     expected {
//       e:  how many points each push appended (FixFilter.push),
//       p:  [[index, lat, lon, speedMps, distM], ...] every third point and the last,
//       n:  the point count,
//       g:  indices of the points flagged `gap`,
//       pz: [[startT, endT], ...],
//       sp: [[index, distM, sec, cumSec, hrAvg|null], ...],
//       r:  [distanceM, movingSec, elapsedSec, avgSpeedMps, currentSpeedMps|null, cueSpeedMps|null],
//       ev: ["stepStart:0", "speedUp:1", ...]   the guided events as type:stepIndex
//     }

import { FixFilter, haversineM, vincentyM } from "../packages/run/filter.ts";
import { processRun } from "../packages/run/mod.ts";
import type { ProcessRunOptions } from "../packages/run/mod.ts";
import type { Fix, RunWorkout, WorkoutStep } from "../packages/run/types.ts";
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

const GEO_CHUNK = 100_000;
const GEO_CHUNKS = 10;
const STREAM_CHUNK = 2_000;
const STREAM_CHUNKS = 10;
const AREA_ID = 3;
const DEFAULT_SEED = 20261111;
const OUT_DIR = new URL("../testdata/golden/run/fuzz/", import.meta.url)
  .pathname;

const M_PER_DEG = 111319.49;

function p2(n: number): string {
  return String(n).padStart(2, "0");
}

interface Ctx {
  stats: Record<string, number>;
  slowest: { ms: number; what: string };
}

function bump(ctx: Ctx, key: string): void {
  ctx.stats[key] = (ctx.stats[key] ?? 0) + 1;
}

function gauss(rng: Rng): number {
  const u = Math.max(rng.next(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
}

// ---------------------------------------------------------------------------
// Geodesy
// ---------------------------------------------------------------------------

function clampLat(x: number): number {
  return Math.max(-90, Math.min(90, x));
}

/** A uniform point on the sphere (latitude weighted by cosine). */
function globalPoint(rng: Rng): [number, number] {
  return [
    Math.asin(rng.float(-1, 1)) * 180 / Math.PI,
    rng.float(-180, 180),
  ];
}

function offsetPoint(
  rng: Rng,
  lat: number,
  lon: number,
  metres: number,
): [number, number] {
  const bearing = rng.float(0, 2 * Math.PI);
  const dLat = metres * Math.cos(bearing) / M_PER_DEG;
  const cos = Math.max(Math.cos(lat * Math.PI / 180), 1e-6);
  const dLon = metres * Math.sin(bearing) / (M_PER_DEG * cos);
  return [clampLat(lat + dLat), lon + dLon];
}

function geoCase(rng: Rng, ctx: Ctx): unknown {
  const kind = rng.weighted<string>([
    [26, "global"],
    [22, "local"],
    [14, "stride"],
    [10, "submetre"],
    [8, "city"],
    [9, "antipode"],
    [3, "same"],
    [3, "wrap"],
    [5, "special"],
  ]);
  bump(ctx, `geo ${kind}`);
  let la1: number, lo1: number, la2: number, lo2: number;
  switch (kind) {
    case "global": {
      [la1, lo1] = globalPoint(rng);
      [la2, lo2] = globalPoint(rng);
      break;
    }
    case "local": {
      [la1, lo1] = globalPoint(rng);
      [la2, lo2] = offsetPoint(rng, la1, lo1, 10 ** rng.float(0, 4.5));
      break;
    }
    case "stride": {
      [la1, lo1] = [rng.float(-70, 75), rng.float(-180, 180)];
      [la2, lo2] = offsetPoint(rng, la1, lo1, rng.float(0.5, 30));
      break;
    }
    case "submetre": {
      [la1, lo1] = [rng.float(-80, 80), rng.float(-180, 180)];
      [la2, lo2] = offsetPoint(rng, la1, lo1, 10 ** rng.float(-3, 0));
      break;
    }
    case "city": {
      [la1, lo1] = globalPoint(rng);
      [la2, lo2] = offsetPoint(rng, la1, lo1, rng.float(1000, 100000));
      break;
    }
    case "antipode": {
      [la1, lo1] = globalPoint(rng);
      const eps = () => rng.pick([-1, 1]) * 10 ** rng.float(-6, 0.6);
      la2 = clampLat(-la1 + eps());
      lo2 = lo1 + 180 + eps();
      if (rng.chance(0.2)) {
        la1 = rng.pick([0, 0, 1e-9, -1e-9]);
        la2 = rng.pick([0, 1e-9, -1e-9, 0.5, -0.5]);
      }
      break;
    }
    case "same": {
      [la1, lo1] = globalPoint(rng);
      la2 = la1;
      lo2 = lo1;
      break;
    }
    case "wrap": {
      [la1, lo1] = globalPoint(rng);
      [la2, lo2] = offsetPoint(rng, la1, lo1, rng.pick([0, 5, 1000]));
      lo2 += rng.pick([-360, 360]);
      break;
    }
    default: {
      la1 = rng.pick([0, 90, -90, 89.9999, -89.9999, 45, 0.0001]);
      la2 = rng.pick([0, 90, -90, 89.9999, 10, -45, 0.0001]);
      lo1 = rng.pick([0, 180, -180, 179.9999, -179.9999, 90]);
      lo2 = rng.pick([0, 180, -180, 179.9999, -179.9999, 1e-7]);
    }
  }
  // A little rounding so the corpus holds a share of short decimals.
  if (rng.chance(0.15)) {
    la1 = dp(la1, 5);
    lo1 = dp(lo1, 5);
    la2 = dp(la2, 5);
    lo2 = dp(lo2, 5);
  }
  return [
    "g",
    en(la1),
    en(lo1),
    en(la2),
    en(lo2),
    en(vincentyM(la1, lo1, la2, lo2)),
    en(haversineM(la1, lo1, la2, lo2)),
  ];
}

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------

/** A fix whose fields may be missing (undefined), as the TS gates see them. */
type LooseFix = {
  t?: number;
  lat?: number;
  lon?: number;
  acc?: number;
  hr?: number;
};

const SPEEDS = [0, 0, 0.3, 0.9, 1.4, 2.5, 3.2, 3.2, 4, 5.5, 7.5, 9];

function baseLocation(rng: Rng): { lat: number; lon: number } {
  return rng.weighted<{ lat: number; lon: number }>([
    [88, { lat: rng.float(-60, 70), lon: rng.float(-180, 180) }],
    [6, {
      lat: rng.pick([1, -1]) * rng.float(83, 89.9),
      lon: rng.float(-180, 180),
    }],
    [6, {
      lat: rng.float(-50, 60),
      lon: rng.pick([1, -1]) * rng.float(179.99, 180),
    }],
  ]);
}

function walk(rng: Rng, n: number): LooseFix[] {
  const base = baseLocation(rng);
  let { lat, lon } = base;
  let heading = rng.float(0, 360);
  const dt = rng.pick([0.5, 1, 1, 1, 1, 2, 2, 5, 10]);
  const dtJitter = rng.pick([0, 0, 0.05, 0.3]);
  const tPlaces = rng.pick([0, 1, 3, 6]);
  const noise = rng.pick([0, 0.5, 1, 1.5, 3, 6]);
  const accBase = rng.pick([2, 3, 4, 6, 10, 20]);
  const accJitter = rng.pick([0, 2, 8, 30]);
  const hrOn = rng.chance(0.4);
  let hr = rng.float(110, 170);
  let t = rng.pick([0, 0, 0, 1e3, 12345.678, -50, 1e7]);
  const out: LooseFix[] = [];
  let left = 0;
  let speed = 3;
  let turn = 0;
  while (out.length < n) {
    if (left <= 0) {
      speed = rng.pick(SPEEDS);
      left = rng.int(4, 60);
      turn = rng.float(-4, 4);
    }
    left--;
    const step = dt * (1 + dtJitter * (rng.next() * 2 - 1));
    t += step;
    heading += turn * step;
    const h = heading * Math.PI / 180;
    const cos = Math.max(Math.cos(lat * Math.PI / 180), 1e-6);
    lat = clampLat(lat + (speed * step * Math.cos(h)) / M_PER_DEG);
    lon += (speed * step * Math.sin(h)) / (M_PER_DEG * cos);
    // No wrap at the antimeridian: the TS filter works in local metres and jumps across it
    // (a documented limitation, one vector in filter.json), which only makes garbage tracks.
    const f: LooseFix = {
      t: dp(t, tPlaces),
      lat: lat + (noise > 0 ? gauss(rng) * noise / M_PER_DEG : 0),
      lon: lon + (noise > 0 ? gauss(rng) * noise / (M_PER_DEG * cos) : 0),
      acc: dp(accBase + rng.next() * accJitter, 1),
    };
    if (hrOn) {
      hr = Math.min(195, Math.max(80, hr + gauss(rng)));
      if (!rng.chance(0.08)) f.hr = Math.round(hr);
    }
    out.push(f);
  }
  return out;
}

/** Corruptions applied to a clean walk. Each returns a new array. */
function corrupt(rng: Rng, fixes: LooseFix[], ctx: Ctx): LooseFix[] {
  let out = fixes.map((f) => ({ ...f }));
  const kinds = rng.weighted<string[]>([
    [28, []],
    [30, [rng.pick(CORRUPTIONS)]],
    [25, [rng.pick(CORRUPTIONS), rng.pick(CORRUPTIONS)]],
    [17, [rng.pick(CORRUPTIONS), rng.pick(CORRUPTIONS), rng.pick(CORRUPTIONS)]],
  ]);
  for (const kind of kinds) {
    if (out.length === 0) break; // an earlier dropout took everything
    bump(ctx, `corrupt ${kind}`);
    const at = rng.int(0, Math.max(0, out.length - 1));
    switch (kind) {
      case "spike": {
        for (let k = 0; k < rng.int(1, 3); k++) {
          const i = Math.min(out.length - 1, at + k * rng.int(5, 20));
          out[i].lat = clampLat(
            (out[i].lat ?? 0) +
              rng.pick([-1, 1]) * rng.float(50, 800) / M_PER_DEG,
          );
        }
        break;
      }
      case "relocate": {
        const len = rng.int(1, 8);
        const dLat = rng.pick([-1, 1]) * rng.float(100, 3000) / M_PER_DEG;
        for (let i = at; i < Math.min(out.length, at + len); i++) {
          out[i].lat = clampLat((out[i].lat ?? 0) + dLat);
        }
        break;
      }
      case "dupTime": {
        const copy: LooseFix[] = [];
        for (const f of out) {
          copy.push(f);
          if (rng.chance(0.15)) {
            copy.push({
              ...f,
              lat: (f.lat ?? 0) + rng.float(-3, 3) / M_PER_DEG,
            });
          }
        }
        out = copy;
        break;
      }
      case "lateBatch": {
        const size = rng.int(2, 8);
        const re: LooseFix[] = [];
        for (let i = 0; i < out.length; i += size) {
          const chunk = out.slice(i, i + size);
          re.push(...(rng.chance(0.5) ? chunk.reverse() : chunk));
        }
        out = re;
        break;
      }
      case "dropout": {
        const len = rng.int(5, 60);
        out = out.filter((_, i) => i < at || i >= at + len);
        break;
      }
      case "backwards": {
        if (out.length > 10) {
          const i = rng.int(5, out.length - 1);
          out[i].t = (out[i].t ?? 0) - rng.pick([0, 0.5, 5, 50]);
        }
        break;
      }
      case "nonfinite": {
        const field = rng.pick(["t", "lat", "lon", "acc", "hr"] as const);
        const bad = rng.pick([NaN, Infinity, -Infinity]);
        for (let k = 0; k < rng.int(1, 3); k++) {
          const i = Math.min(out.length - 1, at + k * 3);
          (out[i] as Record<string, number | undefined>)[field] = bad;
        }
        break;
      }
      case "missing": {
        const field = rng.pick(["t", "lat", "lon", "acc"] as const);
        delete (out[at] as Record<string, number | undefined>)[field];
        break;
      }
      case "accGate": {
        for (let k = 0; k < rng.int(1, 4); k++) {
          const i = Math.min(out.length - 1, at + k);
          out[i].acc = rng.pick([
            25,
            25,
            25.000000001,
            24.999999999,
            0,
            -0,
            -1,
            1e-9,
          ]);
        }
        break;
      }
      case "staticLong": {
        const len = rng.int(10, 80);
        const f = out[Math.min(at, out.length - 1)];
        for (let i = at; i < Math.min(out.length, at + len); i++) {
          out[i].lat = f.lat;
          out[i].lon = f.lon;
        }
        break;
      }
    }
  }
  return out;
}

const CORRUPTIONS = [
  "spike",
  "relocate",
  "dupTime",
  "lateBatch",
  "dropout",
  "backwards",
  "nonfinite",
  "missing",
  "accGate",
  "staticLong",
];

function randomWorkout(rng: Rng): RunWorkout {
  const steps: WorkoutStep[] = [];
  const n = rng.int(1, 5);
  for (let i = 0; i < n; i++) {
    const s: WorkoutStep = {
      kind: rng.pick(["warmup", "work", "recover", "cooldown"] as const),
    };
    if (rng.chance(0.6)) s.seconds = rng.pick([20, 45, 60, 90, 120, 300]);
    if (rng.chance(0.3)) s.distanceM = rng.pick([100, 250, 400, 1000]);
    const zone = rng.next();
    if (zone < 0.35) {
      s.paceLoMps = rng.pick([2.4, 2.9, 3.4]);
      s.paceHiMps = s.paceLoMps + rng.pick([0.2, 0.5, 1]);
      if (rng.chance(0.15)) {
        [s.paceLoMps, s.paceHiMps] = [s.paceHiMps, s.paceLoMps];
      }
    } else if (zone < 0.5) s.targetMps = rng.pick([2.5, 3.2, 4]);
    if (rng.chance(0.2)) s.repeat = rng.pick([1, 2, 3]);
    steps.push(s);
  }
  return { type: "intervals", steps };
}

function randomOpts(rng: Rng): ProcessRunOptions {
  const opts: ProcessRunOptions = {};
  if (rng.chance(0.3)) {
    opts.filter = {
      ...(rng.chance(0.5) ? { accuracyGateM: rng.pick([5, 10, 25, 40]) } : {}),
      ...(rng.chance(0.5) ? { speedGateMps: rng.pick([3, 5, 7, 12]) } : {}),
      ...(rng.chance(0.5) ? { reanchorCount: rng.pick([1, 2, 3, 5]) } : {}),
      ...(rng.chance(0.5) ? { accelNoise: rng.pick([0.3, 1.5, 4]) } : {}),
    };
  }
  if (rng.chance(0.25)) {
    opts.autopause = {
      ...(rng.chance(0.5) ? { lowMps: rng.pick([0.3, 0.6, 0.9]) } : {}),
      ...(rng.chance(0.5) ? { lowHoldSec: rng.pick([1, 3, 5, 12]) } : {}),
      ...(rng.chance(0.5) ? { highMps: rng.pick([0.8, 1.0, 1.6]) } : {}),
      ...(rng.chance(0.5) ? { highHoldSec: rng.pick([1, 3, 6]) } : {}),
    };
  }
  if (rng.chance(0.3)) opts.splitM = rng.pick([100, 250, 400, 1000, 1609.344]);
  if (rng.chance(0.3)) {
    opts.workout = randomWorkout(rng);
    if (rng.chance(0.3)) {
      opts.guided = {
        ...(rng.chance(0.5) ? { toleranceMps: rng.pick([0, 0.1, 0.3]) } : {}),
        ...(rng.chance(0.5)
          ? { promptCooldownSec: rng.pick([0, 15, 45]) }
          : {}),
      };
    }
  }
  return opts;
}

const f4 = (x: number | undefined | null): number | string | null =>
  x === undefined || x === null ? null : en(x);

function encodeFix(f: LooseFix): unknown[] {
  const row: unknown[] = [f4(f.t), f4(f.lat), f4(f.lon), f4(f.acc)];
  if (f.hr !== undefined) row.push(en(f.hr));
  return row;
}

/** The JSON form the replay sees: non-finite numbers revived, so TS runs on what Rust reads. */
function streamCase(rng: Rng, ctx: Ctx): unknown {
  const n = rng.weighted<number>([
    [30, rng.int(30, 90)],
    [45, rng.int(90, 250)],
    [20, rng.int(250, 500)],
    [5, rng.int(500, 900)],
  ]);
  const loose = corrupt(rng, walk(rng, n), ctx);
  const opts = randomOpts(rng);
  const fixes = loose as unknown as Fix[];

  const filter = new FixFilter(opts.filter);
  const emitted: number[] = [];
  for (const fix of fixes) {
    const before = filter.points.length;
    filter.push(fix);
    emitted.push(filter.points.length - before);
  }
  const run = processRun(fixes, opts);
  const pts = run.points;
  const sampled: unknown[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i % 3 === 0 || i === pts.length - 1) {
      sampled.push([
        i,
        en(pts[i].lat),
        en(pts[i].lon),
        en(pts[i].speedMps),
        en(pts[i].distM),
      ]);
    }
  }
  bump(ctx, "stream");
  if (pts.some((p) => p.gap)) bump(ctx, "stream with re-anchor");
  if (run.paused.length > 0) bump(ctx, "stream with pause");
  if (run.splits.length > 0) bump(ctx, "stream with splits");
  if (run.guidedEvents.length > 0) bump(ctx, "stream with guided events");
  if (
    run.guidedEvents.some((e) => e.type === "speedUp" || e.type === "slowDown")
  ) {
    bump(ctx, "stream with prompts");
  }
  return [
    "s",
    loose.map(encodeFix),
    reviveSafeOpts(opts),
    {
      e: emitted,
      p: sampled,
      n: pts.length,
      g: pts.flatMap((p, i) => (p.gap ? [i] : [])),
      pz: run.paused.map((p) => [en(p.startT), en(p.endT)]),
      sp: run.splits.map((s) => [
        s.index,
        en(s.distM),
        en(s.sec),
        en(s.cumSec),
        f4(s.hrAvg),
      ]),
      r: [
        en(run.distanceM),
        en(run.movingSec),
        en(run.elapsedSec),
        en(run.avgSpeedMps),
        f4(run.currentSpeedMps),
        f4(run.cueSpeedMps),
      ],
      ev: run.guidedEvents.map((e) =>
        "stepIndex" in e ? `${e.type}:${e.stepIndex}` : e.type
      ),
    },
  ];
}

/** Options are plain finite numbers, so they are written as they are. */
function reviveSafeOpts(opts: ProcessRunOptions): ProcessRunOptions {
  return JSON.parse(JSON.stringify(opts));
}

// ---------------------------------------------------------------------------
// Chunks
// ---------------------------------------------------------------------------

export function generateRunChunk(job: ChunkJob): ChunkResult {
  const rng = new Rng(chunkSeed(job.seed, AREA_ID, job.chunk));
  const isGeo = job.chunk < GEO_CHUNKS;
  const file = isGeo
    ? `geo_fuzz_${p2(job.chunk)}.jsonl`
    : `stream_fuzz_${p2(job.chunk - GEO_CHUNKS)}.jsonl`;
  const w = new ChunkWriter(job.outDir + file);
  const ctx: Ctx = { stats: {}, slowest: { ms: 0, what: "" } };
  const n = Number(
    Deno.env.get("FUZZ_PILOT") ?? (isGeo ? GEO_CHUNK : STREAM_CHUNK),
  );
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const line = isGeo ? geoCase(rng, ctx) : streamCase(rng, ctx);
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
  const geoChunks = Number(Deno.env.get("FUZZ_GEO_CHUNKS") ?? GEO_CHUNKS);
  const streamChunks = Number(
    Deno.env.get("FUZZ_STREAM_CHUNKS") ?? STREAM_CHUNKS,
  );
  removeStale(OUT_DIR, "geo_fuzz_");
  removeStale(OUT_DIR, "stream_fuzz_");
  Deno.writeTextFileSync(
    OUT_DIR + "manifest.json",
    JSON.stringify({ version: 1, area: "run", complete: false }) + "\n",
  );
  const jobs: ChunkJob[] = [];
  for (let k = 0; k < Math.min(GEO_CHUNKS, geoChunks); k++) {
    jobs.push({ area: "run", chunk: k, outDir: OUT_DIR, seed });
  }
  for (let k = 0; k < Math.min(STREAM_CHUNKS, streamChunks); k++) {
    jobs.push({ area: "run", chunk: GEO_CHUNKS + k, outDir: OUT_DIR, seed });
  }
  const workers = defaultWorkers(jobs.length);
  console.log(
    `run fuzz: ${jobs.length} chunks, ${workers} workers, seed ${seed}`,
  );
  const results = await runJobs(
    jobs,
    workers,
    (j) => Promise.resolve(generateRunChunk(j)),
  );
  Deno.writeTextFileSync(
    OUT_DIR + "manifest.json",
    JSON.stringify({
      version: 1,
      area: "run",
      complete: true,
      seed,
      cases: results.reduce((a, r) => a + r.count, 0),
      files: results.map((r) => r.file),
    }) + "\n",
  );
  printSummary("run fuzz", results, performance.now() - t0);
  console.log(`wrote ${OUT_DIR}`);
}

if (import.meta.main) await main();
