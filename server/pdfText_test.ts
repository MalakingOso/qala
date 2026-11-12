// Reshaping MinerU's content list and pdftotext output into chunker input.

import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  cleanPdftotext,
  contentListToMarkdown,
  htmlTableToText,
  MAX_PDF_TEXT_CHARS,
  visibleChars,
} from "./pdfText.ts";

test("content list: headings, lists, tables and captions; chrome is dropped", () => {
  const md = contentListToMarkdown([
    { type: "header", text: "Running header" },
    { type: "text", text: "Program", text_level: 1 },
    { type: "text", text: "Week 1", text_level: 2 },
    { type: "text", text: "Body text line" },
    { type: "list", list_items: ["Squat 3x5", " ", "Row 3x8"] },
    {
      type: "table",
      table_caption: ["Table 1"],
      table_body: "<table><tr><td>A</td><td>B</td></tr></table>",
    },
    { type: "image", image_caption: ["Figure 1: form"], img_path: "" },
    {
      type: "chart",
      chart_caption: ["Volume"],
      content: "| Year | Value |\n| 2021 | 5 |",
    },
    { type: "page_number", text: "7" },
    { type: "footer", text: "footer" },
    { type: "page_footnote", text: "note" },
  ]);
  assert.deepStrictEqual(
    md,
    [
      "# Program",
      "## Week 1",
      "Body text line",
      "- Squat 3x5\n- Row 3x8",
      "Table 1\nA | B",
      "Figure 1: form",
      "Volume",
    ].join("\n\n"),
  );
});

test("content list: malformed input is skipped, never thrown on", () => {
  assert.deepStrictEqual(contentListToMarkdown(null), "");
  assert.deepStrictEqual(contentListToMarkdown({ type: "text" }), "");
  assert.deepStrictEqual(
    contentListToMarkdown([
      null,
      7,
      "x",
      [],
      { type: 5, text: "no" },
      { type: "text", text: 12 },
      { type: "text", text: "kept", text_level: 99 },
      { type: "text", text: "neg", text_level: -3 },
      { type: "list", list_items: "nope" },
      { type: "table", table_body: 4 },
    ]),
    "###### kept\n\nneg",
  );
});

test("content list: output is capped", () => {
  const blocks = Array.from({ length: 2000 }, () => ({
    type: "text",
    text: "x".repeat(1000),
  }));
  assert(contentListToMarkdown(blocks).length <= MAX_PDF_TEXT_CHARS);
});

test("html tables become rows, with entities decoded and tags and scripts stripped", () => {
  const html =
    '<table><tr><th>Lift</th><th colspan="2">Sets &amp; reps</th></tr>' +
    "<tr><td>Squat</td><td>3x5</td><td></td></tr>" +
    "<tr><td>Bench&nbsp;Press<script>alert(1)</script></td><td>3&#x78;8</td><td>&#39;95&#39;</td></tr></table>";
  assert.deepStrictEqual(
    htmlTableToText(html),
    "Lift | Sets & reps\nSquat | 3x5\nBench Press alert(1) | 3x8 | '95'",
  );
  assert.deepStrictEqual(htmlTableToText("not a table"), "not a table");
  assert.deepStrictEqual(htmlTableToText("&#0;&#xD800;&#99999999;"), "&#99999999;");
});

test("pdftotext output: control characters out, column gaps shortened, pages split", () => {
  const raw =
    "Week 1\r\n\tSquat        3x5      135\u0000\u0007\n\n\n\n\nDay 2\fBench 3x8\n";
  assert.deepStrictEqual(
    cleanPdftotext(raw),
    "Week 1\nSquat  3x5  135\n\nDay 2\n\nBench 3x8",
  );
  assert(
    cleanPdftotext("y".repeat(MAX_PDF_TEXT_CHARS + 50)).length <=
      MAX_PDF_TEXT_CHARS,
  );
});

test("visibleChars ignores whitespace and form feeds", () => {
  assert.deepStrictEqual(visibleChars(" \n\f\t "), 0);
  assert.deepStrictEqual(visibleChars(" a b \n c"), 3);
});
