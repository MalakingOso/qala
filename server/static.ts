// Static file serving for the built PWA in `apps/web/dist` (docs/PLAN.md 7).
// Single-page-app fallback: extensionless app routes serve index.html.
// Byte ranges (206 / 416) are served too; iOS Safari needs them to play video.

import { stat } from "node:fs/promises";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function contentType(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : "";
  return MIME[ext] ?? "application/octet-stream";
}

/** Resolve `requestPath` inside `distDir`, or null when it escapes. */
export function resolveStaticPath(
  distDir: string,
  requestPath: string,
): string | null {
  let rel = requestPath;
  try {
    rel = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (!rel.startsWith("/")) return null;
  const parts = rel.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.includes("..")) return null;
  if (parts.some((p) => p.includes("\\") || p.includes("\0"))) return null;
  const base = distDir.replace(/\/+$/, "");
  return parts.length === 0
    ? `${base}/index.html`
    : `${base}/${parts.join("/")}`;
}

type ByteRange = { start: number; end: number } | "unsatisfiable" | null;

/**
 * Parse a single `Range: bytes=a-b`, `a-` or `-n` against a file of `size`
 * bytes. Null means serve the whole file (no header, an unknown unit, several
 * ranges, or syntax we do not understand, all of which RFC 9110 lets us ignore).
 */
export function parseRange(header: string | null, size: number): ByteRange {
  if (header === null) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    // suffix: the last n bytes
    const n = Number(m[2]);
    if (n === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size) return "unsatisfiable";
  if (end < start) return null; // a malformed range is ignored, not an error
  return { start, end };
}

async function readSlice(
  filePath: string,
  start: number,
  length: number,
): Promise<ArrayBuffer> {
  return await Bun.file(filePath).slice(start, start + length).arrayBuffer();
}

async function serveFile(
  req: Request,
  filePath: string,
): Promise<Response | null> {
  let st;
  try {
    st = await stat(filePath);
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
  if (st.isDirectory()) return await serveFile(req, `${filePath}/index.html`);
  if (!st.isFile()) return null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("method not allowed", { status: 405 });
  }
  const headers = new Headers({
    "content-type": contentType(filePath),
    "content-length": String(st.size),
    "accept-ranges": "bytes",
    "cache-control": filePath.endsWith("index.html")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
  });
  // iOS Safari will not play a video without byte ranges. We carry no ETag,
  // so an If-Range cannot be validated: serve the whole file then.
  const range = req.headers.has("if-range")
    ? null
    : parseRange(req.headers.get("range"), st.size);
  if (range === "unsatisfiable") {
    headers.set("content-range", `bytes */${st.size}`);
    headers.set("content-length", "0");
    return new Response(null, { status: 416, headers });
  }
  if (range) {
    const length = range.end - range.start + 1;
    headers.set(
      "content-range",
      `bytes ${range.start}-${range.end}/${st.size}`,
    );
    headers.set("content-length", String(length));
    if (req.method === "HEAD") {
      return new Response(null, { status: 206, headers });
    }
    return new Response(await readSlice(filePath, range.start, length), {
      status: 206,
      headers,
    });
  }
  if (req.method === "HEAD") return new Response(null, { headers });
  return new Response(await Bun.file(filePath).arrayBuffer(), { headers });
}

/**
 * Serve one request from `distDir`. Falls back to index.html for
 * extensionless app routes; hashed assets get long-lived caching.
 */
export async function serveStatic(
  req: Request,
  distDir: string,
): Promise<Response> {
  const url = new URL(req.url);
  const filePath = resolveStaticPath(distDir, url.pathname);
  if (filePath === null) {
    return new Response("bad request", { status: 400 });
  }
  const direct = await serveFile(req, filePath);
  if (direct) return direct;
  // SPA fallback for app routes like /plan, never for missing asset files.
  const last = url.pathname.split("/").pop() ?? "";
  if (!last.includes(".")) {
    const index = await serveFile(req, `${distDir}/index.html`);
    if (index) return index;
  }
  return new Response("not found", { status: 404 });
}
