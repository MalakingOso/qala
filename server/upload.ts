// Reading an uploaded file from a request with a hard size cap. The cap is
// enforced while reading, not from Content-Length, which a client can omit or
// lie about.
//
// Two shapes are accepted: the file as the raw request body (what the web app
// sends and `curl --data-binary` does), or a multipart form with a `file` part
// (`curl -F file=@clip.wav`).

export class UploadError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "UploadError";
    this.status = status;
  }
}

export interface Upload {
  bytes: Uint8Array;
  /** The part's or the request's declared type. Informational only. */
  contentType: string;
}

export function uploadErrorResponse(err: unknown): Response | null {
  if (err instanceof UploadError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return null;
}

async function readCapped(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
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
    await reader.cancel().catch(() => {});
    if (err instanceof UploadError) throw err;
    throw new UploadError(400, "could not read the upload");
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

/** Read the upload, or throw an UploadError carrying the HTTP status. */
export async function readUpload(
  req: Request,
  maxBytes: number,
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
  const raw = await readCapped(req.body, maxBytes + 1024);
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
