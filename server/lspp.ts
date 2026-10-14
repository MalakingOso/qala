// The LS++ wasm build (crates/qala-lspp-wasm) loaded once for the server.
// `deno task build:wasm` writes target/wasm-out/web/; this module reads the same
// files the desktop editor ships. Nothing here runs until a caller asks, so a
// server started before the build still serves every other route.

import {
  createLspp,
  type Lspp,
  type LsppDiagnostic,
  type LsppFormatResult,
  type LsppResult,
  type LsppWasm,
} from "../packages/lspp/mod.ts";

/** Where `scripts/build_wasm.sh` puts the build. */
export const WASM_DIR = new URL("../target/wasm-out/web/", import.meta.url);

/** Shape of the wasm-bindgen web glue: its default export instantiates the module. */
type Glue = LsppWasm & {
  default(init: { module_or_path: Uint8Array }): Promise<unknown>;
};

/** Thrown when the wasm is missing or fails to instantiate. */
export class LsppUnavailableError extends Error {
  constructor(detail: string) {
    super(`LS++ wasm unavailable: ${detail}. Run \`deno task build:wasm\`.`);
    this.name = "LsppUnavailableError";
  }
}

/** Loads and instantiates the build in `dir`. Not cached; see `loadLspp`. */
export async function loadLsppFrom(dir: URL): Promise<Lspp> {
  let glue: Glue;
  let bytes: Uint8Array;
  try {
    bytes = await Deno.readFile(new URL("qala_lspp_wasm_bg.wasm", dir));
    glue = await import(new URL("qala_lspp_wasm.js", dir).href);
    await glue.default({ module_or_path: bytes });
  } catch (e) {
    throw new LsppUnavailableError(e instanceof Error ? e.message : String(e));
  }
  return createLspp(glue);
}

let loading: Promise<Lspp> | undefined;

/**
 * The server's one LS++ instance. The first call loads the wasm and every later
 * call shares it. A failed load is not remembered, so building the wasm while the
 * server runs is enough for the next call to succeed.
 */
export function loadLspp(): Promise<Lspp> {
  loading ??= loadLsppFrom(WASM_DIR).catch((e) => {
    loading = undefined;
    throw e;
  });
  return loading;
}

function unavailable<T>(e: unknown): LsppResult<T> {
  return {
    ok: false,
    kind: "unavailable",
    message: e instanceof Error ? e.message : String(e),
  };
}

/** Syntax errors in planner text, each with line, column and a fix suggestion where there is one. */
export async function diagnostics(
  text: string,
): Promise<LsppResult<LsppDiagnostic[]>> {
  try {
    return (await loadLspp()).diagnose(text);
  } catch (e) {
    return unavailable(e);
  }
}

/** The canonical form of planner text, or why it was left alone. */
export async function fmt(
  text: string,
): Promise<LsppResult<LsppFormatResult>> {
  try {
    return (await loadLspp()).format(text);
  } catch (e) {
    return unavailable(e);
  }
}
