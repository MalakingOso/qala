// Text import pipeline (DECISIONS S19):
//   source text -> model fills the edit-list schema -> code validates ->
//   code matches exercises (ambiguous ones become confirm items) ->
//   code emits LS++ text -> evaluator check -> diff for the owner.
//
// The model proposes, the owner confirms. Nothing here writes anywhere.
// Transport and program validation are injected, so this package stays free
// of network and liftoscript dependencies.

import { diffLines, emitProgram } from "./importEmit.ts";
import type { DiffLine, ResolvedItem } from "./importEmit.ts";
import { matchExercise, nameKey } from "./importMatch.ts";
import type { CatalogEntry, ConfirmReason } from "./importMatch.ts";
import { buildImportPrompt, MAX_IMPORT_CHARS } from "./importPrompt.ts";
import { EditListSchema, validateEditList } from "./importSchema.ts";
import type { EditItem, RejectedItem, WeightUnit } from "./importSchema.ts";
import type { ChatTransport } from "./prompts.ts";

export interface ImportDeps {
  /** Chat transport. Receives messages plus the edit-list schema. */
  transport: ChatTransport;
  catalog: readonly CatalogEntry[];
  /** Returns evaluator error messages; empty means the program is valid. */
  validateProgram: (programText: string) => string[];
  /** Unit assumed when the source gives a weight without one. */
  defaultUnit?: WeightUnit;
}

/** A name the owner has to decide on before anything is emitted. */
export interface ConfirmItem {
  /** Stable key, shared by every item with the same name. */
  key: string;
  /** The name as the source wrote it. */
  raw: string;
  reason: ConfirmReason;
  candidates: CatalogEntry[];
  /** Indices into `items`. */
  itemIndexes: number[];
}

/** key -> catalog id, or "skip" to drop those lines. */
export type Resolutions = Record<string, string>;

export type ImportStatus = "ready" | "needs_confirm" | "invalid" | "degraded";

export interface ImportProposal {
  status: ImportStatus;
  items: EditItem[];
  rejected: RejectedItem[];
  confirms: ConfirmItem[];
  /** Present only when status is "ready". */
  programText?: string;
  /** Present only when status is "ready". */
  diff?: DiffLine[];
  /** Why the status is "invalid" or "degraded". */
  errors: string[];
}

function emptyProposal(status: ImportStatus, errors: string[]): ImportProposal {
  return { status, items: [], rejected: [], confirms: [], errors };
}

/**
 * Match, apply the owner's resolutions, emit and check. No model call, so
 * it is also the second step of the confirm round trip.
 */
export function resolveEditList(
  items: readonly EditItem[],
  rejected: readonly RejectedItem[],
  deps: Pick<ImportDeps, "catalog" | "validateProgram">,
  resolutions: Resolutions = {},
  currentProgram = "",
): ImportProposal {
  const byId = new Map(deps.catalog.map((e) => [e.id, e]));
  const resolved: ResolvedItem[] = [];
  const confirms = new Map<string, ConfirmItem>();

  items.forEach((item, index) => {
    const key = nameKey(item.exercise);
    const choice = resolutions[key];
    if (choice === "skip") return;
    if (choice !== undefined) {
      const entry = byId.get(choice);
      if (entry) {
        resolved.push({ item, name: entry.name });
        return;
      }
      // An id that is not in the catalog is not a resolution. Ask again.
    }
    const m = matchExercise(item.exercise, deps.catalog);
    if (m.kind === "match") {
      resolved.push({ item, name: m.entry.name });
      return;
    }
    const existing = confirms.get(key);
    if (existing) existing.itemIndexes.push(index);
    else {
      confirms.set(key, {
        key,
        raw: item.exercise,
        reason: m.reason,
        candidates: m.candidates,
        itemIndexes: [index],
      });
    }
  });

  const base = {
    items: [...items],
    rejected: [...rejected],
    confirms: [...confirms.values()],
  };
  if (base.confirms.length > 0) {
    return { ...base, status: "needs_confirm", errors: [] };
  }
  if (resolved.length === 0) {
    return {
      ...base,
      status: "invalid",
      errors: ["no usable exercises found in the text"],
    };
  }
  // Keep source order inside each day.
  const programText = emitProgram(resolved);
  const errors = safeValidate(deps.validateProgram, programText);
  if (errors.length > 0) {
    return { ...base, status: "invalid", errors };
  }
  return {
    ...base,
    status: "ready",
    programText,
    diff: diffLines(currentProgram, programText),
    errors: [],
  };
}

function safeValidate(
  validate: (text: string) => string[],
  text: string,
): string[] {
  try {
    return validate(text);
  } catch (err) {
    return [`validator failed: ${err instanceof Error ? err.message : err}`];
  }
}

/**
 * Full text import: ask the model, validate its edit list, then resolve.
 * Never throws. A down or slow backend yields status "degraded" so the
 * caller can fall back to manual entry.
 */
export async function importText(
  text: string,
  deps: ImportDeps,
  resolutions: Resolutions = {},
  currentProgram = "",
): Promise<ImportProposal> {
  if (text.trim() === "") return emptyProposal("invalid", ["text is empty"]);
  if (text.length > MAX_IMPORT_CHARS) {
    return emptyProposal("invalid", [
      `text is longer than ${MAX_IMPORT_CHARS} characters`,
    ]);
  }
  let raw: unknown;
  try {
    raw = await deps.transport(buildImportPrompt(text), EditListSchema);
  } catch (err) {
    return emptyProposal("degraded", [
      err instanceof Error ? err.message : String(err),
    ]);
  }
  const { items, rejected } = validateEditList(raw, deps.defaultUnit ?? "lb");
  if (items.length === 0) {
    return {
      ...emptyProposal("invalid", ["the model returned no usable items"]),
      rejected,
    };
  }
  return resolveEditList(items, rejected, deps, resolutions, currentProgram);
}
