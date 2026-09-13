// Qala server (PLAN.md section 7): one Deno 2 process on 127.0.0.1:8500.
// Automerge-repo sync over WebSocket, /api/llm proxy to llama-server,
// self-hosted map tiles, DEM elevation, and the built PWA.

import type { PeerId } from "@automerge/automerge-repo";
import {
  assertLoopbackBind,
  AuthError,
  authErrorResponse,
  checkWsUpgrade,
  requireDocOwnership,
} from "./auth.ts";
import { lookupElevation } from "./elevation.ts";
import { LLAMA_DEFAULTS, serveLlmChat } from "./llm.ts";
import { serveStatic } from "./static.ts";
import { UserSyncStore } from "./sync.ts";
import { createTilesHandler } from "./tiles.ts";
import { DenoWebSocketServerAdapter, upgradeSyncSocket } from "./ws.ts";

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
  const here = new URL(".", import.meta.url).pathname.replace(/\/+$/, "");
  return {
    dataRoot: `${here}/data`,
    distDir: `${here}/../apps/web/dist`,
    tilesDir: `${here}/../tiles`,
    demDir: `${here}/data/dem`,
    llmBaseUrl: LLAMA_DEFAULTS.baseUrl,
  };
}

export interface ServerState {
  options: ServerOptions;
  store: UserSyncStore;
  syncAdapter: DenoWebSocketServerAdapter;
}

export function createState(options: ServerOptions): ServerState {
  const adapter = new DenoWebSocketServerAdapter();
  adapter.connect("qala-server" as PeerId);
  return {
    options,
    store: new UserSyncStore(options.dataRoot),
    syncAdapter: adapter,
  };
}

async function handleSync(
  req: Request,
  state: ServerState,
): Promise<Response> {
  let userId: string;
  try {
    ({ userId } = checkWsUpgrade(req));
  } catch (err) {
    return authErrorResponse(err);
  }
  const url = new URL(req.url);
  const docId = url.searchParams.get("docId");
  if (docId !== null) {
    try {
      const owned = await state.store.docForUser(userId);
      requireDocOwnership(userId, docId, owned.docId);
    } catch (err) {
      return authErrorResponse(err);
    }
  } else {
    // Ensure the user's document (and record) exists before syncing.
    await state.store.docForUser(userId);
  }
  return upgradeSyncSocket(
    req,
    (socket) => state.syncAdapter.addSocket(socket),
  );
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
      if (path === "/sync" || path.startsWith("/sync/")) {
        return await handleSync(req, state);
      }
      if (path === "/api/llm/chat") {
        return await serveLlmChat(req, state.options.llmBaseUrl);
      }
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
): Deno.HttpServer {
  const hostname = bind.hostname ?? BIND_HOSTNAME;
  const port = bind.port ?? BIND_PORT;
  assertLoopbackBind(hostname);
  const state = createState(options);
  return Deno.serve({ hostname, port }, createHandler(state));
}

if (import.meta.main) {
  startServer();
}
