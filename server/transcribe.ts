// POST /api/transcribe (DECISIONS S20, docs/rust-core.md section 12).
//
// Audio in, transcript out. The upload is capped in size, sniffed against a
// short list of audio containers, converted to 16 kHz mono WAV with ffmpeg, and
// sent to Gemma 4 E4B (llama-server with its mmproj, :8083). When E4B is down
// the same WAV goes to whisper.cpp (:8082) with an initial prompt of example
// weights. Both down is a 502 with `degraded: true`, like /api/llm/chat.
//
// The route returns the transcript and stops. It does not call text import:
// the owner should see (and fix) a misheard number before extraction, the
// confirm step already lives on POST /api/import/text, and a transcript is
// useful on its own (the speech check-in in PLAN 11 will reuse this route).
//
// The upload is untrusted. ffmpeg only ever sees a format this file named
// after checking the bytes, never a probed one, and never a network protocol.

import {
  type CommandRunner,
  createGate,
  type Gate,
  type KeyedGate,
  runCommand,
} from "./exec.ts";
import { type ContentPart, proxyChatCompletions } from "./llm.ts";
import { readUploadGated, uploadErrorResponse } from "./upload.ts";

export const TRANSCRIBE_LIMITS = {
  /** Upload size. 30 s of opus or webm is under 200 KB; this leaves room for a WAV. */
  maxUploadBytes: 8 * 1024 * 1024,
  /** E4B takes 30 s of audio. */
  maxClipSec: 30,
  minClipSec: 0.2,
  /** ffmpeg stops here so a hostile file cannot make it decode for long. */
  convertTimeoutMs: 20_000,
  e4bTimeoutMs: 20_000,
  whisperTimeoutMs: 20_000,
  maxTranscriptChars: 2000,
  maxConcurrent: 2,
} as const;

export const E4B_DEFAULTS = {
  baseUrl: "http://127.0.0.1:8083",
  model: "gemma-4-E4B-mm",
} as const;
export const WHISPER_DEFAULTS = { baseUrl: "http://127.0.0.1:8082" } as const;

export const E4B_INSTRUCTION =
  "Transcribe this audio verbatim. Write numbers as digits. Reply with the transcript only.";

/**
 * Whisper reads "three fifteen" as "3:15" unless it has seen weights written
 * the way the owner says them, so the initial prompt is a few gym sentences.
 */
export const WHISPER_PROMPT =
  "Bench press 3 sets of 5 at 135 pounds. Squat 5 by 5 at 225 lb, RPE 8. " +
  "Deadlift 1 by 5 at 315. Overhead press 3 by 8 at 95, rest 90 seconds. " +
  "Incline dumbbell press 4 by 10 at 60.";

export interface TranscribeDeps {
  run: CommandRunner;
  fetchFn: typeof fetch;
  e4bUrl: string;
  whisperUrl: string;
  ffmpeg: string;
  /** Covers conversion and the model calls, not the upload read. */
  gate: Gate;
  /** Total time allowed to receive the upload. Tests pass a short one. */
  uploadTimeoutMs?: number;
  /** Time allowed with no chunk arriving. Tests pass a short one. */
  uploadIdleMs?: number;
  /** Slots for uploads being received; defaults to the shared read gate. */
  readGate?: Gate;
  /** One read per identity; defaults to the shared per-identity gate. */
  identityGate?: KeyedGate;
}

/** Live deps. URLs and the ffmpeg path can be overridden from the environment. */
export function liveTranscribeDeps(): TranscribeDeps {
  return {
    run: runCommand,
    fetchFn: fetch,
    e4bUrl: Deno.env.get("QALA_E4B_URL") ?? E4B_DEFAULTS.baseUrl,
    whisperUrl: Deno.env.get("QALA_WHISPER_URL") ?? WHISPER_DEFAULTS.baseUrl,
    ffmpeg: Deno.env.get("QALA_FFMPEG") ?? "/usr/bin/ffmpeg",
    gate: createGate(TRANSCRIBE_LIMITS.maxConcurrent),
  };
}

const LIVE = liveTranscribeDeps();

// ---- container sniffing ----------------------------------------------------

export interface AudioKind {
  /** ffmpeg demuxer name, passed as `-f` so ffmpeg never probes. */
  demuxer: string;
  label: string;
}

function ascii(b: Uint8Array, at: number, text: string): boolean {
  if (b.length < at + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (b[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/** Name the container from its first bytes, or null when it is not audio we take. */
export function sniffAudio(b: Uint8Array): AudioKind | null {
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE")) {
    return { demuxer: "wav", label: "wav" };
  }
  if (
    b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf &&
    b[3] === 0xa3
  ) {
    return { demuxer: "matroska,webm", label: "webm" };
  }
  if (ascii(b, 0, "OggS")) return { demuxer: "ogg", label: "ogg" };
  if (ascii(b, 0, "fLaC")) return { demuxer: "flac", label: "flac" };
  if (ascii(b, 4, "ftyp")) {
    return { demuxer: "mov,mp4,m4a,3gp,3g2,mj2", label: "mp4" };
  }
  if (ascii(b, 0, "ID3")) return { demuxer: "mp3", label: "mp3" };
  // MPEG audio frame sync: 11 set bits, and a layer other than "reserved".
  if (
    b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 &&
    (b[1] & 0x06) !== 0
  ) {
    return { demuxer: "mp3", label: "mp3" };
  }
  return null;
}

// ---- WAV -------------------------------------------------------------------

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bits: number;
  dataBytes: number;
}

/** Read the fmt and data chunks of a RIFF/WAVE file. Null when malformed. */
export function wavInfo(b: Uint8Array): WavInfo | null {
  if (!ascii(b, 0, "RIFF") || !ascii(b, 8, "WAVE")) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let fmt: Omit<WavInfo, "dataBytes"> | null = null;
  let at = 12;
  while (at + 8 <= b.length) {
    const size = view.getUint32(at + 4, true);
    if (ascii(b, at, "fmt ") && at + 8 + 16 <= b.length) {
      if (view.getUint16(at + 8, true) !== 1) return null; // PCM only
      fmt = {
        channels: view.getUint16(at + 10, true),
        sampleRate: view.getUint32(at + 12, true),
        bits: view.getUint16(at + 22, true),
      };
    } else if (ascii(b, at, "data")) {
      if (fmt === null) return null;
      return { ...fmt, dataBytes: Math.min(size, b.length - (at + 8)) };
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

// ---- conversion ------------------------------------------------------------

export type Converted =
  | { ok: true; wav: Uint8Array<ArrayBuffer>; durationSec: number }
  | { ok: false; status: number; error: string; degraded?: boolean };

/** Convert the upload to 16 kHz mono 16-bit WAV and measure it. */
export async function convertToWav(
  bytes: Uint8Array,
  kind: AudioKind,
  deps: Pick<TranscribeDeps, "run" | "ffmpeg">,
): Promise<Converted> {
  const dir = await Deno.makeTempDir({ prefix: "qala-audio-" });
  try {
    const input = `${dir}/in.bin`;
    const output = `${dir}/out.wav`;
    await Deno.writeFile(input, bytes);
    const r = await deps.run({
      cmd: deps.ffmpeg,
      args: [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        // Local files only: no playlist, concat or network inputs.
        "-protocol_whitelist",
        "file",
        "-f",
        kind.demuxer,
        "-i",
        input,
        // One second past the cap, so a long clip is detected but never fully decoded.
        "-t",
        String(TRANSCRIBE_LIMITS.maxClipSec + 1),
        "-vn",
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-f",
        "wav",
        output,
      ],
      timeoutMs: TRANSCRIBE_LIMITS.convertTimeoutMs,
      maxStdoutBytes: 64 * 1024,
    });
    if (r.spawnFailed) {
      return {
        ok: false,
        status: 503,
        degraded: true,
        error: "audio conversion is unavailable on this server",
      };
    }
    if (r.timedOut) {
      return {
        ok: false,
        status: 422,
        error: "the audio took too long to decode",
      };
    }
    if (r.code !== 0) {
      return { ok: false, status: 422, error: "could not decode this audio" };
    }
    let wav: Uint8Array<ArrayBuffer>;
    try {
      wav = await Deno.readFile(output);
    } catch {
      return { ok: false, status: 422, error: "could not decode this audio" };
    }
    const info = wavInfo(wav);
    if (
      info === null || info.sampleRate !== 16000 || info.channels !== 1 ||
      info.bits !== 16
    ) {
      return { ok: false, status: 422, error: "could not decode this audio" };
    }
    const durationSec = info.dataBytes / 32000;
    if (durationSec > TRANSCRIBE_LIMITS.maxClipSec + 0.05) {
      return {
        ok: false,
        status: 422,
        error:
          `the clip is longer than ${TRANSCRIBE_LIMITS.maxClipSec} seconds`,
      };
    }
    if (durationSec < TRANSCRIBE_LIMITS.minClipSec) {
      return {
        ok: false,
        status: 422,
        error: "the clip is too short to hold speech",
      };
    }
    return { ok: true, wav, durationSec: Math.round(durationSec * 10) / 10 };
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

// ---- engines ---------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** One line, no wrapping quotes, bounded. */
export function cleanTranscript(raw: string): string {
  const s = raw
    // Whisper's markers for silence and noise, e.g. [BLANK_AUDIO].
    .replace(/\[[A-Z_ ]{3,30}\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“](.*)["”]$/, "$1")
    .trim();
  return s.slice(0, TRANSCRIBE_LIMITS.maxTranscriptChars);
}

type EngineResult = { ok: true; text: string } | { ok: false; error: string };

async function transcribeWithE4b(
  wav: Uint8Array,
  deps: Pick<TranscribeDeps, "fetchFn" | "e4bUrl">,
): Promise<EngineResult> {
  const content: ContentPart[] = [
    {
      type: "input_audio",
      input_audio: { data: toBase64(wav), format: "wav" },
    },
    { type: "text", text: E4B_INSTRUCTION },
  ];
  const result = await proxyChatCompletions(
    {
      messages: [{ role: "user", content }],
      baseUrl: deps.e4bUrl,
      model: E4B_DEFAULTS.model,
      timeoutMs: TRANSCRIBE_LIMITS.e4bTimeoutMs,
      extra: { max_tokens: 400, stream: false },
    },
    deps.fetchFn,
  );
  if (!result.ok) return { ok: false, error: result.error };
  const reply = (result.data as {
    choices?: { message?: { content?: unknown } }[];
  })?.choices?.[0]?.message?.content;
  if (typeof reply !== "string") {
    return { ok: false, error: "E4B reply had no text" };
  }
  return { ok: true, text: cleanTranscript(reply) };
}

async function transcribeWithWhisper(
  wav: Uint8Array<ArrayBuffer>,
  deps: Pick<TranscribeDeps, "fetchFn" | "whisperUrl">,
): Promise<EngineResult> {
  const form = new FormData();
  form.set("file", new Blob([wav], { type: "audio/wav" }), "clip.wav");
  form.set("response_format", "json");
  form.set("temperature", "0");
  form.set("prompt", WHISPER_PROMPT);
  let res: Response;
  try {
    res = await deps.fetchFn(`${deps.whisperUrl}/inference`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TRANSCRIBE_LIMITS.whisperTimeoutMs),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  let data: { text?: unknown; error?: unknown };
  try {
    data = JSON.parse(await res.text());
  } catch {
    return {
      ok: false,
      error: `whisper returned non-JSON (status ${res.status})`,
    };
  }
  if (!res.ok || typeof data.error === "string") {
    return {
      ok: false,
      error: typeof data.error === "string"
        ? data.error
        : `whisper status ${res.status}`,
    };
  }
  if (typeof data.text !== "string") {
    return { ok: false, error: "whisper reply had no text" };
  }
  return { ok: true, text: cleanTranscript(data.text) };
}

// ---- route -----------------------------------------------------------------

export interface TranscribeResponse {
  text: string;
  engine: "e4b" | "whisper";
  /** True when whisper answered because E4B could not. */
  fallback: boolean;
  /** Why E4B was skipped. Present only when `fallback` is true. */
  fallbackReason?: string;
  durationSec: number;
}

/** Serve POST /api/transcribe. Never throws. */
export async function serveTranscribe(
  req: Request,
  deps: TranscribeDeps = LIVE,
): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }
  // Receive the whole upload before taking a slot, so a client that stalls
  // mid-body can only hold its own connection (until the read deadline), not
  // a transcription slot.
  let upload;
  try {
    upload = await readUploadGated(req, TRANSCRIBE_LIMITS.maxUploadBytes, {
      timeoutMs: deps.uploadTimeoutMs,
      idleTimeoutMs: deps.uploadIdleMs,
      gate: deps.readGate,
      identityGate: deps.identityGate,
    });
  } catch (err) {
    return uploadErrorResponse(err) ??
      Response.json({ error: "could not read the upload" }, { status: 400 });
  }
  const kind = sniffAudio(upload.bytes);
  if (kind === null) {
    return Response.json(
      {
        error:
          "unsupported audio format (use wav, webm, ogg, mp4, mp3 or flac)",
      },
      { status: 415 },
    );
  }
  const release = deps.gate.tryEnter();
  if (release === null) {
    return Response.json(
      { error: "too many transcriptions in progress, try again shortly" },
      { status: 429 },
    );
  }
  try {
    const converted = await convertToWav(upload.bytes, kind, deps);
    if (!converted.ok) {
      return Response.json(
        converted.degraded
          ? { degraded: true, error: converted.error }
          : { error: converted.error },
        { status: converted.status },
      );
    }

    const e4b = await transcribeWithE4b(converted.wav, deps);
    if (e4b.ok) {
      const body: TranscribeResponse = {
        text: e4b.text,
        engine: "e4b",
        fallback: false,
        durationSec: converted.durationSec,
      };
      return Response.json(body);
    }
    const whisper = await transcribeWithWhisper(converted.wav, deps);
    if (whisper.ok) {
      const body: TranscribeResponse = {
        text: whisper.text,
        engine: "whisper",
        fallback: true,
        fallbackReason: e4b.error,
        durationSec: converted.durationSec,
      };
      return Response.json(body);
    }
    return Response.json(
      {
        degraded: true,
        error:
          `speech to text is unavailable (E4B: ${e4b.error}; whisper.cpp: ${whisper.error})`,
      },
      { status: 502 },
    );
  } catch {
    return Response.json(
      { degraded: true, error: "transcription failed unexpectedly" },
      { status: 502 },
    );
  } finally {
    release();
  }
}
