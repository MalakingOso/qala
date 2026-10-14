/* Dictation helpers (docs/ls-plus-plus.md 4 and 5): pick a recording format,
 * show the clock, and send one clip to POST /api/transcribe. DOM-free, so the
 * component stays thin and tests can pass a fake fetch. */

/** E4B takes 30 s of audio, and the server refuses anything longer. */
export const MAX_DICTATION_MS = 30_000;

/** Best first. Chrome and Firefox take the webm or ogg entries, Safari mp4. */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

/** First type the browser's MediaRecorder can produce, or undefined for its default. */
export function pickRecorderMime(
  isSupported: (type: string) => boolean,
): string | undefined {
  return MIME_CANDIDATES.find((t) => {
    try {
      return isSupported(t);
    } catch {
      return false;
    }
  });
}

/** 7400 ms becomes "0:07". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export interface TranscribeResult {
  text: string;
  engine: "e4b" | "whisper";
  /** True when whisper.cpp answered because E4B could not. */
  fallback: boolean;
  durationSec: number;
}

export type SendOutcome =
  | { ok: true; result: TranscribeResult }
  | { ok: false; message: string };

/** Send one recorded clip to the server and turn every failure into a sentence. */
export async function sendClip(
  clip: Blob,
  fetchFn: typeof fetch = fetch,
): Promise<SendOutcome> {
  let res: Response;
  try {
    res = await fetchFn("/api/transcribe", {
      method: "POST",
      headers: { "content-type": clip.type || "application/octet-stream" },
      body: clip,
    });
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Fall through to the status-based message.
  }
  const rec = typeof body === "object" && body !== null
    ? body as Record<string, unknown>
    : {};
  if (res.ok && typeof rec["text"] === "string") {
    return {
      ok: true,
      result: {
        text: rec["text"],
        engine: rec["engine"] === "whisper" ? "whisper" : "e4b",
        fallback: rec["fallback"] === true,
        durationSec: typeof rec["durationSec"] === "number"
          ? rec["durationSec"]
          : 0,
      },
    };
  }
  if (res.status === 502 && rec["degraded"] === true) {
    return {
      ok: false,
      message: "Speech to text is not available right now. Type it instead.",
    };
  }
  if (res.status === 429) {
    return {
      ok: false,
      message: "Another clip is being sent. Try again in a moment.",
    };
  }
  const error = typeof rec["error"] === "string" ? rec["error"] : "";
  return {
    ok: false,
    message: error !== "" ? error : `The server answered ${res.status}.`,
  };
}
