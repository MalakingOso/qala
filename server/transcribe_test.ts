// POST /api/transcribe. ffmpeg is the real one (the fixtures are tiny), the
// model servers are fakes behind an injected fetch.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  type CommandSpec,
  createGate,
  createKeyedGate,
  runCommand,
} from "./exec.ts";
import {
  cleanTranscript,
  E4B_DEFAULTS,
  E4B_INSTRUCTION,
  serveTranscribe,
  sniffAudio,
  TRANSCRIBE_LIMITS,
  type TranscribeDeps,
  wavInfo,
  WHISPER_DEFAULTS,
  WHISPER_PROMPT,
} from "./transcribe.ts";

const fixture = (name: string) =>
  readFile(new URL(`../testdata/import/${name}`, import.meta.url));

interface Seen {
  e4b: { url: string; body: Record<string, unknown> }[];
  whisper: { url: string; form: FormData }[];
}

type Behaviour = "ok" | "down" | "http500" | "notjson";

function fakeBackends(opts: {
  e4b: Behaviour;
  whisper: Behaviour;
  e4bText?: string;
  whisperText?: string;
  hold?: Promise<void>;
}) {
  const seen: Seen = { e4b: [], whisper: [] };
  const fetchFn = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    const behave = (b: Behaviour, ok: () => Response): Response => {
      if (b === "down") {
        throw new TypeError("connection refused (os error 111)");
      }
      if (b === "http500") {
        return Response.json({ error: { message: "boom" } }, { status: 500 });
      }
      if (b === "notjson") return new Response("<html>nope</html>");
      return ok();
    };
    if (url.startsWith(E4B_DEFAULTS.baseUrl)) {
      seen.e4b.push({ url, body: JSON.parse(String(init?.body)) });
      if (opts.hold) await opts.hold;
      return behave(opts.e4b, () =>
        Response.json({
          choices: [{
            message: {
              content: opts.e4bText ?? " bench press 3 sets of 5 at 135 ",
            },
          }],
        }));
    }
    if (url.startsWith(WHISPER_DEFAULTS.baseUrl)) {
      seen.whisper.push({ url, form: init?.body as FormData });
      return behave(
        opts.whisper,
        () =>
          Response.json({
            text: opts.whisperText ?? " Bench press 3 sets of 5 at 135.\n",
          }),
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
  return { fetchFn, seen };
}

function depsWith(
  fetchFn: typeof fetch,
  extra: Partial<TranscribeDeps> = {},
): { deps: TranscribeDeps; specs: CommandSpec[] } {
  const specs: CommandSpec[] = [];
  const deps: TranscribeDeps = {
    run: (spec) => {
      specs.push(spec);
      return runCommand(spec);
    },
    fetchFn,
    e4bUrl: E4B_DEFAULTS.baseUrl,
    whisperUrl: WHISPER_DEFAULTS.baseUrl,
    ffmpeg: "/usr/bin/ffmpeg",
    gate: createGate(2),
    ...extra,
  };
  return { deps, specs };
}

function upload(bytes: BodyInit, type = "audio/wav"): Request {
  return new Request("http://x/api/transcribe", {
    method: "POST",
    body: bytes,
    headers: { "content-type": type },
  });
}

function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

test("sniffing names real containers and refuses everything else", async () => {
  assert.deepStrictEqual(sniffAudio(await fixture("tone-8k.wav"))?.label, "wav");
  assert.deepStrictEqual(sniffAudio(await fixture("tone.webm"))?.label, "webm");
  assert.deepStrictEqual(sniffAudio(new TextEncoder().encode("OggS...."))?.label, "ogg");
  assert.deepStrictEqual(
    sniffAudio(new Uint8Array([0xff, 0xfb, 0x90, 0x00]))?.label,
    "mp3",
  );
  assert.deepStrictEqual(
    sniffAudio(new TextEncoder().encode("....ftypM4A "))?.label,
    "mp4",
  );
  assert.deepStrictEqual(
    sniffAudio(new TextEncoder().encode("#EXTM3U\nfile:///etc/passwd")),
    null,
  );
  assert.deepStrictEqual(
    sniffAudio(new TextEncoder().encode("ffconcat version 1.0\n")),
    null,
  );
  assert.deepStrictEqual(sniffAudio(new Uint8Array(0)), null);
  assert.deepStrictEqual(sniffAudio(await fixture("workout.pdf")), null);
});

test("E4B answers: converted 16 kHz mono WAV goes out as input_audio", async () => {
  const { fetchFn, seen } = fakeBackends({ e4b: "ok", whisper: "down" });
  const { deps, specs } = depsWith(fetchFn);
  const res = await serveTranscribe(upload(await fixture("tone-8k.wav")), deps);
  assert.deepStrictEqual(res.status, 200);
  const body = await res.json();
  assert.deepStrictEqual(body.text, "bench press 3 sets of 5 at 135");
  assert.deepStrictEqual(body.engine, "e4b");
  assert.deepStrictEqual(body.fallback, false);
  assert(
    Math.abs(body.durationSec - 0.6) < 0.11,
    `duration ${body.durationSec}`,
  );

  assert.deepStrictEqual(seen.e4b.length, 1);
  assert.deepStrictEqual(seen.whisper.length, 0, "whisper untouched when E4B answers");
  const req = seen.e4b[0];
  assert.deepStrictEqual(req.url, "http://127.0.0.1:8083/v1/chat/completions");
  assert.deepStrictEqual(req.body["model"], "gemma-4-E4B-mm");
  assert.deepStrictEqual(req.body["temperature"], 0);
  const messages = req.body["messages"] as {
    role: string;
    content: {
      type: string;
      text?: string;
      input_audio?: { data: string; format: string };
    }[];
  }[];
  assert.deepStrictEqual(messages.length, 1);
  assert.deepStrictEqual(messages[0].role, "user");
  const audio = messages[0].content.find((p) => p.type === "input_audio");
  const text = messages[0].content.find((p) => p.type === "text");
  assert.deepStrictEqual(text?.text, E4B_INSTRUCTION);
  assert.deepStrictEqual(audio?.input_audio?.format, "wav");
  const sent = fromBase64(audio!.input_audio!.data);
  const info = wavInfo(sent);
  assert.deepStrictEqual(
    [info?.sampleRate, info?.channels, info?.bits],
    [16000, 1, 16],
    "what E4B receives is 16 kHz mono 16-bit",
  );

  // ffmpeg was spawned with an argument array that pins the format and the
  // protocol, not with a shell string.
  assert.deepStrictEqual(specs.length, 1);
  assert.deepStrictEqual(specs[0].cmd, "/usr/bin/ffmpeg");
  const args = specs[0].args;
  assert.deepStrictEqual(args[args.indexOf("-f") + 1], "wav");
  assert.deepStrictEqual(args[args.indexOf("-protocol_whitelist") + 1], "file");
  assert.deepStrictEqual(args[args.indexOf("-t") + 1], "31");
});

test("a WebM/Opus upload (what the browser records) is decoded too", async () => {
  const { fetchFn, seen } = fakeBackends({ e4b: "ok", whisper: "down" });
  const { deps } = depsWith(fetchFn);
  const res = await serveTranscribe(
    upload(await fixture("tone.webm"), "audio/webm"),
    deps,
  );
  assert.deepStrictEqual(res.status, 200);
  assert.deepStrictEqual((await res.json()).engine, "e4b");
  assert.deepStrictEqual(seen.e4b.length, 1);
});

test("E4B down: whisper.cpp answers with the example-weights prompt", async () => {
  const { fetchFn, seen } = fakeBackends({ e4b: "down", whisper: "ok" });
  const { deps } = depsWith(fetchFn);
  const res = await serveTranscribe(upload(await fixture("tone-8k.wav")), deps);
  assert.deepStrictEqual(res.status, 200);
  const body = await res.json();
  assert.deepStrictEqual(body.engine, "whisper");
  assert.deepStrictEqual(body.fallback, true);
  assert.deepStrictEqual(body.text, "Bench press 3 sets of 5 at 135.");
  assert(
    body.fallbackReason.includes("connection refused"),
    body.fallbackReason,
  );

  assert.deepStrictEqual(seen.whisper.length, 1);
  const { url, form } = seen.whisper[0];
  assert.deepStrictEqual(url, "http://127.0.0.1:8082/inference");
  assert.deepStrictEqual(form.get("prompt"), WHISPER_PROMPT);
  assert.deepStrictEqual(form.get("response_format"), "json");
  assert.deepStrictEqual(form.get("temperature"), "0");
  const file = form.get("file") as File;
  const info = wavInfo(new Uint8Array(await file.arrayBuffer()));
  assert.deepStrictEqual([info?.sampleRate, info?.channels, info?.bits], [16000, 1, 16]);
});

test("E4B answering badly (500, non-JSON) also falls back", async () => {
  for (const bad of ["http500", "notjson"] as const) {
    const { fetchFn, seen } = fakeBackends({ e4b: bad, whisper: "ok" });
    const { deps } = depsWith(fetchFn);
    const res = await serveTranscribe(
      upload(await fixture("tone-8k.wav")),
      deps,
    );
    assert.deepStrictEqual(res.status, 200, bad);
    assert.deepStrictEqual((await res.json()).engine, "whisper", bad);
    assert.deepStrictEqual(seen.whisper.length, 1);
  }
});

test("whisper's blank-audio marker becomes an empty transcript", async () => {
  const { fetchFn } = fakeBackends({
    e4b: "down",
    whisper: "ok",
    whisperText: " [BLANK_AUDIO]\n",
  });
  const { deps } = depsWith(fetchFn);
  const res = await serveTranscribe(upload(await fixture("tone-8k.wav")), deps);
  assert.deepStrictEqual((await res.json()).text, "");
});

test("both backends down is a 502 degraded response, not a 500 or a hang", async () => {
  const { fetchFn } = fakeBackends({ e4b: "down", whisper: "down" });
  const { deps } = depsWith(fetchFn);
  const res = await serveTranscribe(upload(await fixture("tone-8k.wav")), deps);
  assert.deepStrictEqual(res.status, 502);
  const body = await res.json();
  assert.deepStrictEqual(body.degraded, true);
  assert(
    body.error.includes("E4B") && body.error.includes("whisper"),
    body.error,
  );
});

test("an oversize upload is refused before ffmpeg or any model runs", async () => {
  const { fetchFn, seen } = fakeBackends({ e4b: "ok", whisper: "ok" });
  const { deps, specs } = depsWith(fetchFn);
  const tooBig = new Uint8Array(TRANSCRIBE_LIMITS.maxUploadBytes + 2048);
  tooBig.set(new TextEncoder().encode("RIFF\0\0\0\0WAVE"));
  const res = await serveTranscribe(upload(tooBig), deps);
  assert.deepStrictEqual(res.status, 413);

  // The same with no Content-Length: a chunked body is cut off while reading.
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= 64 * 1024 * 1024) return controller.close();
      sent += 1024 * 1024;
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
  });
  const chunked = new Request("http://x/api/transcribe", {
    method: "POST",
    body: stream,
    // @ts-expect-error duplex is required for stream bodies
    duplex: "half",
  });
  assert.deepStrictEqual(chunked.headers.get("content-length"), null);
  const res2 = await serveTranscribe(chunked, deps);
  assert.deepStrictEqual(res2.status, 413);
  assert(
    sent <= TRANSCRIBE_LIMITS.maxUploadBytes + 4 * 1024 * 1024,
    `read ${sent}`,
  );

  assert.deepStrictEqual(specs.length, 0, "ffmpeg never ran");
  assert.deepStrictEqual(seen.e4b.length + seen.whisper.length, 0, "no model call");
});

test("a stalled upload times out with 408 and never holds the gate", async () => {
  const { fetchFn, seen } = fakeBackends({ e4b: "ok", whisper: "ok" });
  const gate = createGate(1);
  const { deps } = depsWith(fetchFn, { gate, uploadTimeoutMs: 300 });
  let sentFirst = false;
  const stalled = new Request("http://x/api/transcribe", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sentFirst) {
          sentFirst = true;
          controller.enqueue(new TextEncoder().encode("RIFF\0\0\0\0WAVE"));
          return;
        }
        return new Promise<void>(() => {});
      },
    }),
    // @ts-expect-error duplex is required for stream bodies
    duplex: "half",
  });
  const pending = serveTranscribe(stalled, deps);
  // While the slow client is still sending, the only slot is free: a normal
  // request runs to completion.
  const wav = await fixture("tone-8k.wav");
  const meanwhile = await serveTranscribe(upload(wav), deps);
  assert.deepStrictEqual(meanwhile.status, 200);
  const res = await pending;
  assert.deepStrictEqual(res.status, 408);
  assert.deepStrictEqual(seen.e4b.length, 1, "only the finished upload reached a model");
  const slot = gate.tryEnter();
  assert(slot !== null, "the gate is free after the timeout");
  slot();
});

test("a full read gate answers 503 degraded, and slots free after the deadline", async () => {
  const { fetchFn } = fakeBackends({ e4b: "ok", whisper: "ok" });
  const readGate = createGate(2);
  const { deps } = depsWith(fetchFn, { readGate, uploadTimeoutMs: 300 });
  const stall = () =>
    new Request("http://x/api/transcribe", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        pull() {
          return new Promise<void>(() => {});
        },
      }),
      // @ts-expect-error duplex is required for stream bodies
      duplex: "half",
    });
  const first = serveTranscribe(stall(), deps);
  const second = serveTranscribe(stall(), deps);
  const wav = await fixture("tone-8k.wav");
  const refused = await serveTranscribe(upload(wav), deps);
  assert.deepStrictEqual(refused.status, 503);
  assert.deepStrictEqual((await refused.json()).degraded, true);

  assert.deepStrictEqual((await first).status, 408);
  assert.deepStrictEqual((await second).status, 408);
  const after = await serveTranscribe(upload(wav), deps);
  assert.deepStrictEqual(
    after.status,
    200,
    "slots are free once the deadline has passed",
  );
});

test("a second upload from the same identity while one is arriving is 429", async () => {
  const { fetchFn } = fakeBackends({ e4b: "ok", whisper: "ok" });
  const { deps } = depsWith(fetchFn, {
    readGate: createGate(4),
    identityGate: createKeyedGate(1),
    uploadTimeoutMs: 300,
  });
  const as = (login: string, body: BodyInit | ReadableStream<Uint8Array>) =>
    new Request("http://x/api/transcribe", {
      method: "POST",
      headers: { "tailscale-user-login": login },
      body,
      // @ts-expect-error duplex is required for stream bodies
      duplex: "half",
    });
  const stalled = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => {});
    },
  });
  const first = serveTranscribe(as("me@example.com", stalled), deps);
  const wav = await fixture("tone-8k.wav");
  const second = await serveTranscribe(as("me@example.com", wav), deps);
  assert.deepStrictEqual(second.status, 429);
  const other = await serveTranscribe(as("you@example.com", wav), deps);
  assert.deepStrictEqual(other.status, 200);
  assert.deepStrictEqual((await first).status, 408);
  const again = await serveTranscribe(as("me@example.com", wav), deps);
  assert.deepStrictEqual(again.status, 200, "free once the first read has ended");
});

test("a clip over 30 seconds is refused with a clear message", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qala-test-"));
  try {
    const long = `${dir}/long.wav`;
    const made = await runCommand({
      cmd: "/usr/bin/ffmpeg",
      args: [
        "-nostdin",
        "-y",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=8000:cl=mono",
        "-t",
        "33",
        "-c:a",
        "pcm_s16le",
        long,
      ],
      timeoutMs: 20_000,
    });
    assert.deepStrictEqual(made.code, 0, made.stderr);
    const { fetchFn, seen } = fakeBackends({ e4b: "ok", whisper: "ok" });
    const { deps } = depsWith(fetchFn);
    const res = await serveTranscribe(upload(await readFile(long)), deps);
    assert.deepStrictEqual(res.status, 422);
    assert((await res.json()).error.includes("longer than 30 seconds"));
    assert.deepStrictEqual(seen.e4b.length, 0, "model never sees an over-length clip");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("not audio, a playlist, and undecodable audio are refused", async () => {
  const { fetchFn, seen } = fakeBackends({ e4b: "ok", whisper: "ok" });
  const { deps, specs } = depsWith(fetchFn);

  const pdf = await serveTranscribe(upload(await fixture("workout.pdf")), deps);
  assert.deepStrictEqual(pdf.status, 415);
  const m3u = await serveTranscribe(
    upload("#EXTM3U\n#EXT-X-VERSION:3\nfile:///etc/passwd\n"),
    deps,
  );
  assert.deepStrictEqual(m3u.status, 415);
  assert.deepStrictEqual(specs.length, 0, "ffmpeg is not even started for these");

  const junk = new Uint8Array(2000);
  junk.set(new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt "));
  const bad = await serveTranscribe(upload(junk), deps);
  assert.deepStrictEqual(bad.status, 422);
  assert.deepStrictEqual(specs.length, 1);
  assert.deepStrictEqual(seen.e4b.length, 0);

  const empty = await serveTranscribe(upload(new Uint8Array(0)), deps);
  assert.deepStrictEqual(empty.status, 400);
});

test("ffmpeg missing is a degraded 503, not a 500", async () => {
  const { fetchFn } = fakeBackends({ e4b: "ok", whisper: "ok" });
  const { deps } = depsWith(fetchFn, { ffmpeg: "/nonexistent/ffmpeg" });
  const res = await serveTranscribe(upload(await fixture("tone-8k.wav")), deps);
  assert.deepStrictEqual(res.status, 503);
  assert.deepStrictEqual((await res.json()).degraded, true);
});

test("only POST, and at most the gate's limit at once", async () => {
  const { fetchFn } = fakeBackends({ e4b: "ok", whisper: "ok" });
  const { deps } = depsWith(fetchFn);
  assert.deepStrictEqual(
    (await serveTranscribe(new Request("http://x/", { method: "GET" }), deps))
      .status,
    405,
  );

  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  const slow = fakeBackends({ e4b: "ok", whisper: "ok", hold });
  const { deps: one } = depsWith(slow.fetchFn, { gate: createGate(1) });
  const wav = await fixture("tone-8k.wav");
  const first = serveTranscribe(upload(wav), one);
  // Wait until the first request is inside the model call, holding the gate.
  for (let i = 0; i < 100 && slow.seen.e4b.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.deepStrictEqual(slow.seen.e4b.length, 1);
  assert.deepStrictEqual((await serveTranscribe(upload(wav), one)).status, 429);
  release();
  assert.deepStrictEqual((await first).status, 200);
  assert.deepStrictEqual((await serveTranscribe(upload(wav), one)).status, 200);
});

test("transcript cleanup: one line, no wrapping quotes, bounded", () => {
  assert.deepStrictEqual(
    cleanTranscript(' "squat 5 by 5\nat 225" '),
    "squat 5 by 5 at 225",
  );
  assert.deepStrictEqual(cleanTranscript("[BLANK_AUDIO]"), "");
  assert.deepStrictEqual(
    cleanTranscript("x".repeat(5000)).length,
    TRANSCRIBE_LIMITS.maxTranscriptChars,
  );
});
