// POST /api/import/text (DECISIONS S19). The model fills a fixed edit-list
// schema, code matches exercises and emits LS++ text, the evaluator checks
// it, and the owner confirms a diff. This route writes nothing.
//
// Two request shapes, same endpoint:
//   { text, units?, currentProgram? }                       ask the model
//   { editList, resolutions?, units?, currentProgram? }     no model call; the
//       owner's answers to the confirm items from the first response
// The edit list in the second shape came from the client, so it is validated
// again exactly like model output.

import {
  type CatalogEntry,
  type ChatMessage,
  type ChatTransport,
  IMPORT_LIMITS,
  type ImportDeps,
  type ImportProposal,
  importText,
  type JsonSchema,
  MAX_IMPORT_CHARS,
  type Resolutions,
  resolveEditList,
  validateEditList,
  type WeightUnit,
} from "../packages/llm/mod.ts";
import type { LsppDiagnostic, LsppEvalError } from "../packages/lspp/mod.ts";
import exercises from "../crates/qala-lspp/data/exercises.json" with {
  type: "json",
};
import { readTextCapped } from "./body.ts";
import {
  jsonSchemaFormat,
  LLAMA_DEFAULTS,
  proxyChatCompletions,
} from "./llm.ts";
import { loadLspp } from "./lspp.ts";

/**
 * Request body cap. The text cap is MAX_IMPORT_CHARS; this guards the JSON,
 * which for the confirm step carries a whole edit list (up to
 * IMPORT_LIMITS.maxEditListItems items from a PDF import).
 */
export const MAX_IMPORT_BODY_BYTES = 256 * 1024;

/** Everything the route needs from outside, so tests can inject fakes. */
export interface ImportRouteDeps {
  transport: ChatTransport;
  catalog: readonly CatalogEntry[];
  /** Builds the evaluator check for the owner's weight unit. */
  validatorFor: (units: WeightUnit) => (programText: string) => string[];
}

/**
 * ChatTransport backed by the shared llama-server. Throws on a degraded
 * backend or unparseable reply; importText turns that into "degraded".
 */
export function llamaTransport(
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
): ChatTransport {
  return async (messages: ChatMessage[], schema: JsonSchema) => {
    const result = await proxyChatCompletions(
      {
        messages,
        baseUrl,
        model: LLAMA_DEFAULTS.model,
        responseFormat: jsonSchemaFormat("edit_list", schema),
      },
      fetchFn,
    );
    if (!result.ok) throw new Error(result.error);
    const content = (result.data as {
      choices?: { message?: { content?: unknown } }[];
    })?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("model reply had no content");
    }
    try {
      return JSON.parse(content);
    } catch {
      throw new Error("model reply was not JSON");
    }
  };
}

/** One line per syntax error line (the parser reports several marks on one broken line). */
export function describeSyntaxErrors(
  diagnostics: readonly LsppDiagnostic[],
  max = 5,
): string[] {
  const seen = new Set<number>();
  const out: string[] = [];
  for (const d of diagnostics) {
    if (seen.has(d.line)) continue;
    seen.add(d.line);
    out.push(
      `syntax error at line ${d.line}, column ${d.col}: ${d.message}${
        d.suggestion ? ` (${d.suggestion})` : ""
      }`,
    );
  }
  return out.length > max
    ? [...out.slice(0, max), `and ${out.length - max} more lines with errors`]
    : out;
}

/** The evaluator reports bad programs in `errors`, it does not throw. */
export function describeEvalError(e: LsppEvalError): string {
  const d = e.error.details;
  return `${d.type ?? "error"} at line ${e.error.line} of day ${e.dayData.day}${
    d.subject ? ` (${d.subject})` : ""
  }`;
}

/**
 * Live deps: the real exercise catalog and the real LS++ evaluator, which is the
 * wasm build (server/lspp.ts). Throws if the wasm is not built; the catalog is
 * the exercise list the Rust crate embeds (crates/qala-lspp/data/exercises.json).
 */
export async function liveImportDeps(
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<ImportRouteDeps> {
  const { createBaselineDocument } = await import("../packages/core/mod.ts");
  const lspp = await loadLspp();
  const catalog: CatalogEntry[] = exercises.exercises.map((e) => ({
    id: e.id,
    name: e.name,
  }));
  return {
    transport: llamaTransport(baseUrl, fetchFn),
    catalog,
    validatorFor: (units) => {
      const core = createBaselineDocument().settings;
      core.units = { ...core.units, weight: units };
      const settings = lspp.settingsFromCore(core);
      // A wasm failure throws, so the pipeline reports "validator failed"
      // instead of passing the program unchecked.
      return (programText) => {
        if (!settings.ok) throw new Error(settings.message);
        const syntax = lspp.diagnose(programText);
        if (!syntax.ok) throw new Error(syntax.message);
        if (syntax.value.length > 0) return describeSyntaxErrors(syntax.value);
        const program = lspp.evaluateText({
          programText,
          name: "import",
          settings: settings.value,
        });
        if (!program.ok) throw new Error(program.message);
        return program.value.errors.map(describeEvalError);
      };
    },
  };
}

const depsByUrl = new Map<string, Promise<ImportRouteDeps>>();

/**
 * `liveImportDeps`, built on first use and shared after that. A failed build (the
 * LS++ wasm not built yet) is forgotten, so the next request tries again.
 */
export function importDepsOnce(
  baseUrl: string,
  build: (baseUrl: string) => Promise<ImportRouteDeps> = liveImportDeps,
): Promise<ImportRouteDeps> {
  let deps = depsByUrl.get(baseUrl);
  if (!deps) {
    deps = build(baseUrl).catch((err) => {
      depsByUrl.delete(baseUrl);
      console.error(
        "import: could not load the evaluator:",
        err instanceof Error ? err.message : err,
      );
      throw err;
    });
    depsByUrl.set(baseUrl, deps);
  }
  return deps;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseResolutions(v: unknown): Resolutions {
  const out: Resolutions = {};
  if (!isRecord(v)) return out;
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "string") out[k] = val;
  }
  return out;
}

function statusCode(p: ImportProposal): number {
  switch (p.status) {
    case "degraded":
      return 502;
    case "invalid":
      return 422;
    default:
      return 200;
  }
}

/** Serve POST /api/import/text. Never throws, never persists anything. */
export async function serveImportText(
  req: Request,
  deps: ImportRouteDeps,
): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }
  const read = await readTextCapped(req, MAX_IMPORT_BODY_BYTES);
  if (!read.ok) {
    return Response.json({ error: read.error }, { status: read.status });
  }
  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!isRecord(body)) {
    return Response.json({ error: "body must be an object" }, { status: 400 });
  }
  const units: WeightUnit = body["units"] === "kg" ? "kg" : "lb";
  const currentProgram = typeof body["currentProgram"] === "string"
    ? body["currentProgram"].slice(0, MAX_IMPORT_BODY_BYTES)
    : "";
  const resolutions = parseResolutions(body["resolutions"]);
  const validateProgram = deps.validatorFor(units);
  const importDeps: ImportDeps = {
    transport: deps.transport,
    catalog: deps.catalog,
    validateProgram,
    defaultUnit: units,
  };

  let proposal: ImportProposal;
  if (typeof body["text"] === "string") {
    if (body["text"].length > MAX_IMPORT_CHARS) {
      return Response.json(
        { error: `text is longer than ${MAX_IMPORT_CHARS} characters` },
        { status: 413 },
      );
    }
    proposal = await importText(
      body["text"],
      importDeps,
      resolutions,
      currentProgram,
    );
  } else if (body["editList"] !== undefined) {
    const { items, rejected } = validateEditList(
      body["editList"],
      units,
      IMPORT_LIMITS.maxEditListItems,
    );
    proposal = items.length === 0
      ? {
        status: "invalid",
        items: [],
        rejected,
        confirms: [],
        errors: ["the edit list has no usable items"],
      }
      : resolveEditList(
        items,
        rejected,
        importDeps,
        resolutions,
        currentProgram,
      );
  } else {
    return Response.json(
      { error: "text or editList is required" },
      { status: 400 },
    );
  }

  if (proposal.status === "degraded") {
    return Response.json(
      { degraded: true, error: proposal.errors.join("; ") },
      { status: 502 },
    );
  }
  return Response.json(proposal, { status: statusCode(proposal) });
}
