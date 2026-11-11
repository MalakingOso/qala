// Shared plumbing for the core differential fuzz generators
// (scripts/gen_plates_fuzz.ts and scripts/gen_engine_fuzz.ts).
//
// - A private seeded PRNG (mulberry32), independent of Math.random.
// - Number encoding for JSON: NaN, Infinity and -Infinity travel as the strings
//   "NaN", "Infinity" and "-Infinity" (the same strings the goldens use), because
//   JSON.stringify would write null and null already means "absent" for optional
//   fields. -0 travels as the string "-0": JSON.stringify would write 0, and the sign
//   of a zero input changes results (1 / -0 is -Infinity).
// - A chunk writer: JSON Lines, one case per line, written to `NAME.tmp` and
//   renamed to `NAME` when the chunk is finished, so a killed run never leaves a
//   half-written file that the Rust replay would pick up.
// - A worker pool: chunk k is generated from a PRNG seeded by (seed, area, k), so
//   the output is the same whatever the scheduling or the worker count.

export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Inclusive integer range. */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  /** Uniform float in [a, b). */
  float(a: number, b: number): number {
    return a + this.next() * (b - a);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** Picks by weight; `table` is [weight, value] pairs. */
  weighted<T>(table: readonly (readonly [number, T])[]): T {
    let total = 0;
    for (const [w] of table) total += w;
    let r = this.next() * total;
    for (const [w, v] of table) {
      r -= w;
      if (r < 0) return v;
    }
    return table[table.length - 1][1];
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** Seed for chunk `k` of an area: a fixed mix so chunks are independent. */
export function chunkSeed(base: number, areaId: number, k: number): number {
  let h = (base ^ Math.imul(areaId + 1, 0x9E3779B1)) >>> 0;
  h = Math.imul(h ^ (k + 1), 0x85EBCA6B) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xC2B2AE35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** A number for JSON: non-finite values and -0 become strings (see the header). */
export function en(x: number): number | string {
  if (Number.isNaN(x)) return "NaN";
  if (x === Infinity) return "Infinity";
  if (x === -Infinity) return "-Infinity";
  if (Object.is(x, -0)) return "-0";
  return x;
}

export function enAll(xs: readonly number[]): (number | string)[] {
  return xs.map(en);
}

/** Round a float to `d` decimals for readable generated inputs (keeps them JSON-exact). */
export function dp(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

export class ChunkWriter {
  private file: Deno.FsFile;
  private enc = new TextEncoder();
  private buf: string[] = [];
  private bufBytes = 0;
  count = 0;
  constructor(private path: string) {
    this.file = Deno.openSync(path + ".tmp", {
      write: true,
      create: true,
      truncate: true,
    });
  }
  line(value: unknown): void {
    const text = JSON.stringify(value);
    this.buf.push(text);
    this.bufBytes += text.length + 1;
    this.count++;
    if (this.bufBytes > 1 << 20) this.flush();
  }
  private flush(): void {
    if (this.buf.length === 0) return;
    const bytes = this.enc.encode(this.buf.join("\n") + "\n");
    let off = 0;
    while (off < bytes.length) off += this.file.writeSync(bytes.subarray(off));
    this.buf = [];
    this.bufBytes = 0;
  }
  /** Flushes, closes and renames `NAME.tmp` to `NAME`. */
  close(): void {
    this.flush();
    this.file.close();
    Deno.renameSync(this.path + ".tmp", this.path);
  }
}

export interface ChunkJob {
  area: "plates" | "engine" | "run";
  chunk: number;
  /** Absolute output directory with a trailing slash. */
  outDir: string;
  seed: number;
  /** Area specific payload (for plates, the shared inventories). */
  payload?: unknown;
}

export interface ChunkResult {
  chunk: number;
  file: string;
  count: number;
  bytes: number;
  /** Case counts per class, summed by the caller for the end-of-run summary. */
  stats: Record<string, number>;
  /** Slowest single case in milliseconds and a description of it. */
  slowest: { ms: number; what: string };
}

/**
 * Runs `jobs` on a pool of workers (each a fresh `fuzz_worker.ts` module worker) and
 * returns the results in chunk order. `workers` = 1 runs in-process.
 */
export async function runJobs(
  jobs: ChunkJob[],
  workers: number,
  runInProcess: (job: ChunkJob) => Promise<ChunkResult>,
): Promise<ChunkResult[]> {
  if (workers <= 1) {
    const out: ChunkResult[] = [];
    for (const j of jobs) out.push(await runInProcess(j));
    return out;
  }
  const results: ChunkResult[] = new Array(jobs.length);
  let next = 0;
  const pool: Promise<void>[] = [];
  for (let w = 0; w < Math.min(workers, jobs.length); w++) {
    pool.push(
      new Promise<void>((resolve, reject) => {
        const worker = new Worker(
          new URL("./fuzz_worker.ts", import.meta.url),
          {
            type: "module",
          },
        );
        const give = () => {
          if (next >= jobs.length) {
            worker.terminate();
            resolve();
            return;
          }
          const idx = next++;
          worker.postMessage({ idx, job: jobs[idx] });
        };
        worker.onmessage = (e: MessageEvent) => {
          if (e.data.error) {
            worker.terminate();
            reject(new Error(e.data.error));
            return;
          }
          results[e.data.idx] = e.data.result;
          console.log(
            `  chunk ${
              String(e.data.result.chunk).padStart(2, "0")
            }: ${e.data.result.count} cases, ${
              (e.data.result.bytes / 1e6).toFixed(1)
            } MB`,
          );
          give();
        };
        worker.onerror = (e) => {
          worker.terminate();
          reject(new Error(e.message));
        };
        give();
      }),
    );
  }
  await Promise.all(pool);
  return results;
}

export function sumStats(results: ChunkResult[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const r of results) {
    for (const [k, v] of Object.entries(r.stats)) {
      total[k] = (total[k] ?? 0) + v;
    }
  }
  return total;
}

export function printSummary(
  title: string,
  results: ChunkResult[],
  elapsedMs: number,
): void {
  const stats = sumStats(results);
  const cases = results.reduce((a, r) => a + r.count, 0);
  const bytes = results.reduce((a, r) => a + r.bytes, 0);
  console.log(
    `\n${title}: ${cases} cases, ${(bytes / 1e6).toFixed(0)} MB, ${
      (elapsedMs / 1000).toFixed(1)
    } s`,
  );
  for (const k of Object.keys(stats).sort()) {
    console.log(`  ${k.padEnd(28)} ${stats[k]}`);
  }
  const slow = results.map((r) => r.slowest).sort((a, b) => b.ms - a.ms)[0];
  if (slow) {
    console.log(`  slowest case: ${slow.ms.toFixed(1)} ms ${slow.what}`);
  }
}

export function defaultWorkers(chunks: number): number {
  const env = Deno.env.get("FUZZ_WORKERS");
  if (env) return Math.max(1, Number(env) | 0);
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(chunks, Math.floor(cores / 2), 12));
}

export function removeStale(outDir: string, prefix: string): void {
  Deno.mkdirSync(outDir, { recursive: true });
  for (const e of Deno.readDirSync(outDir)) {
    if (e.isFile && e.name.startsWith(prefix)) Deno.removeSync(outDir + e.name);
  }
}
