// Typed calls over the LS++ wasm JSON boundary. Runtime-neutral: the caller loads
// and initialises the wasm (Vite in apps/web, Bun in server/) and hands the module
// in. Every call returns a value and never throws. A wasm trap (the release build
// aborts on a panic) marks the client dead, so later calls fail fast with that reason.

import type {
  LsppDiagnostic,
  LsppDryRunRequest,
  LsppDryRunResult,
  LsppEvaluatedProgram,
  LsppEvaluateRequest,
  LsppFormatResult,
  LsppLint,
  LsppResult,
  LsppWasm,
} from "./types.ts";

/**
 * Longest program text the client hands to the wasm. A program is a few KB; the cap
 * keeps a pasted file from holding the main thread, since the wasm runs synchronously.
 */
export const MAX_LSPP_TEXT_CHARS = 200_000;

const ENVELOPE_VERSION = 1;

export interface Lspp {
  /** Syntax errors in planner text, with line, column and a fix suggestion where there is one. */
  diagnose(text: string): LsppResult<LsppDiagnostic[]>;
  /** Warnings for text that parses. Empty when the text has syntax errors. */
  lint(text: string): LsppResult<LsppLint[]>;
  /** One canonical form for the text, or the reason it was left alone. */
  format(text: string): LsppResult<LsppFormatResult>;
  /** What the next sessions look like if every set is hit. Read-only. */
  dryRun(request: LsppDryRunRequest): LsppResult<LsppDryRunResult>;
  /** Evaluates planner text; evaluation problems come back in `errors`. */
  evaluateText(request: LsppEvaluateRequest): LsppResult<LsppEvaluatedProgram>;
  /** Converts a Qala core settings object to the settings `dryRun` and `evaluateText` take. */
  settingsFromCore(coreSettings: unknown): LsppResult<unknown>;
}

function fail<T>(kind: string, message: string): LsppResult<T> {
  return { ok: false, kind, message };
}

function tooLarge<T>(text: string): LsppResult<T> | null {
  return text.length > MAX_LSPP_TEXT_CHARS
    ? fail(
      "tooLarge",
      `program text is longer than ${MAX_LSPP_TEXT_CHARS} characters`,
    )
    : null;
}

export function createLspp(wasm: LsppWasm): Lspp {
  let dead: { kind: string; message: string } | null = null;

  /** Runs one wasm call and unwraps its envelope. */
  function call<T>(run: () => string): LsppResult<T> {
    if (dead) return fail(dead.kind, dead.message);
    let raw: string;
    try {
      raw = run();
    } catch (e) {
      dead = {
        kind: "trap",
        message: `the LS++ wasm stopped: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
      return fail(dead.kind, dead.message);
    }
    let env: {
      v?: unknown;
      result?: T;
      error?: { kind?: string; message?: string };
    };
    try {
      env = JSON.parse(raw);
    } catch {
      return fail(
        "badEnvelope",
        "the LS++ wasm returned something that is not JSON",
      );
    }
    if (env.v !== ENVELOPE_VERSION) {
      return fail(
        "badEnvelope",
        `unexpected envelope version ${String(env.v)}`,
      );
    }
    if (env.error) {
      return fail(
        env.error.kind ?? "error",
        env.error.message ?? "the LS++ wasm reported an error",
      );
    }
    return { ok: true, value: env.result as T };
  }

  const request = (body: Record<string, unknown>) =>
    JSON.stringify({ v: ENVELOPE_VERSION, ...body });

  return {
    diagnose: (text) =>
      tooLarge<LsppDiagnostic[]>(text) ??
        call(() => wasm.diagnosePlanner(text)),
    lint: (text) =>
      tooLarge<LsppLint[]>(text) ?? call(() => wasm.lintPlanner(text)),
    format: (text) =>
      tooLarge<LsppFormatResult>(text) ?? call(() => wasm.formatPlanner(text)),
    dryRun: (r) =>
      tooLarge<LsppDryRunResult>(r.programText) ??
        call(() =>
          wasm.dryRun(request({
            programText: r.programText,
            name: r.name ?? "Program",
            settings: r.settings,
            fromDay: r.fromDay,
            sessions: r.sessions,
            throughWeek: r.throughWeek,
          }))
        ),
    evaluateText: (r) =>
      tooLarge<LsppEvaluatedProgram>(r.programText) ??
        call(() =>
          wasm.forceEvaluateText(request({
            programText: r.programText,
            name: r.name,
            settings: r.settings,
          }))
        ),
    settingsFromCore: (coreSettings) =>
      call(() => wasm.qalaSettingsToLiftoscript(request({ coreSettings }))),
  };
}
