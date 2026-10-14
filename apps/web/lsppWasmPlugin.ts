// Serves the LS++ wasm build to the browser without making the app depend on it.
//
// `deno task build:wasm` writes target/wasm-out/web/ (gitignored). The editor loads it
// at run time from a URL, never through an import Vite or tsc would have to resolve,
// so a checkout that has not built the wasm still typechecks, runs and builds, and the
// editor just runs without LS++ checks.
//
//   dev:    /wasm/dev/* is served straight from the build directory. Building the wasm
//           while Vite runs is enough; reload the page.
//   build:  the files are copied to dist/wasm/<hash>/, where <hash> comes from their
//           content. The service worker caches static files first, so a fixed name
//           would keep serving an old wasm after a rebuild; a new hash is a new URL.
//
// The editor reads the base URL from the compile-time constant __LSPP_WASM_BASE__,
// which is "" when there is nothing to load.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const SRC = fileURLToPath(
  new URL("../../target/wasm-out/web/", import.meta.url),
);
const FILES = ["qala_lspp_wasm.js", "qala_lspp_wasm_bg.wasm"];
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
};

const isBuilt = () => FILES.every((f) => existsSync(SRC + f));

function contentHash(): string {
  const h = createHash("sha256");
  for (const f of FILES) h.update(readFileSync(SRC + f));
  return h.digest("hex").slice(0, 12);
}

export function lsppWasm(): Plugin {
  let outDir = "";
  let hash = "";
  return {
    name: "qala-lspp-wasm",
    config(_, { command }) {
      let base = "/wasm/dev/";
      if (command === "build") {
        hash = isBuilt() ? contentHash() : "";
        base = hash ? `/wasm/${hash}/` : "";
      }
      return { define: { __LSPP_WASM_BASE__: JSON.stringify(base) } };
    },
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use("/wasm/dev/", (req, res, next) => {
        const name = (req.url ?? "").split("?")[0].replace(/^\/+/, "");
        if (!FILES.includes(name) || !isBuilt()) return next();
        const ext = name.slice(name.lastIndexOf("."));
        res.setHeader("Content-Type", TYPES[ext]);
        res.setHeader("Cache-Control", "no-cache");
        res.end(readFileSync(SRC + name));
      });
    },
    writeBundle() {
      if (!hash) {
        this.warn(
          "the LS++ wasm is not built, so the editor will run without its checks. Run `deno task build:wasm` first.",
        );
        return;
      }
      const dest = `${outDir}/wasm/${hash}`;
      mkdirSync(dest, { recursive: true });
      for (const f of FILES) copyFileSync(SRC + f, `${dest}/${f}`);
    },
  };
}
