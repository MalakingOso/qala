// PDF import: chunking and merging (DECISIONS S19, docs/ls-plus-plus.md 4).
//
// The callisto context is 8192 tokens, so a PDF goes to the model in pieces:
// one per day when the document has day headings, one per week when it only
// has week headings, size-capped pieces otherwise. Code finds the headings,
// so code also owns the week and day numbers: whatever the model answers for
// week and day inside a chunk is overwritten with the numbers the chunker
// split on. The model only reads exercise lines. Nothing in a chunk reaches a
// system prompt, every chunk goes through buildImportPrompt like pasted text,
// and the merged list goes through the same matcher, emitter and evaluator.

import { buildImportPrompt } from "./importPrompt.ts";
import type {
  ImportDeps,
  ImportProposal,
  Resolutions,
} from "./importPipeline.ts";
import { resolveEditList } from "./importPipeline.ts";
import {
  EditListSchema,
  IMPORT_LIMITS,
  validateEditList,
} from "./importSchema.ts";
import type { EditItem, RejectedItem } from "./importSchema.ts";

/**
 * Source characters per model call. Well under MAX_IMPORT_CHARS: the reply is
 * JSON that shares the 8192 tokens, and tables cost more tokens per character.
 */
export const CHUNK_CHARS = 3000;
/** More chunks than this and the import asks for a smaller document. */
export const MAX_CHUNKS = 60;

export interface ImportChunk {
  /** Source text for the user message. Untrusted. */
  text: string;
  /** Set when a heading fixed it. Overwrites the model's answer. */
  week?: number;
  day?: number;
  /** Heading text minus its "Day N" prefix. Overwrites the model's label. */
  label?: string;
  /** For messages: "Week 2 Day 3", "Week 2 Day 3 (part 2)", "Part 1 of 4". */
  name: string;
}

export interface ChunkedText {
  chunks: ImportChunk[];
  /** True when headings fixed the week and day of the chunks. */
  structured: boolean;
  /** Things the owner should know about how the text was split. */
  notes: string[];
}

const HEADING_MAX_CHARS = 60;
const WEEKDAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
// A heading line starts with one of these words, after optional markdown.
const HEADING_START = new RegExp(
  `^(?:#{1,6}\\s*|[*_]{1,3}\\s*)*(?:week|wk|day|workout|${WEEKDAYS})\\b`,
  "i",
);
const WEEK_NUMBER = /\b(?:week|wk)\.?\s*#?(\d{1,2})\b/i;
const DAY_MARK = new RegExp(
  `\\bday\\s*#?\\d{1,2}\\b|\\bworkout\\s*#?(?:[a-z]|\\d{1,2})\\b|\\b(?:${WEEKDAYS})\\b`,
  "i",
);
// "3x5", "4 x 8": a data row, not a heading.
const SETS_BY_REPS = /\d\s*[x×]\s*\d/i;
const LABEL_PREFIX = new RegExp(
  `^(?:(?:week|wk)\\.?\\s*#?\\d{1,2}|day\\s*#?\\d{1,2}|workout\\s*#?(?:[a-z]|\\d{1,2}))\\b[\\s:.,\\u2013\\u2014-]*`,
  "i",
);

interface Heading {
  week?: number;
  isDay: boolean;
  label?: string;
}

/** Parse a line as a week or day heading, or null for ordinary text. */
function parseHeading(line: string): Heading | null {
  const t = line.trim();
  if (t === "" || t.length > HEADING_MAX_CHARS) return null;
  if (t.includes("|") || SETS_BY_REPS.test(t)) return null;
  if (!HEADING_START.test(t)) return null;
  const weekMatch = WEEK_NUMBER.exec(t);
  const isDay = DAY_MARK.test(t);
  if (!weekMatch && !isDay) return null;
  let label = t.replace(/^[#*_\s]+/, "").replace(/[#*_\s]+$/, "");
  for (let i = 0; i < 3; i++) label = label.replace(LABEL_PREFIX, "");
  label = label.slice(0, 40).trim();
  const heading: Heading = { isDay };
  if (weekMatch) heading.week = Number(weekMatch[1]);
  if (label !== "") heading.label = label;
  return heading;
}

interface Section {
  week?: number;
  day?: number;
  label?: string;
  heading: string;
  body: string[];
}

function hasContent(s: Section): boolean {
  return s.body.some((l) => l.trim() !== "");
}

/** Split text into parts of at most `budget` characters at blank lines. */
function splitBySize(text: string, budget: number): string[] {
  if (text.length <= budget) return [text];
  const paragraphs = text.split(/\n[ \t]*\n/);
  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= budget) {
      pieces.push(p);
      continue;
    }
    // One huge paragraph (a long table): cut at line breaks, then hard.
    let cur = "";
    for (const line of p.split("\n")) {
      if (line.length > budget) {
        if (cur !== "") pieces.push(cur);
        cur = "";
        for (let i = 0; i < line.length; i += budget) {
          pieces.push(line.slice(i, i + budget));
        }
      } else if (cur.length + line.length + 1 > budget) {
        if (cur !== "") pieces.push(cur);
        cur = line;
      } else {
        cur = cur === "" ? line : `${cur}\n${line}`;
      }
    }
    if (cur !== "") pieces.push(cur);
  }
  const parts: string[] = [];
  let cur = "";
  for (const piece of pieces) {
    if (cur === "") cur = piece;
    else if (cur.length + piece.length + 2 <= budget) cur += `\n\n${piece}`;
    else {
      parts.push(cur);
      cur = piece;
    }
  }
  if (cur !== "") parts.push(cur);
  return parts;
}

function sectionName(s: { week?: number; day?: number }): string {
  const w = s.week !== undefined ? `Week ${s.week}` : "";
  const d = s.day !== undefined ? `Day ${s.day}` : "";
  return [w, d].filter((x) => x !== "").join(" ") || "Document";
}

/**
 * Split document text (MinerU markdown or pdftotext output) into chunks.
 * Never throws and never drops a heading's body; text before the first
 * heading is dropped when the document has headings, and the notes say so.
 */
export function chunkProgramText(
  text: string,
  budget: number = CHUNK_CHARS,
): ChunkedText {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\f/g, "\n\n").split("\n");
  const notes: string[] = [];
  const sections: Section[] = [];
  let preamble = 0;
  let cur: Section | undefined;
  let week = 1;
  let dayOrdinal = 0;
  let sawWeek = false;

  const close = () => {
    if (cur && hasContent(cur)) sections.push(cur);
    cur = undefined;
  };

  for (const line of lines) {
    const h = parseHeading(line);
    // A running page header ("Week 1" at the top of every page) repeats the
    // current week. It is body text, not a new section.
    const repeatedWeek = h !== null && !h.isDay && h.week !== undefined &&
      sawWeek && h.week === week;
    if (h === null || repeatedWeek) {
      if (cur) cur.body.push(line);
      else if (line.trim() !== "") preamble += line.length;
      continue;
    }
    close();
    if (h.week !== undefined) {
      if (h.week !== week || !sawWeek) dayOrdinal = 0;
      week = h.week;
      sawWeek = true;
    }
    if (h.isDay) dayOrdinal += 1;
    cur = {
      week,
      heading: line.trim(),
      body: [],
    };
    if (h.isDay) cur.day = dayOrdinal;
    if (h.label !== undefined) cur.label = h.label;
  }
  close();

  if (sections.length === 0) {
    const parts = splitBySize(text.trim(), budget).filter((p) =>
      p.trim() !== ""
    );
    if (parts.length > 0) {
      notes.push(
        "No week or day headings found. The model assigned the weeks and days itself, so check them in the diff.",
      );
    }
    return {
      chunks: parts.map((p, i) => ({
        text: p,
        name: `Part ${i + 1} of ${parts.length}`,
      })),
      structured: false,
      notes,
    };
  }

  if (preamble > 0) {
    notes.push(
      `Ignored ${preamble} characters before the first week or day heading.`,
    );
  }
  if (!sawWeek) {
    notes.push("No week headings found, so everything is week 1.");
  }

  const chunks: ImportChunk[] = [];
  for (const s of sections) {
    const body = s.body.join("\n").replace(/^\n+|\s+$/g, "");
    const room = Math.max(200, budget - s.heading.length - 1);
    const parts = splitBySize(body, room).filter((p) => p.trim() !== "");
    parts.forEach((p, i) => {
      const chunk: ImportChunk = {
        text: `${s.heading}\n${p}`,
        week: s.week,
        name: parts.length > 1
          ? `${sectionName(s)} (part ${i + 1})`
          : sectionName(s),
      };
      if (s.day !== undefined) chunk.day = s.day;
      if (s.label !== undefined) chunk.label = s.label;
      chunks.push(chunk);
    });
  }
  return { chunks, structured: true, notes };
}

export interface ChunkedImport {
  proposal: ImportProposal;
  /** Chunking notes plus a line for every chunk that gave nothing. */
  notes: string[];
  chunkCount: number;
}

function inRange(n: number | undefined, lo: number, hi: number): boolean {
  return n !== undefined && Number.isInteger(n) && n >= lo && n <= hi;
}

async function ask(
  deps: ImportDeps,
  chunk: ImportChunk,
  attempts: number,
): Promise<{ raw: unknown } | { error: string }> {
  let error = "no attempt made";
  for (let i = 0; i < attempts; i++) {
    try {
      const raw = await deps.transport(
        buildImportPrompt(chunk.text),
        EditListSchema,
      );
      return { raw };
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  return { error };
}

/**
 * Run every chunk through the model, overwrite week and day with the
 * chunker's numbers, merge the lists, then resolve once. Sequential, because
 * there is one model slot. A chunk whose call fails twice fails the import:
 * a program with days silently missing is worse than no program.
 * Never throws.
 */
export async function importChunks(
  chunked: ChunkedText,
  deps: ImportDeps,
  resolutions: Resolutions = {},
  currentProgram = "",
): Promise<ChunkedImport> {
  const notes = [...chunked.notes];
  const fail = (
    status: "invalid" | "degraded",
    message: string,
  ): ChunkedImport => ({
    proposal: {
      status,
      items: [],
      rejected: [],
      confirms: [],
      errors: [message],
    },
    notes,
    chunkCount: chunked.chunks.length,
  });

  if (chunked.chunks.length === 0) return fail("invalid", "no text to import");
  if (chunked.chunks.length > MAX_CHUNKS) {
    return fail(
      "invalid",
      `this document splits into ${chunked.chunks.length} sections and the limit is ${MAX_CHUNKS}; import fewer weeks at a time`,
    );
  }

  const defaultUnit = deps.defaultUnit ?? "lb";
  const items: EditItem[] = [];
  const rejected: RejectedItem[] = [];

  for (let c = 0; c < chunked.chunks.length; c++) {
    const chunk = chunked.chunks[c];
    // The first call failing means the backend is down: do not wait twice.
    // Later calls get one retry, since a single slow reply should not cost
    // the whole document.
    const asked = await ask(deps, chunk, c > 0 ? 2 : 1);
    if ("error" in asked) {
      return fail("degraded", `${chunk.name}: ${asked.error}`);
    }
    const raw = asked.raw;
    const result = validateEditList(raw, defaultUnit);
    for (const r of result.rejected) {
      rejected.push({ ...r, reason: `${chunk.name}: ${r.reason}` });
    }
    if (result.items.length === 0 && result.rejected.length === 0) {
      notes.push(`${chunk.name}: no exercises found.`);
    }
    for (const it of result.items) {
      const item: EditItem = { ...it };
      if (chunk.week !== undefined) item.week = chunk.week;
      if (chunk.day !== undefined) {
        item.day = chunk.day;
        if (chunk.label !== undefined) item.dayLabel = chunk.label;
        else delete item.dayLabel;
      }
      if (
        !inRange(item.week, 1, IMPORT_LIMITS.maxWeeks) ||
        !inRange(item.day, 1, IMPORT_LIMITS.maxDays)
      ) {
        rejected.push({
          index: -1,
          reason: `${chunk.name}: week or day out of range`,
          exercise: item.exercise,
        });
        continue;
      }
      if (items.length >= IMPORT_LIMITS.maxEditListItems) {
        rejected.push({
          index: -1,
          reason: `${chunk.name}: too many items, rest dropped`,
          exercise: item.exercise,
        });
        continue;
      }
      items.push(item);
    }
  }

  if (items.length === 0) {
    return {
      proposal: {
        status: "invalid",
        items: [],
        rejected,
        confirms: [],
        errors: ["the model returned no usable items"],
      },
      notes,
      chunkCount: chunked.chunks.length,
    };
  }
  return {
    proposal: resolveEditList(
      items,
      rejected,
      deps,
      resolutions,
      currentProgram,
    ),
    notes,
    chunkCount: chunked.chunks.length,
  };
}
