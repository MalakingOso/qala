// Qala server (docs/PLAN.md section 7): one Bun process on 127.0.0.1:8500.
// /api/llm proxy to llama-server, the import and coach routes,
// self-hosted map tiles, DEM elevation, and the built PWA.

import { assertLoopbackBind, AuthError, authErrorResponse } from "./auth.ts";
import { serveCoachAsk } from "./coach.ts";
import { lookupElevation } from "./elevation.ts";
import { importDepsOnce, serveImportText } from "./import.ts";
import { serveImportPdf } from "./importPdf.ts";
import { llmBaseUrl, serveLlmChat } from "./llm.ts";
import { serveStatic } from "./static.ts";
import { createTilesHandler } from "./tiles.ts";
import { serveTranscribe } from "./transcribe.ts";

export const BIND_HOSTNAME = "127.0.0.1";
export const BIND_PORT = 8500;

export interface ServerOptions {
  dataRoot: string;
  distDir: string;
  tilesDir: string;
  demDir: string;
  llmBaseUrl: string;
}

export function defaultOptions(): ServerOptions {
  const here = import.meta.dir;
  return {
    dataRoot: `${here}/data`,
    distDir: `${here}/../apps/web/dist`,
    tilesDir: `${here}/../tiles`,
    demDir: `${here}/data/dem`,
    llmBaseUrl: llmBaseUrl(),
  };
}

export interface ServerState {
  options: ServerOptions;
}

export function createState(options: ServerOptions): ServerState {
  return { options };
}

async function handleElevation(
  req: Request,
  demDir: string,
): Promise<Response> {
  if (req.method !== "GET") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return Response.json({ error: "lat and lon are required" }, {
      status: 400,
    });
  }
  const elevationM = await lookupElevation(lat, lon, demDir);
  return Response.json({ lat, lon, elevationM });
}

/** Build the request handler. Exported for tests; see `startServer` to run. */
export function createHandler(
  state: ServerState,
): (req: Request) => Promise<Response> {
  const handleTiles = createTilesHandler(state.options.tilesDir);
  return async function handler(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const path = url.pathname;
      if (
        req.method === "GET" && (path === "/health" || path === "/api/health")
      ) {
        return Response.json({ ok: true });
      }
      if (path === "/api/llm/chat") {
        return await serveLlmChat(req, state.options.llmBaseUrl);
      }
      if (path === "/api/coach/ask") {
        return await serveCoachAsk(req, { baseUrl: state.options.llmBaseUrl });
      }
      if (path === "/api/import/text") {
        const deps = await importDepsOnce(state.options.llmBaseUrl);
        return await serveImportText(req, deps);
      }
      if (path === "/api/import/pdf") return await serveImportPdf(req, state);
      if (path === "/api/transcribe") return await serveTranscribe(req);
      if (path === "/api/elevation") {
        return await handleElevation(req, state.options.demDir);
      }
      if (path === "/tiles" || path.startsWith("/tiles/")) {
        return await handleTiles(req);
      }
      return await serveStatic(req, state.options.distDir);
    } catch (err) {
      if (err instanceof AuthError) return authErrorResponse(err);
      return Response.json({ error: "internal server error" }, { status: 500 });
    }
  };
}

/**
 * Start the server. Refuses non-loopback binds before listening (same rule
 * as Beamer's sync server): Tailscale serves this port to the tailnet.
 */
export function startServer(
  options: ServerOptions = defaultOptions(),
  bind: { hostname?: string; port?: number } = {},
): Bun.Server<undefined> {
  const hostname = bind.hostname ?? BIND_HOSTNAME;
  const port = bind.port ?? BIND_PORT;
  assertLoopbackBind(hostname);
  const state = createState(options);
  return Bun.serve({
    hostname,
    port,
    fetch: createHandler(state),
    // MinerU waits up to 240 s on a PDF import; Bun's default idle timeout is 10 s.
    idleTimeout: 255,
    development: false,
    error: () => Response.json({ error: "internal server error" }, { status: 500 }),
  });
}

if (import.meta.main) {
  startServer();
}
