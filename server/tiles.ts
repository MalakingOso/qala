// Map tile serving (docs/PLAN.md section 8a): self-hosted Protomaps PMTiles for
// the owner's region, plus the unpacked `z/x/y` fallback the phone app
// pre-caches (a service worker cannot cache 206 responses). Full Range
// support, since MapLibre and the PMTiles client fetch by byte range.

import { stat } from "node:fs/promises";

const PMTILES_TYPE = "application/octet-stream";
const MVT_TYPE = "application/vnd.mapbox-vector-tile";

export interface TilesOptions {
  tilesDir: string;
}

/** Resolve a tile request path inside `tilesDir`, or null when it escapes. */
export function resolveTilePath(
  tilesDir: string,
  requestPath: string,
): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  const prefix = "/tiles/";
  if (!rel.startsWith(prefix)) return null;
  const rest = rel.slice(prefix.length);
  if (rest === "" || rest.includes("\0") || rest.includes("\\")) return null;
  const parts = rest.split("/");
  if (parts.includes("") || parts.includes(".") || parts.includes("..")) {
    return null;
  }
  // Allowed shapes: <name>.pmtiles, or <z>/<x>/<y>.mvt (also .pbf).
  const last = parts[parts.length - 1];
  const isArchive = parts.length === 1 && last.endsWith(".pmtiles");
  const isTile = parts.length === 3 &&
    /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1]) &&
    (last.endsWith(".mvt") || last.endsWith(".pbf"));
  if (!isArchive && !isTile) return null;
  const base = tilesDir.replace(/\/+$/, "");
  return `${base}/${parts.join("/")}`;
}

interface RangeSpec {
  start: number;
  end: number; // inclusive
}

/** Parse a single `bytes=start-end` range against `size`, or null. */
export function parseRange(
  header: string | null,
  size: number,
): RangeSpec | null {
  if (header === null) return null;
  const m = header.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  const [, startStr, endStr] = m;
  if (startStr === "" && endStr === "") return null;
  if (startStr === "") {
    // Suffix range: last N bytes.
    const n = Number(endStr);
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    if (n >= size) return { start: 0, end: size - 1 };
    return { start: size - n, end: size - 1 };
  }
  const start = Number(startStr);
  if (!Number.isSafeInteger(start) || start >= size) return null;
  const end = endStr === "" ? size - 1 : Math.min(Number(endStr), size - 1);
  if (!Number.isSafeInteger(end) || end < start) return null;
  return { start, end };
}

/** Serve GET/HEAD for one tile file with Range support. */
export async function serveTileFile(
  req: Request,
  filePath: string,
): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }
  let st;
  try {
    st = await stat(filePath);
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") {
      return Response.json({ error: "tile not found" }, { status: 404 });
    }
    throw err;
  }
  if (!st.isFile()) {
    return Response.json({ error: "tile not found" }, { status: 404 });
  }
  const size = st.size;
  const type = filePath.endsWith(".pmtiles") ? PMTILES_TYPE : MVT_TYPE;
  const baseHeaders = { "content-type": type, "accept-ranges": "bytes" };

  const range = parseRange(req.headers.get("range"), size);
  if (req.headers.get("range") !== null && range === null) {
    return Response.json(
      { error: "invalid range" },
      { status: 416, headers: { "content-range": `bytes */${size}` } },
    );
  }
  if (range === null) {
    const headers = new Headers({
      ...baseHeaders,
      "content-length": String(size),
    });
    if (req.method === "HEAD") return new Response(null, { headers });
    return new Response(await Bun.file(filePath).arrayBuffer(), { headers });
  }
  const len = range.end - range.start + 1;
  const headers = new Headers({
    ...baseHeaders,
    "content-length": String(len),
    "content-range": `bytes ${range.start}-${range.end}/${size}`,
  });
  if (req.method === "HEAD") {
    return new Response(null, { status: 206, headers });
  }
  const body = await Bun.file(filePath).slice(range.start, range.end + 1)
    .arrayBuffer();
  return new Response(body, { status: 206, headers });
}

/** Route `/tiles/*` requests to the tile directory. */
export function createTilesHandler(
  tilesDir: string,
): (req: Request) => Promise<Response> {
  return async function handleTiles(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const filePath = resolveTilePath(tilesDir, url.pathname);
    if (filePath === null) {
      return Response.json({ error: "bad tile request" }, { status: 400 });
    }
    return await serveTileFile(req, filePath);
  };
}
