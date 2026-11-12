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

import { readdir, readFile, stat } from "node:fs/promises";

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
  if (process.env.QALA_MINERU === "off") return null;
  const home = process.env.HOME ?? "";
  const sidecar = `${home}/Programming/Sonoro/sidecar`;
  return {
    python: process.env.QALA_MINERU_PYTHON ?? `${sidecar}/.venv/bin/python`,
    adapter: process.env.QALA_MINERU_ADAPTER ??
      `${sidecar}/mineru_adapter.py`,
    vlmUrl: process.env.QALA_MINERU_VLM_URL ?? MINERU_DEFAULTS.vlmUrl,
    vlmModel: process.env.QALA_MINERU_VLM_MODEL ?? MINERU_DEFAULTS.vlmModel,
  };
}

/**
 * The only reasons the client ever sees. What the adapter actually printed
 * stays in the server log, because its stderr can carry URLs, paths and keys.
 */
export const MINERU_REASONS = {
  notInstalled: "MinerU is not installed on this server",
  notReady: "MinerU is not ready",
  timedOut: "MinerU timed out",
  failed: "MinerU failed",
} as const;

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
 * Take URLs, bearer tokens, `key=value` secrets and long key-like tokens out
 * of a line before it is logged. Best effort: the line is the adapter's own
 * message, not user text, but it can echo a configured URL or API key.
 */
export function redactLogLine(line: string): string {
  return line
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/\bBearer\s+\S+/gi, "Bearer <redacted>")
    .replace(
      /\b(api[_-]?key|token|secret|password|authorization)\s*[=:]\s*\S+/gi,
      "$1=<redacted>",
    )
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "<redacted>")
    .replace(
      /\b(?=[A-Za-z0-9_\-+/=]*\d)[A-Za-z0-9_\-+/=]{24,}\b/g,
      "<redacted>",
    );
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
  log: (message: string) => void = console.error,
): Promise<MineruResult> {
  const outDir = `${workDir}/mineru`;
  const env = scrubbedEnv();
  for (const key of ["MINERU_HOME", "OPENARC_API_KEY"]) {
    const v = process.env[key];
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
    log(
      `[mineru] cannot start the adapter: ${redactLogLine(lastLine(r.stderr))}`,
    );
    return { ok: false, reason: MINERU_REASONS.notInstalled };
  }
  if (r.timedOut) {
    log(`[mineru] timed out after ${Math.round(timeoutMs / 1000)} s`);
    return { ok: false, reason: MINERU_REASONS.timedOut };
  }
  if (r.code !== 0) {
    log(
      `[mineru] adapter exit ${r.code}: ${redactLogLine(lastLine(r.stderr))}`,
    );
    // Exit 2 is the adapter's own "a precondition failed" (vLLM down, models
    // missing); anything else is a crash.
    return {
      ok: false,
      reason: r.code === 2 ? MINERU_REASONS.notReady : MINERU_REASONS.failed,
    };
  }
  try {
    let file: string | undefined;
    for (const entry of await readdir(outDir, { withFileTypes: true })) {
      if (
        entry.isFile() && entry.name.endsWith("_content_list.json") &&
        !entry.name.endsWith(".raw.json")
      ) {
        file = `${outDir}/${entry.name}`;
        break;
      }
    }
    if (file === undefined) {
      log("[mineru] the adapter wrote no content list");
      return { ok: false, reason: MINERU_REASONS.failed };
    }
    const size = (await stat(file)).size;
    if (size > MINERU_DEFAULTS.maxContentListBytes) {
      log(`[mineru] content list is ${size} bytes, over the limit`);
      return { ok: false, reason: MINERU_REASONS.failed };
    }
    return { ok: true, blocks: JSON.parse(await readFile(file, "utf8")) };
  } catch (err) {
    log(
      `[mineru] could not read the content list: ${
        err instanceof Error ? err.name : "error"
      }`,
    );
    return { ok: false, reason: MINERU_REASONS.failed };
  }
}
