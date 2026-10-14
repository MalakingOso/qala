/* Loads the LS++ wasm for the desktop editor, the first time something asks.
 * Nothing at start-up touches it. The build is fetched by URL (apps/web/
 * lsppWasmPlugin.ts serves it in dev and copies it into dist), so a checkout
 * without the wasm still builds and the editor just runs without the checks:
 * every failure resolves to null. */

import {
  createLspp,
  type Lspp,
  type LsppWasm,
} from "../../../../packages/lspp/mod.ts";

/** "" when the wasm was not built when Vite started. Set by the plugin. */
declare const __LSPP_WASM_BASE__: string;

type Glue = LsppWasm & {
  default(init: { module_or_path: string }): Promise<unknown>;
};

let loading: Promise<Lspp | null> | undefined;

/** The editor's LS++ instance, or null when the wasm is missing or fails to start. */
export function loadLspp(): Promise<Lspp | null> {
  loading ??= (async () => {
    const base = __LSPP_WASM_BASE__;
    if (!base) return null;
    try {
      const glue: Glue = await import(
        /* @vite-ignore */ `${base}qala_lspp_wasm.js`
      );
      await glue.default({ module_or_path: `${base}qala_lspp_wasm_bg.wasm` });
      return createLspp(glue);
    } catch {
      return null;
    }
  })();
  return loading;
}
