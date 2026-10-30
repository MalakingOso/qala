import { assert, assertEquals } from "@std/assert";
import type { ConfirmItem } from "../../../../packages/llm/importPipeline.ts";
import type {
  EditItem,
  RejectedItem,
} from "../../../../packages/llm/importSchema.ts";
import {
  asSentence,
  checkImportText,
  checkPdf,
  confirmLines,
  describeItem,
  describeReason,
  describeRejected,
  describeSource,
  importFailure,
  MAX_IMPORT_CHARS,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  proposalDiff,
  readProposal,
  sendImportConfirm,
  sendImportPdf,
  sendImportText,
  SKIP,
  unanswered,
} from "./programImport.ts";
import {
  type ImportRouteDeps,
  serveImportText,
} from "../../../../server/import.ts";

interface Seen {
  url: string;
  init: RequestInit;
}

function fakeFetch(
  status: number,
  body: unknown,
  seen: Seen[] = [],
): typeof fetch {
  return ((url: string, init: RequestInit) => {
    seen.push({ url, init });
    return Promise.resolve(
      new Response(
        typeof body === "string" ? body : JSON.stringify(body),
        { status, headers: { "content-type": "application/json" } },
      ),
    );
  }) as typeof fetch;
}

const squat: EditItem = {
  week: 1,
  day: 1,
  dayLabel: "Lower",
  exercise: "Squat",
  sets: 3,
  reps: 5,
  weight: 245,
  unit: "lb",
};
const split: EditItem = {
  week: 1,
  day: 2,
  exercise: "split squat",
  sets: 3,
  reps: 8,
  repsMax: 10,
};

const confirm: ConfirmItem = {
  key: "split squat",
  raw: "split squat",
  reason: "ambiguous",
  candidates: [
    { id: "splitsquat", name: "Split Squat" },
    { id: "bulgariansplitsquat", name: "Bulgarian Split Squat" },
  ],
  itemIndexes: [1],
};

const ready = {
  status: "ready",
  items: [squat],
  rejected: [],
  confirms: [],
  programText: "# Week 1\n## Day 1: Lower\nSquat / 3x5 245lb\n",
  diff: [],
  errors: [],
};

Deno.test("the caps match the routes", () => {
  assertEquals(MAX_IMPORT_CHARS, 12_000);
  assertEquals(MAX_PDF_BYTES, 10 * 1024 * 1024);
  assertEquals(MAX_PDF_PAGES, 40);
});

Deno.test("text: blank and over-long text never leave the page", () => {
  assertEquals(checkImportText("  \n "), "Paste or dictate a program first.");
  assertEquals(checkImportText("Squat 3x5 at 245"), null);
  assertEquals(checkImportText("x".repeat(MAX_IMPORT_CHARS)), null);
  assertEquals(
    checkImportText("x".repeat(MAX_IMPORT_CHARS + 1)),
    "That's 12,001 characters and the limit is 12,000. Import it in parts.",
  );
});

Deno.test("pdf: empty, foreign and oversized files are refused up front", () => {
  const pdf = { name: "plan.pdf", size: 2048, type: "application/pdf" };
  assertEquals(checkPdf(pdf), null);
  assertEquals(checkPdf({ ...pdf, type: "" }), null, "named .pdf is enough");
  assertEquals(
    checkPdf({ ...pdf, name: "plan", type: "application/pdf" }),
    null,
  );
  assertEquals(checkPdf({ ...pdf, size: 0 }), "That file is empty.");
  assertEquals(
    checkPdf({ name: "plan.docx", size: 10, type: "application/msword" }),
    "That file is not a PDF.",
  );
  assertEquals(
    checkPdf({ ...pdf, size: MAX_PDF_BYTES + 1 }),
    "That PDF is larger than 10 MB.",
  );
});

Deno.test("text import posts the text and the unit, nothing else", async () => {
  const seen: Seen[] = [];
  const out = await sendImportText(
    "Squat 3x5 at 245",
    { units: "kg" },
    fakeFetch(200, ready, seen),
  );
  assert(out.ok);
  assertEquals(out.result.proposal.status, "ready");
  assertEquals(out.result.proposal.programText, ready.programText);
  assertEquals(out.result.notes, []);
  assertEquals(out.result.source, undefined);
  assertEquals(seen[0].url, "/api/import/text");
  assertEquals(seen[0].init.method, "POST");
  assertEquals(JSON.parse(String(seen[0].init.body)), {
    text: "Squat 3x5 at 245",
    units: "kg",
  });
});

Deno.test("the confirm step sends the edit list and every answer back", async () => {
  const seen: Seen[] = [];
  const out = await sendImportConfirm(
    [squat, split],
    { "split squat": "bulgariansplitsquat", "lat pull": SKIP },
    { units: "lb" },
    fakeFetch(200, ready, seen),
  );
  assert(out.ok);
  assertEquals(seen[0].url, "/api/import/text");
  const body = JSON.parse(String(seen[0].init.body));
  assertEquals(body, {
    editList: { items: [squat, split] },
    resolutions: { "split squat": "bulgariansplitsquat", "lat pull": "skip" },
    units: "lb",
  });
  assertEquals("text" in body, false, "never text and an edit list together");
});

Deno.test("pdf import sends the raw file with the unit in the query", async () => {
  const seen: Seen[] = [];
  const pdf = new Blob(["%PDF-1.7 ..."], { type: "application/pdf" });
  const out = await sendImportPdf(
    pdf,
    { units: "kg" },
    fakeFetch(200, {
      ...ready,
      source: {
        engine: "pdftotext",
        pages: 2,
        chunks: 3,
        fallback: true,
        notice: "MinerU is switched off, so the text was read with pdftotext.",
      },
      notes: ["MinerU is switched off, so the text was read with pdftotext."],
    }, seen),
  );
  assertEquals(seen[0].url, "/api/import/pdf?units=kg");
  assertEquals(
    new Headers(seen[0].init.headers).get("content-type"),
    "application/pdf",
  );
  assertEquals(seen[0].init.body, pdf);
  assert(out.ok);
  assertEquals(out.result.source?.engine, "pdftotext");
  assertEquals(out.result.source?.fallback, true);
  assertEquals(out.result.notes.length, 1);
});

Deno.test("a 422 proposal is a result to show, not a failure", async () => {
  const out = await sendImportText(
    "Squat",
    { units: "lb" },
    fakeFetch(422, {
      status: "invalid",
      items: [],
      rejected: [{ index: 0, reason: "sets missing or outside 1-30" }],
      confirms: [],
      errors: ["the model returned no usable items"],
    }),
  );
  assert(out.ok);
  assertEquals(out.result.proposal.status, "invalid");
  assertEquals(out.result.proposal.errors, [
    "the model returned no usable items",
  ]);
  assertEquals(out.result.proposal.rejected.length, 1);
});

Deno.test("every degraded and refused answer becomes a plain sentence", async () => {
  const say = async (
    status: number,
    body: unknown,
    route: "text" | "pdf" = "text",
  ) => {
    const f = fakeFetch(status, body);
    const out = route === "text"
      ? await sendImportText("Squat 3x5", { units: "lb" }, f)
      : await sendImportPdf(new Blob(["%PDF-"]), { units: "lb" }, f);
    assert(!out.ok, `${status} is a failure`);
    return out.message;
  };
  assertEquals(
    await say(502, { degraded: true, error: "llama-server timed out" }),
    "The import model is not available right now. Type the program into the editor instead, or try again later.",
  );
  assertEquals(
    await say(413, { error: "text is longer than 12000 characters" }),
    "The text is longer than 12,000 characters. Import it in parts.",
  );
  assertEquals(
    await say(
      413,
      {
        error: "This PDF has 55 pages and the limit is 40. Import it in parts.",
      },
      "pdf",
    ),
    "This PDF has 55 pages and the limit is 40. Import it in parts.",
  );
  assertEquals(
    await say(413, { error: "upload is larger than 10 MB" }, "pdf"),
    "Upload is larger than 10 MB.",
  );
  assertEquals(
    await say(
      503,
      { degraded: true, error: "the program checker is not available" },
      "pdf",
    ),
    "The program checker is not available. Try again later.",
  );
  assertEquals(
    await say(429, { error: "another PDF import is running" }, "pdf"),
    "Another import is running. Try again in a moment.",
  );
  assertEquals(
    await say(408, { error: "the upload stalled" }, "pdf"),
    "The upload took too long. Try again.",
  );
  assertEquals(
    await say(415, { error: "That file is not a PDF." }, "pdf"),
    "That file is not a PDF.",
  );
  assertEquals(
    await say(
      422,
      { error: "This PDF is password protected." },
      "pdf",
    ),
    "This PDF is password protected.",
  );
  assertEquals(
    await say(500, { error: "internal server error" }),
    "The server couldn't run the import (it answered 500).",
  );
  assertEquals(await say(504, "not json"), "The server answered 504.");
  assertEquals(
    await say(200, { hello: "world" }),
    "The server sent an answer the app can't read.",
  );
});

Deno.test("a failed fetch says the server is out of reach", async () => {
  const down = (() => Promise.reject(new TypeError("refused"))) as typeof fetch;
  const out = await sendImportText("Squat", { units: "lb" }, down);
  assertEquals(out, { ok: false, message: "Could not reach the server." });
});

Deno.test("importFailure passes the scan message through", () => {
  const scan =
    "This PDF has no text layer (it looks like a scan), and MinerU, which reads scans, is not available right now. Try again later, or paste the program text instead.";
  assertEquals(importFailure(422, { error: scan, scan: true }, "pdf"), scan);
});

Deno.test("readProposal wants a known status and ready text", () => {
  assertEquals(readProposal({ status: "degraded" }), null);
  assertEquals(readProposal({ status: "ready", items: [] }), null);
  const p = readProposal({ status: "needs_confirm", confirms: [confirm] });
  assertEquals(p?.items, []);
  assertEquals(p?.confirms.length, 1);
  assertEquals(p?.errors, []);
});

Deno.test("a question counts as answered by a candidate or by skip", () => {
  assertEquals(unanswered([confirm], {}), 1);
  assertEquals(unanswered([confirm], { "split squat": "squat" }), 1);
  assertEquals(unanswered([confirm], { "split squat": "splitsquat" }), 0);
  assertEquals(unanswered([confirm], { "split squat": SKIP }), 0);
  const unknown: ConfirmItem = {
    ...confirm,
    key: "zercher thing",
    reason: "unknown",
    candidates: [],
  };
  assertEquals(unanswered([confirm, unknown], { "split squat": SKIP }), 1);
  assertEquals(
    unanswered([confirm, unknown], {
      "split squat": SKIP,
      "zercher thing": SKIP,
    }),
    0,
  );
});

Deno.test("questions say why and show the lines they decide", () => {
  assertEquals(describeReason(confirm), "Could be more than one exercise.");
  assertEquals(
    describeReason({ ...confirm, reason: "close" }),
    "Not in the exercise list. These are close.",
  );
  assert(
    describeReason({ ...confirm, reason: "unknown", candidates: [] })
      .startsWith("Not in the exercise list, and nothing is close."),
  );
  assertEquals(confirmLines(confirm, [squat, split]), {
    lines: ["Week 1, day 2: 3x8-10, weight set on the first workout"],
    more: 0,
  });
  const many = { ...confirm, itemIndexes: [0, 1, 0, 1, 7] };
  const shown = confirmLines(many, [squat, split], 3);
  assertEquals(shown.lines.length, 3);
  assertEquals(shown.more, 1, "an index past the list is dropped");
});

Deno.test("an edit-list line reads the way the owner wrote it", () => {
  assertEquals(
    describeItem(squat),
    "Week 1, day 1 (Lower): 3x5, 245 lb",
  );
  assertEquals(
    describeItem({ ...squat, amrap: true, rpe: 8, unit: undefined }),
    "Week 1, day 1 (Lower): 3x5+, 245 lb, RPE 8",
  );
});

Deno.test("rejected lines name the exercise when the reply had one", () => {
  const r: RejectedItem = { index: 4, reason: "weight above 2000lb" };
  assertEquals(describeRejected(r), "Line 5: weight above 2000lb");
  assertEquals(
    describeRejected({ ...r, exercise: "Squat" }),
    "Squat: weight above 2000lb",
  );
  assertEquals(
    describeRejected({ index: -1, reason: "response is not an edit list" }),
    "The model's reply: response is not an edit list",
  );
});

Deno.test("the PDF source line counts pages and parts", () => {
  assertEquals(
    describeSource({ engine: "mineru", pages: 1, chunks: 1, fallback: false }),
    "Read with MinerU, 1 page in 1 part.",
  );
  assertEquals(
    describeSource({
      engine: "pdftotext",
      pages: 3,
      chunks: 2,
      fallback: true,
    }),
    "Read with pdftotext, 3 pages in 2 parts.",
  );
});

Deno.test("the diff is against the editor as it is now", () => {
  const d = proposalDiff(
    "# Week 1\n## Day 1\nSquat / 3x5 225lb\n",
    "# Week 1\n## Day 1\nSquat / 3x5 245lb\n",
  );
  assertEquals(d.added, 1);
  assertEquals(d.removed, 1);
  assertEquals(d.lines[0], { op: "keep", text: "# Week 1" });
  assertEquals(proposalDiff("", "a\nb\n").added, 2);
});

Deno.test("server fragments become sentences", () => {
  assertEquals(asSentence("the upload stalled"), "The upload stalled.");
  assertEquals(asSentence("Already one."), "Already one.");
  assertEquals(asSentence(""), "");
});

// The client against the real route handler (server/import.ts), with a fake
// model and a small catalog, so a request the route can't read fails here.
Deno.test("a whole round trip through the real text route", async () => {
  const catalog = [
    { id: "squat", name: "Squat" },
    { id: "splitSquat", name: "Split Squat" },
    { id: "bulgarianSplitSquat", name: "Bulgarian Split Squat" },
  ];
  const deps: ImportRouteDeps = {
    transport: () =>
      Promise.resolve({
        items: [
          { day: 1, exercise: "Squat", sets: 3, reps: 5, weight: 245 },
          { day: 1, exercise: "split squat", sets: 3, reps: 8, repsMax: 10 },
        ],
      }),
    catalog,
    validatorFor: () => () => [],
  };
  const route: typeof fetch = (input, init) =>
    serveImportText(
      new Request(new URL(String(input), "http://localhost"), init),
      deps,
    );

  const first = await sendImportText(
    "Squat 3x5 at 245",
    { units: "lb" },
    route,
  );
  assert(first.ok);
  const p = first.result.proposal;
  assertEquals(p.status, "needs_confirm");
  assertEquals(p.confirms.map((c) => c.raw), ["split squat"]);

  const key = p.confirms[0].key;
  const done = await sendImportConfirm(
    p.items,
    { [key]: "bulgarianSplitSquat" },
    { units: "lb" },
    route,
  );
  assert(done.ok, done.ok ? "" : done.message);
  assertEquals(done.result.proposal.status, "ready");
  assertEquals(
    done.result.proposal.programText,
    "# Week 1\n## Day 1\nSquat / 3x5 245lb\nBulgarian Split Squat / 3x8-10 ?+\n",
  );

  const skipped = await sendImportConfirm(
    p.items,
    { [key]: SKIP },
    { units: "lb" },
    route,
  );
  assert(skipped.ok);
  assertEquals(
    skipped.result.proposal.programText,
    "# Week 1\n## Day 1\nSquat / 3x5 245lb\n",
  );
});
