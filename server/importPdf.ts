// POST /api/import/pdf (DECISIONS S19, docs/ls-plus-plus.md 4).
//
// The body is a PDF (raw, or a multipart `file` part). The route reads its
// text with MinerU, or with `pdftotext -layout` when MinerU is down, cuts the
// text into per-day or per-week chunks, runs each chunk through the same
// extraction as POST /api/import/text, merges the edit lists in code and
// returns the same ImportProposal. The confirm step is the existing
// /api/import/text with `editList` and `resolutions`. This route writes
// nothing.
//
// PDF text is untrusted. It reaches the model only inside a fenced user
// message (buildImportPrompt), the model only fills the fixed edit-list
// schema, code validates every field, and nothing it returns is executed.
//
// Query: `?units=kg` sets the unit for weights that name none (default lb).

import {
  type ChatTransport,
  chunkProgramText,
  importChunks,
  type ImportDeps,
  type ImportProposal,
  type WeightUnit,
} from "../packages/llm/mod.ts";
import {
  type CommandRunner,
  createGate,
  type Gate,
  type KeyedGate,
  runCommand,
} from "./exec.ts";
import { importDepsOnce, type ImportRouteDeps } from "./import.ts";
import {
  liveMineruConfig,
  MINERU_DEFAULTS,
  type MineruConfig,
  runMineru,
} from "./mineru.ts";
import {
  cleanPdftotext,
  contentListToMarkdown,
  visibleChars,
} from "./pdfText.ts";
import { readUploadGated, uploadErrorResponse } from "./upload.ts";

export const PDF_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxPages: 40,
  uploadTimeoutMs: 60_000,
  pdfinfoTimeoutMs: 10_000,
  pdftotextTimeoutMs: 30_000,
  /** Fewer visible characters than this means no text layer. */
  minTextChars: 20,
  maxConcurrent: 1,
} as const;

export interface PdfImportDeps {
  run: CommandRunner;
  /** Resolves the text import dependencies (catalog, validator, model). */
  imports: () => Promise<ImportRouteDeps>;
  /** Null when MinerU is switched off. */
  mineru: MineruConfig | null;
  gate: Gate;
  pdfinfo: string;
  pdftotext: string;
  mineruTimeoutMs?: number;
  /** Server-side log for raw helper output; defaults to console.error. */
  log?: (message: string) => void;
  /** Total time allowed to receive the upload. Tests pass a short one. */
  uploadTimeoutMs?: number;
  /** Time allowed with no chunk arriving. Tests pass a short one. */
  uploadIdleMs?: number;
  /** Slots for uploads being received; defaults to the shared read gate. */
  readGate?: Gate;
  /** One read per identity; defaults to the shared per-identity gate. */
  identityGate?: KeyedGate;
}

/** Where the text came from, and anything the owner should know about it. */
export interface PdfSource {
  engine: "mineru" | "pdftotext";
  pages: number;
  chunks: number;
  /** True when pdftotext stood in for MinerU. */
  fallback: boolean;
  notice?: string;
}

export interface PdfImportResponse extends ImportProposal {
  source: PdfSource;
  /** How the text was split, and chunks that gave nothing. */
  notes: string[];
}

export const SCAN_MESSAGE =
  "This PDF has no text layer (it looks like a scan), and MinerU, which reads scans, is not available right now. Try again later, or paste the program text instead.";

function liveBase(): Omit<PdfImportDeps, "imports"> {
  return {
    run: runCommand,
    mineru: liveMineruConfig(),
    gate: createGate(PDF_LIMITS.maxConcurrent),
    pdfinfo: Deno.env.get("QALA_PDFINFO") ?? "/usr/bin/pdfinfo",
    pdftotext: Deno.env.get("QALA_PDFTOTEXT") ?? "/usr/bin/pdftotext",
  };
}

const LIVE = liveBase();

function fail(
  status: number,
  error: string,
  extra: Record<string, unknown> = {},
) {
  return Response.json({ error, ...extra }, { status });
}

function startsLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

type PageCount =
  | { ok: true; pages: number }
  | { ok: false; status: number; error: string };

async function countPages(
  path: string,
  deps: PdfImportDeps,
): Promise<PageCount> {
  const r = await deps.run({
    cmd: deps.pdfinfo,
    args: [path],
    timeoutMs: PDF_LIMITS.pdfinfoTimeoutMs,
    maxStdoutBytes: 64 * 1024,
  });
  if (r.spawnFailed) {
    return {
      ok: false,
      status: 503,
      error: "PDF tools are not installed on this server",
    };
  }
  if (r.code !== 0) {
    const locked = /password|encrypt/i.test(r.stderr);
    return {
      ok: false,
      status: 422,
      error: locked
        ? "This PDF is password protected."
        : "Could not read this file as a PDF.",
    };
  }
  const m = /^Pages:\s+(\d+)/m.exec(new TextDecoder().decode(r.stdout));
  const pages = m ? Number(m[1]) : 0;
  if (!Number.isInteger(pages) || pages < 1) {
    return {
      ok: false,
      status: 422,
      error: "Could not read this file as a PDF.",
    };
  }
  if (pages > PDF_LIMITS.maxPages) {
    return {
      ok: false,
      status: 413,
      error:
        `This PDF has ${pages} pages and the limit is ${PDF_LIMITS.maxPages}. Import it in parts.`,
    };
  }
  return { ok: true, pages };
}

async function readWithPdftotext(
  path: string,
  pages: number,
  deps: PdfImportDeps,
): Promise<string> {
  const r = await deps.run({
    cmd: deps.pdftotext,
    args: [
      "-q",
      "-layout",
      "-enc",
      "UTF-8",
      "-f",
      "1",
      "-l",
      String(pages),
      path,
      "-",
    ],
    timeoutMs: PDF_LIMITS.pdftotextTimeoutMs,
    maxStdoutBytes: 4 * 1024 * 1024,
  });
  if (r.spawnFailed || r.timedOut || r.code !== 0) return "";
  return cleanPdftotext(new TextDecoder().decode(r.stdout));
}

function statusFor(p: ImportProposal): number {
  switch (p.status) {
    case "degraded":
      return 502;
    case "invalid":
      return 422;
    default:
      return 200;
  }
}

/** Serve POST /api/import/pdf with explicit dependencies. Never throws. */
export async function handlePdfImport(
  req: Request,
  deps: PdfImportDeps,
): Promise<Response> {
  if (req.method !== "POST") return fail(405, "method not allowed");
  const units: WeightUnit = new URL(req.url).searchParams.get("units") === "kg"
    ? "kg"
    : "lb";

  // Receive the whole upload before taking the slot, so a client that stalls
  // mid-body cannot hold it.
  let upload;
  try {
    upload = await readUploadGated(req, PDF_LIMITS.maxBytes, {
      timeoutMs: deps.uploadTimeoutMs ?? PDF_LIMITS.uploadTimeoutMs,
      idleTimeoutMs: deps.uploadIdleMs,
      gate: deps.readGate,
      identityGate: deps.identityGate,
    });
  } catch (err) {
    return uploadErrorResponse(err) ?? fail(400, "could not read the upload");
  }
  if (!startsLikePdf(upload.bytes)) return fail(415, "That file is not a PDF.");

  const release = deps.gate.tryEnter();
  if (release === null) {
    return fail(429, "another PDF import is running, try again shortly");
  }
  let dir: string | undefined;
  try {
    dir = await Deno.makeTempDir({ prefix: "qala-pdf-" });
    const pdfPath = `${dir}/in.pdf`;
    await Deno.writeFile(pdfPath, upload.bytes);

    const counted = await countPages(pdfPath, deps);
    if (!counted.ok) return fail(counted.status, counted.error);
    const pages = counted.pages;

    // The evaluator can be missing (the LS++ wasm not built). Find out before
    // spending minutes in MinerU.
    let imports: ImportRouteDeps;
    try {
      imports = await deps.imports();
    } catch {
      return Response.json(
        { degraded: true, error: "the program checker is not available" },
        { status: 503 },
      );
    }

    // Text: MinerU first, pdftotext when MinerU cannot do it.
    let engine: PdfSource["engine"] = "mineru";
    let text = "";
    let mineruReason: string | undefined;
    if (deps.mineru === null) {
      mineruReason = "MinerU is switched off";
    } else {
      const m = await runMineru(
        pdfPath,
        dir,
        deps.mineru,
        deps.run,
        deps.mineruTimeoutMs ?? MINERU_DEFAULTS.timeoutMs,
        deps.log,
      );
      if (m.ok) {
        text = contentListToMarkdown(m.blocks);
        if (visibleChars(text) < PDF_LIMITS.minTextChars) {
          mineruReason = "MinerU found no text";
        }
      } else {
        mineruReason = m.reason;
      }
    }
    const mineruOk = mineruReason === undefined;
    let notice: string | undefined;
    if (!mineruOk) {
      engine = "pdftotext";
      text = await readWithPdftotext(pdfPath, pages, deps);
      if (visibleChars(text) < PDF_LIMITS.minTextChars) {
        return deps.mineru !== null && mineruReason === "MinerU found no text"
          ? fail(422, "No text could be read from this PDF.", { scan: true })
          : fail(422, SCAN_MESSAGE, { scan: true, reason: mineruReason });
      }
      notice =
        `${mineruReason}, so the text was read with pdftotext. Tables and columns may be misaligned, so check the diff.`;
    }

    const chunked = chunkProgramText(text);
    // A closed browser tab stops the remaining model calls.
    const transport: ChatTransport = (messages, schema) => {
      if (req.signal.aborted) {
        return Promise.reject(new Error("the client disconnected"));
      }
      return imports.transport(messages, schema);
    };
    const importDeps: ImportDeps = {
      transport,
      catalog: imports.catalog,
      validateProgram: imports.validatorFor(units),
      defaultUnit: units,
    };
    const result = await importChunks(chunked, importDeps);
    const source: PdfSource = {
      engine,
      pages,
      chunks: result.chunkCount,
      fallback: !mineruOk,
    };
    if (notice !== undefined) source.notice = notice;
    const notes = notice !== undefined
      ? [notice, ...result.notes]
      : result.notes;

    if (result.proposal.status === "degraded") {
      return Response.json(
        {
          degraded: true,
          error: result.proposal.errors.join("; "),
          source,
          notes,
        },
        { status: 502 },
      );
    }
    const body: PdfImportResponse = { ...result.proposal, source, notes };
    return Response.json(body, { status: statusFor(result.proposal) });
  } catch {
    return fail(500, "PDF import failed unexpectedly");
  } finally {
    release();
    if (dir !== undefined) {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  }
}

/** What the route needs from the server state, so this file does not import mod.ts. */
export interface PdfRouteState {
  options: { llmBaseUrl: string };
}

/** The dispatch entry used by server/mod.ts. */
export function serveImportPdf(
  req: Request,
  state: PdfRouteState,
): Promise<Response> {
  return handlePdfImport(req, {
    ...LIVE,
    imports: () => importDepsOnce(state.options.llmBaseUrl),
  });
}
