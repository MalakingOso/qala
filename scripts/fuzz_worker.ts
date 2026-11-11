/// <reference lib="deno.worker" />

// Worker entry for the core fuzz generators (see fuzz_lib.ts `runJobs`). Each message is
// one chunk job; the reply is that chunk's result. Nothing here depends on the order jobs
// arrive in: every chunk seeds its own PRNG.

import type { ChunkJob } from "./fuzz_lib.ts";

self.onmessage = async (e: MessageEvent<{ idx: number; job: ChunkJob }>) => {
  const { idx, job } = e.data;
  try {
    const result = job.area === "plates"
      ? (await import("./gen_plates_fuzz.ts")).generatePlatesChunk(job)
      : job.area === "run"
      ? (await import("./gen_run_fuzz.ts")).generateRunChunk(job)
      : (await import("./gen_engine_fuzz.ts")).generateEngineChunk(job);
    self.postMessage({ idx, result });
  } catch (err) {
    self.postMessage({
      error: `chunk ${job.chunk} of ${job.area}: ${
        err instanceof Error ? err.stack ?? err.message : String(err)
      }`,
    });
  }
};
