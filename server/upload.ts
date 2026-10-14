// Reading an uploaded file from a request with a hard size cap. The cap is
// enforced while reading, not from Content-Length, which a client can omit or
// lie about.
//
// Two shapes are accepted: the file as the raw request body (what the web app
// sends and `curl --data-binary` does), or a multipart form with a `file` part
// (`curl -F file=@clip.wav`).

import { createGate, type Gate } from "./exec.ts";

export class UploadError extends Error {
  status: number;
  /** True when the server is saturated, not the request at fault. */
  degraded: boolean;
  constructor(status: number, message: string, degraded = false) {
    super(message);
    this.name = "UploadError";
    this.status = status;
    this.degraded = degraded;
  }
}

export interface Upload {
  bytes: Uint8Array;
  /** The part's or the request's declared type. Informational only. */
  contentType: string;
}

export function uploadErrorResponse(err: unknown): Response | null {
  if (err instanceof UploadError) {
    return Response.json(
      err.degraded
        ? { degraded: true, error: err.message }
        : { error: err.message },
      { status: err.status },
    );
  }
  return null;
}

async function readCapped(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  timeoutMs: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  // One deadline for the whole read, so a client trickling bytes cannot hold
  // a connection (and whatever the caller holds) open indefinitely.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new UploadError(408, "the upload took too long")),
      timeoutMs,
    );
  });
  expired.catch(() => {});
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), expired]);
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        throw new UploadError(
          413,
          `upload is larger than ${describe(maxBytes)}`,
        );
      }
      parts.push(value);
    }
  } catch (err) {
    // Not awaited: a stalled source may never settle its cancel.
    reader.cancel().catch(() => {});
    if (err instanceof UploadError) throw err;
    throw new UploadError(400, "could not read the upload");
  } finally {
    clearTimeout(timer);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function describe(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${Math.round(bytes / (1024 * 1024))} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

/** Default total time allowed to receive an upload. */
export const DEFAULT_UPLOAD_TIMEOUT_MS = 30_000;

/**
 * Read the upload, or throw an UploadError carrying the HTTP status: 413 over
 * the cap, 408 when the body does not finish inside `timeoutMs`.
 */
export async function readUpload(
  req: Request,
  maxBytes: number,
  timeoutMs: number = DEFAULT_UPLOAD_TIMEOUT_MS,
): Promise<Upload> {
  // Content-Length is only a shortcut for an honest client. The real cap is
  // the bounded read below, which also covers chunked bodies with no header.
  // A header that is present but not a plain non-negative integer is refused.
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d{1,15}$/.test(declared.trim())) {
      throw new UploadError(400, "invalid Content-Length");
    }
    // Multipart framing adds a little to the file itself.
    if (Number(declared) > maxBytes + 1024) {
      throw new UploadError(
        413,
        `upload is larger than ${describe(maxBytes)}`,
      );
    }
  }
  if (req.body === null) throw new UploadError(400, "the upload is empty");
  const contentType = req.headers.get("content-type") ?? "";
  const raw = await readCapped(req.body, maxBytes + 1024, timeoutMs);
  if (/^multipart\/form-data/i.test(contentType)) {
    let form: FormData;
    try {
      form = await new Response(raw, {
        headers: { "content-type": contentType },
      })
        .formData();
    } catch {
      throw new UploadError(400, "could not read the multipart form");
    }
    for (const [name, value] of form.entries()) {
      if (
        typeof value === "string" ||
        (name !== "file" && name !== "audio" && name !== "pdf")
      ) {
        continue;
      }
      if (value.size > maxBytes) {
        throw new UploadError(
          413,
          `upload is larger than ${describe(maxBytes)}`,
        );
      }
      if (value.size === 0) throw new UploadError(400, "the upload is empty");
      return {
        bytes: new Uint8Array(await value.arrayBuffer()),
        contentType: value.type,
      };
    }
    throw new UploadError(400, "the form has no file part");
  }
  if (raw.length > maxBytes) {
    throw new UploadError(413, `upload is larger than ${describe(maxBytes)}`);
  }
  if (raw.length === 0) throw new UploadError(400, "the upload is empty");
  return { bytes: raw, contentType };
}

/**
 * Uploads being received at once, across every upload route. Each holds up to
 * its route's cap in memory, so the total buffered is slots times the larger
 * cap (4 x 10 MB for PDFs). A slot is held only while bytes are arriving.
 */
export const UPLOAD_READ_SLOTS = 4;
export const uploadReadGate: Gate = createGate(UPLOAD_READ_SLOTS);

/**
 * readUpload inside a read slot. Answers 503 with the degraded shape when
 * every slot is taken, and frees the slot as soon as the bytes are in (or the
 * read fails or times out), before the caller takes any processing slot.
 */
export async function readUploadGated(
  req: Request,
  maxBytes: number,
  options: { timeoutMs?: number; gate?: Gate } = {},
): Promise<Upload> {
  const release = (options.gate ?? uploadReadGate).tryEnter();
  if (release === null) {
    throw new UploadError(
      503,
      "too many uploads are in progress, try again shortly",
      true,
    );
  }
  try {
    return await readUpload(req, maxBytes, options.timeoutMs);
  } finally {
    release();
  }
}
