// MinerU for PDF import, through Sonoro's adapter.
//
// Sonoro's sidecar (:7880) only offers /ingest, the magazine pipeline: it
// takes a path on its own disk, cuts the result into "articles", and when a
// document has no magazine contents page it hands the text to a Claude
// segmenter, which sends it off the machine. That is the wrong tool for an
// untrusted workout PDF, so this runs the same adapter the sidecar runs
// (sidecar/mineru_adapter.py, documented there as a standalone CLI) and reads
// its `*_content_list.json` directly. The adapter checks that the vLLM server
// is up before it loads anything heavy and exits 2 when it is not, which is
// how "MinerU is down" shows up here.
//
// Sonoro is read-only for this: nothing here edits it, and the adapter writes
// only into the temp directory it is given.

import { type CommandRunner, scrubbedEnv } from "./exec.ts";

export interface MineruConfig {
  /** Python from Sonoro's venv, which has mineru installed. */
  python: string;
  adapter: string;
  vlmUrl: string;
  vlmModel: string;
}

export const MINERU_DEFAULTS = {
  vlmUrl: "http://127.0.0.1:30000",
  vlmModel: "MinerU2.5-Pro-2605-1.2B",
  timeoutMs: 240_000,
  /** Refuse to parse a content list larger than this. */
  maxContentListBytes: 20 * 1024 * 1024,
} as const;

/**
 * The live config, or null when MinerU is switched off (QALA_MINERU=off).
 * Paths and the vLLM address can be overridden from the environment.
 */
export function liveMineruConfig(): MineruConfig | null {
  if (Deno.env.get("QALA_MINERU") === "off") return null;
  const home = Deno.env.get("HOME") ?? "";
  const sidecar = `${home}/Programming/Sonoro/sidecar`;
  return {
    python: Deno.env.get("QALA_MINERU_PYTHON") ?? `${sidecar}/.venv/bin/python`,
    adapter: Deno.env.get("QALA_MINERU_ADAPTER") ??
      `${sidecar}/mineru_adapter.py`,
    vlmUrl: Deno.env.get("QALA_MINERU_VLM_URL") ?? MINERU_DEFAULTS.vlmUrl,
    vlmModel: Deno.env.get("QALA_MINERU_VLM_MODEL") ?? MINERU_DEFAULTS.vlmModel,
  };
}

export type MineruResult =
  | { ok: true; blocks: unknown }
  | { ok: false; reason: string };

/** The informative last line of the adapter's stderr, bounded. */
function lastLine(stderr: string): string {
  const lines = stderr.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  const err = [...lines].reverse().find((l) =>
    l.startsWith("[adapter] error:")
  );
  const line = (err ?? lines[lines.length - 1] ?? "").replace(
    /^\[adapter\] error:\s*/,
    "",
  );
  return line.slice(0, 200);
}

/**
 * Parse `pdfPath` with MinerU. `workDir` is a directory the caller owns and
 * removes; the adapter creates `workDir/mineru` inside it. Never throws: any
 * failure comes back as `{ ok: false, reason }` so the caller can fall back.
 */
export async function runMineru(
  pdfPath: string,
  workDir: string,
  cfg: MineruConfig,
  run: CommandRunner,
  timeoutMs: number = MINERU_DEFAULTS.timeoutMs,
): Promise<MineruResult> {
  const outDir = `${workDir}/mineru`;
  const env = scrubbedEnv();
  for (const key of ["MINERU_HOME", "OPENARC_API_KEY"]) {
    const v = Deno.env.get(key);
    if (v !== undefined) env[key] = v;
  }
  const r = await run({
    cmd: cfg.python,
    args: [
      cfg.adapter,
      "--pdf",
      pdfPath,
      "--out",
      outDir,
      "--vlm-url",
      cfg.vlmUrl,
      "--vlm-model",
      cfg.vlmModel,
      // Per-figure descriptions cost a model call each and nothing reads them.
      "--no-image-analysis",
      "--no-merge",
    ],
    timeoutMs,
    maxStdoutBytes: 64 * 1024,
    env,
    // The adapter forks a render pool; one session lets a timeout end it all.
    ownSession: true,
  });
  if (r.spawnFailed) {
    return { ok: false, reason: "MinerU is not installed on this server" };
  }
  if (r.timedOut) {
    return {
      ok: false,
      reason: `MinerU did not finish within ${Math.round(timeoutMs / 1000)} s`,
    };
  }
  if (r.code !== 0) {
    const why = lastLine(r.stderr);
    return {
      ok: false,
      reason: r.code === 2 && why !== ""
        ? `MinerU is not ready: ${why}`
        : `MinerU failed (exit ${r.code})${why === "" ? "" : `: ${why}`}`,
    };
  }
  try {
    let file: string | undefined;
    for await (const entry of Deno.readDir(outDir)) {
      if (
        entry.isFile && entry.name.endsWith("_content_list.json") &&
        !entry.name.endsWith(".raw.json")
      ) {
        file = `${outDir}/${entry.name}`;
        break;
      }
    }
    if (file === undefined) {
      return { ok: false, reason: "MinerU wrote no content list" };
    }
    const size = (await Deno.stat(file)).size;
    if (size > MINERU_DEFAULTS.maxContentListBytes) {
      return { ok: false, reason: "MinerU output was too large to read" };
    }
    return { ok: true, blocks: JSON.parse(await Deno.readTextFile(file)) };
  } catch {
    return { ok: false, reason: "MinerU output could not be read" };
  }
}
