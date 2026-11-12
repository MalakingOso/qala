// @qala/lspp: typed client over the LS++ wasm build (crates/qala-lspp-wasm).
// The wasm itself is built by `bun run build:wasm` and loaded by the host;
// this package never loads it.

export { createLspp, type Lspp, MAX_LSPP_TEXT_CHARS } from "./client.ts";
export type {
  LsppDiagnostic,
  LsppDryExercise,
  LsppDryRunRequest,
  LsppDryRunResult,
  LsppDrySession,
  LsppDrySet,
  LsppEvalError,
  LsppEvaluatedProgram,
  LsppEvaluateRequest,
  LsppFormatResult,
  LsppLint,
  LsppResult,
  LsppWasm,
  LsppWeight,
} from "./types.ts";
