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
import {
  jsonSchemaFormat,
  LLAMA_DEFAULTS,
  proxyChatCompletions,
} from "./llm.ts";

/** Request body cap. The text cap is MAX_IMPORT_CHARS; this guards the JSON. */
export const MAX_IMPORT_BODY_BYTES = 64 * 1024;

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

/** Live deps: the real exercise catalog and the real LS++ evaluator. */
export async function liveImportDeps(
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<ImportRouteDeps> {
  const { allExercisesList } = await import(
    "../packages/liftoscript/src/models/exercise.ts"
  );
  const { forceEvaluateText, qalaSettingsToLiftoscript } = await import(
    "../packages/liftoscript/mod.ts"
  );
  const { createBaselineDocument } = await import("../packages/core/mod.ts");
  const catalog: CatalogEntry[] = Object.values(allExercisesList).map((e) => ({
    id: e.id,
    name: e.name,
  }));
  return {
    transport: llamaTransport(baseUrl, fetchFn),
    catalog,
    validatorFor: (units) => (programText) => {
      const core = createBaselineDocument().settings;
      core.units = { ...core.units, weight: units };
      const program = forceEvaluateText(
        programText,
        "import",
        qalaSettingsToLiftoscript(core),
      );
      // The evaluator reports bad programs in `errors`, it does not throw.
      return program.errors.map((e) => {
        const d = e.error.details as { type?: string; subject?: string };
        return `${
          d.type ?? "error"
        } at line ${e.error.line} of day ${e.dayData.day}${
          d.subject ? ` (${d.subject})` : ""
        }`;
      });
    },
  };
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
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_IMPORT_BODY_BYTES) {
    return Response.json({ error: "request body too large" }, { status: 413 });
  }
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ error: "could not read body" }, { status: 400 });
  }
  if (raw.length > MAX_IMPORT_BODY_BYTES) {
    return Response.json({ error: "request body too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
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
    const { items, rejected } = validateEditList(body["editList"], units);
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
