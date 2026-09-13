// Static file serving for the built PWA in `apps/web/dist` (PLAN.md 7).
// Single-page-app fallback: extensionless app routes serve index.html.

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
  ".ico": "image/x-icon",
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

async function serveFile(
  req: Request,
  filePath: string,
): Promise<Response | null> {
  let stat;
  try {
    stat = await Deno.stat(filePath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
  if (stat.isDirectory) return await serveFile(req, `${filePath}/index.html`);
  if (!stat.isFile) return null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("method not allowed", { status: 405 });
  }
  const headers = new Headers({
    "content-type": contentType(filePath),
    "content-length": String(stat.size),
    "cache-control": filePath.endsWith("index.html")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
  });
  if (req.method === "HEAD") return new Response(null, { headers });
  const bytes = await Deno.readFile(filePath);
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Response(body, { headers });
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
