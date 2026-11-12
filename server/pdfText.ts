// Turning what the PDF readers produce into plain text for the import chunker.
//
// Both inputs are untrusted. MinerU's content list is JSON read from a file
// the adapter wrote from the uploaded PDF, and pdftotext prints whatever the
// PDF says. Nothing here interprets the text; it is reshaped into lines and
// handed to chunkProgramText, and from there only ever to a user message.

/** Cap on text kept from one PDF. A 40-page program is well under 100 000. */
export const MAX_PDF_TEXT_CHARS = 400_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(
    /&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi,
    (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X"
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10);
        return code > 0 && code < 0x110000 &&
            !(code >= 0xd800 && code <= 0xdfff)
          ? String.fromCodePoint(code)
          : " ";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    },
  );
}

/**
 * MinerU writes tables as HTML. Reduce one to a line per row with cells
 * separated by " | ". Row and column spans are not expanded, so a merged
 * header cell appears once.
 */
export function htmlTableToText(html: string): string {
  const rows = html.split(/<\/tr\s*>/i);
  const out: string[] = [];
  for (const row of rows) {
    const cells = row.split(/<\/t[dh]\s*>/i)
      .map((c) =>
        decodeEntities(c.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
      )
      .filter((c, i, all) => c !== "" || i < all.length - 1);
    const line = cells.filter((c) => c !== "").join(" | ");
    if (line !== "") out.push(line);
  }
  return out.join("\n");
}

const SKIPPED_TYPES = new Set([
  "header",
  "footer",
  "page_number",
  "page_footnote",
  "aside_text",
]);

/**
 * Render MinerU's `*_content_list.json` as markdown-ish text: headings keep
 * their `#` level, lists become bullets, tables become `a | b` rows. Running
 * headers, footers and page numbers are dropped. Figures keep only a caption
 * and charts only a caption, since plotted values are not exercise lines.
 */
export function contentListToMarkdown(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const parts: string[] = [];
  let total = 0;
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    const type = typeof block["type"] === "string" ? block["type"] : "";
    if (SKIPPED_TYPES.has(type)) continue;
    const piece: string[] = [];
    if (type === "text") {
      const text = typeof block["text"] === "string"
        ? block["text"].trim()
        : "";
      if (text === "") continue;
      const level = typeof block["text_level"] === "number"
        ? Math.min(6, Math.max(0, Math.floor(block["text_level"])))
        : 0;
      piece.push(level > 0 ? `${"#".repeat(level)} ${text}` : text);
    } else if (type === "list") {
      for (const item of strings(block["list_items"])) {
        const t = item.trim();
        if (t !== "") piece.push(`- ${t}`);
      }
    } else if (type === "table") {
      const caption = strings(block["table_caption"]).join(" ").trim();
      if (caption !== "") piece.push(caption);
      const body = typeof block["table_body"] === "string"
        ? htmlTableToText(block["table_body"])
        : "";
      if (body !== "") piece.push(body);
      const foot = strings(block["table_footnote"]).join(" ").trim();
      if (foot !== "") piece.push(foot);
    } else if (type === "image") {
      const caption = strings(block["image_caption"]).join(" ").trim();
      if (caption !== "") piece.push(caption);
    } else if (type === "chart") {
      const caption = strings(block["chart_caption"]).join(" ").trim();
      if (caption !== "") piece.push(caption);
    }
    if (piece.length === 0) continue;
    const text = piece.join("\n");
    total += text.length + 2;
    if (total > MAX_PDF_TEXT_CHARS) break;
    parts.push(text);
  }
  return parts.join("\n\n");
}

/** Number of characters that are not whitespace, form feeds included. */
export function visibleChars(text: string): number {
  return text.replace(/\s+/g, "").length;
}

/**
 * Tidy `pdftotext -layout` output: control characters out, runs of spaces
 * (column gaps) shortened, page breaks turned into blank lines.
 */
export function cleanPdftotext(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .replace(/\f/g, "\n\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((l) => l.replace(/\t/g, "  ").replace(/ {3,}/g, "  ").trim());
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text.slice(0, MAX_PDF_TEXT_CHARS);
}
