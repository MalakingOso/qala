// Bounded request body reader. `await req.text()` buffers whatever the client
// sends, and a chunked body has no Content-Length to check first, so the cap
// has to be enforced while reading: count bytes as the chunks arrive and stop
// as soon as the total passes the limit.

export type BodyResult =
  | { ok: true; text: string }
  | { ok: false; status: 400 | 413; error: string };

const TOO_LARGE: BodyResult = {
  ok: false,
  status: 413,
  error: "request body too large",
};

/**
 * Read the request body as UTF-8 text, at most `maxBytes` bytes.
 *
 * A Content-Length that is present must be a non-negative integer (400
 * otherwise), and one above the cap is refused (413) before any byte is read.
 * The header is not trusted for anything else: the bytes are counted as they
 * arrive, so a body longer than it claims, or with no length at all, still
 * stops at the cap. The stream is cancelled whenever the body is refused.
 */
export async function readTextCapped(
  req: Request,
  maxBytes: number,
): Promise<BodyResult> {
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared.trim())) {
      await req.body?.cancel().catch(() => {});
      return { ok: false, status: 400, error: "invalid Content-Length" };
    }
    if (Number(declared.trim()) > maxBytes) {
      await req.body?.cancel().catch(() => {});
      return TOO_LARGE;
    }
  }
  if (req.body === null) return { ok: true, text: "" };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return TOO_LARGE;
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: "could not read body" };
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}
