/* Program import (docs/ls-plus-plus.md 4, DECISIONS S19): send pasted or
 * dictated text to POST /api/import/text, or a PDF to POST /api/import/pdf,
 * read the proposal back, and answer its questions through the confirm step
 * (the text route again, with the edit list and the owner's resolutions).
 * DOM-free, so the panel stays thin and tests can pass a fake fetch. Nothing
 * here saves anything: a ready proposal's text goes to the editor as a draft. */

import {
  type DiffLine,
  diffLines,
} from "../../../../packages/llm/importEmit.ts";
import type {
  ConfirmItem,
  ImportProposal,
  Resolutions,
} from "../../../../packages/llm/importPipeline.ts";
import { MAX_IMPORT_CHARS } from "../../../../packages/llm/importPrompt.ts";
import type {
  EditItem,
  RejectedItem,
  WeightUnit,
} from "../../../../packages/llm/importSchema.ts";

export { MAX_IMPORT_CHARS };

/** The PDF route's caps (server/importPdf.ts, PDF_LIMITS). */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 40;

/** The answer that drops every line with that name. */
export const SKIP = "skip";

/** Where a PDF's text came from (server/importPdf.ts, PdfSource). */
export interface PdfSource {
  engine: "mineru" | "pdftotext";
  pages: number;
  chunks: number;
  /** True when pdftotext stood in for MinerU. */
  fallback: boolean;
  notice?: string;
}

export interface ImportResult {
  proposal: ImportProposal;
  /** PDF imports only. */
  source?: PdfSource;
  /** PDF imports only: the fallback notice, how the text was split, chunks
   * that gave nothing. */
  notes: string[];
}

export type ImportOutcome =
  | { ok: true; result: ImportResult }
  | { ok: false; message: string };

export interface ImportOptions {
  units: WeightUnit;
  signal?: AbortSignal;
}

/** The owner's answer per confirm key: a catalog id, or SKIP. */
export type Choices = Record<string, string>;

const fmtInt = (n: number) => n.toLocaleString("en-US");

/** "the upload took too long" becomes "The upload took too long." */
export function asSentence(s: string): string {
  const t = s.trim();
  if (t === "") return t;
  const first = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

/** Why the text can't be sent as it is, or null when it can. */
export function checkImportText(text: string): string | null {
  if (text.trim() === "") return "Paste or dictate a program first.";
  if (text.length > MAX_IMPORT_CHARS) {
    return `That's ${fmtInt(text.length)} characters and the limit is ${
      fmtInt(MAX_IMPORT_CHARS)
    }. Import it in parts.`;
  }
  return null;
}

/** Why the file can't be sent, or null when it can. The server sniffs the
 * bytes and counts the pages; this only saves an upload that would fail. */
export function checkPdf(
  file: { name: string; size: number; type: string },
): string | null {
  if (file.size === 0) return "That file is empty.";
  const named = /\.pdf$/i.test(file.name);
  if (!named && file.type !== "application/pdf") {
    return "That file is not a PDF.";
  }
  if (file.size > MAX_PDF_BYTES) return "That PDF is larger than 10 MB.";
  return null;
}

/** Every failure the routes return, as a sentence the owner can act on. */
export function importFailure(
  status: number,
  body: Record<string, unknown>,
  route: "text" | "pdf",
): string {
  const error = typeof body["error"] === "string" ? body["error"] : "";
  if (status === 502 && body["degraded"] === true) {
    return "The import model is not available right now. Type the program into the editor instead, or try again later.";
  }
  if (status === 503) {
    return error !== ""
      ? `${asSentence(error)} Try again later.`
      : "The server can't import right now. Try again later.";
  }
  if (status === 429) {
    return "Another import is running. Try again in a moment.";
  }
  if (status === 408) return "The upload took too long. Try again.";
  if (status === 415) return "That file is not a PDF.";
  if (status === 413 && route === "text") {
    return `The text is longer than ${
      fmtInt(MAX_IMPORT_CHARS)
    } characters. Import it in parts.`;
  }
  if (status === 500) {
    return "The server couldn't run the import (it answered 500).";
  }
  return error !== "" ? asSentence(error) : `The server answered ${status}.`;
}

function list<T>(v: unknown): T[] {
  return Array.isArray(v) ? v as T[] : [];
}

/** The proposal in a 200 or 422 body, or null when the body isn't one. The
 * server is our own, so this checks the shape, not every field. */
export function readProposal(
  body: Record<string, unknown>,
): ImportProposal | null {
  const status = body["status"];
  if (
    status !== "ready" && status !== "needs_confirm" && status !== "invalid"
  ) return null;
  const programText = body["programText"];
  if (status === "ready" && typeof programText !== "string") return null;
  return {
    status,
    items: list<EditItem>(body["items"]),
    rejected: list<RejectedItem>(body["rejected"]),
    confirms: list<ConfirmItem>(body["confirms"]),
    ...(typeof programText === "string" ? { programText } : {}),
    errors: list<unknown>(body["errors"]).filter((e): e is string =>
      typeof e === "string"
    ),
  };
}

function readSource(v: unknown): PdfSource | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const r = v as Record<string, unknown>;
  return {
    engine: r["engine"] === "mineru" ? "mineru" : "pdftotext",
    pages: typeof r["pages"] === "number" ? r["pages"] : 0,
    chunks: typeof r["chunks"] === "number" ? r["chunks"] : 0,
    fallback: r["fallback"] === true,
    ...(typeof r["notice"] === "string" ? { notice: r["notice"] } : {}),
  };
}

async function send(
  url: string,
  init: RequestInit,
  route: "text" | "pdf",
  fetchFn: typeof fetch,
): Promise<ImportOutcome> {
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Fall through to the status-based message.
  }
  const rec = typeof body === "object" && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  if (res.status === 200 || res.status === 422) {
    const proposal = readProposal(rec);
    if (proposal) {
      const source = readSource(rec["source"]);
      return {
        ok: true,
        result: {
          proposal,
          ...(source ? { source } : {}),
          notes: list<unknown>(rec["notes"]).filter((n): n is string =>
            typeof n === "string"
          ),
        },
      };
    }
    if (res.ok) {
      return {
        ok: false,
        message: "The server sent an answer the app can't read.",
      };
    }
  }
  return { ok: false, message: importFailure(res.status, rec, route) };
}

/** Ask the model to read pasted or dictated text. */
export function sendImportText(
  text: string,
  opts: ImportOptions,
  fetchFn: typeof fetch = fetch,
): Promise<ImportOutcome> {
  return send(
    "/api/import/text",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, units: opts.units }),
      signal: opts.signal,
    },
    "text",
    fetchFn,
  );
}

/** Send a PDF as the raw body, the shape the route and `curl --data-binary`
 * use. MinerU can take minutes, so pass a signal the owner can cancel. */
export function sendImportPdf(
  pdf: Blob,
  opts: ImportOptions,
  fetchFn: typeof fetch = fetch,
): Promise<ImportOutcome> {
  return send(
    `/api/import/pdf?units=${opts.units}`,
    {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: pdf,
      signal: opts.signal,
    },
    "pdf",
    fetchFn,
  );
}

/** The confirm step: the same edit list back, with every answer so far. The
 * route is stateless, so earlier rounds' answers go again. No model call.
 * The list goes in the model's own shape, `{ items }`, because the route
 * validates it exactly like model output. */
export function sendImportConfirm(
  items: readonly EditItem[],
  resolutions: Resolutions,
  opts: ImportOptions,
  fetchFn: typeof fetch = fetch,
): Promise<ImportOutcome> {
  return send(
    "/api/import/text",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        editList: { items },
        resolutions,
        units: opts.units,
      }),
      signal: opts.signal,
    },
    "text",
    fetchFn,
  );
}

function answers(c: ConfirmItem, choice: string | undefined): boolean {
  return choice === SKIP || c.candidates.some((e) => e.id === choice);
}

/** How many questions still have no answer. */
export function unanswered(
  confirms: readonly ConfirmItem[],
  choices: Choices,
): number {
  return confirms.filter((c) => !answers(c, choices[c.key])).length;
}

export function describeReason(c: ConfirmItem): string {
  if (c.reason === "ambiguous") return "Could be more than one exercise.";
  if (c.candidates.length > 0) {
    return "Not in the exercise list. These are close.";
  }
  return "Not in the exercise list, and nothing is close. Leave these lines out, or fix the name in the text and read it again.";
}

/** One edit-list line as the owner would say it:
 * "Week 1, day 2 (Lower B): 3x8-10, 135 lb, RPE 8". */
export function describeItem(item: EditItem): string {
  const reps = item.repsMax !== undefined
    ? `${item.reps}-${item.repsMax}`
    : `${item.reps}${item.amrap ? "+" : ""}`;
  const parts = [`${item.sets}x${reps}`];
  parts.push(
    item.weight !== undefined
      ? `${item.weight} ${item.unit ?? "lb"}`
      : "weight set on the first workout",
  );
  if (item.rpe !== undefined) parts.push(`RPE ${item.rpe}`);
  const label = item.dayLabel ? ` (${item.dayLabel})` : "";
  return `Week ${item.week}, day ${item.day}${label}: ${parts.join(", ")}`;
}

/** The lines a question decides, the first few spelled out. */
export function confirmLines(
  c: ConfirmItem,
  items: readonly EditItem[],
  max = 3,
): { lines: string[]; more: number } {
  const found = c.itemIndexes
    .map((i) => items[i])
    .filter((i): i is EditItem => i !== undefined);
  return {
    lines: found.slice(0, max).map(describeItem),
    more: Math.max(0, found.length - max),
  };
}

export function describeRejected(r: RejectedItem): string {
  const what = r.exercise
    ? r.exercise
    : r.index >= 0
    ? `Line ${r.index + 1}`
    : "The model's reply";
  return `${what}: ${r.reason}`;
}

/** "Read with MinerU, 3 pages in 2 parts." */
export function describeSource(s: PdfSource): string {
  const engine = s.engine === "mineru" ? "MinerU" : "pdftotext";
  const pages = `${s.pages} ${s.pages === 1 ? "page" : "pages"}`;
  const parts = `${s.chunks} ${s.chunks === 1 ? "part" : "parts"}`;
  return `Read with ${engine}, ${pages} in ${parts}.`;
}

/** The proposal against what the editor holds now, not what it held when the
 * request went out (and the PDF route always diffs against nothing). */
export function proposalDiff(
  current: string,
  programText: string,
): { lines: DiffLine[]; added: number; removed: number } {
  const lines = diffLines(current, programText);
  return {
    lines,
    added: lines.filter((l) => l.op === "add").length,
    removed: lines.filter((l) => l.op === "remove").length,
  };
}
