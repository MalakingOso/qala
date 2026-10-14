// POST /api/transcribe. ffmpeg is the real one (the fixtures are tiny), the
// model servers are fakes behind an injected fetch.

import { assert, assertEquals } from "@std/assert";
import { type CommandSpec, createGate, runCommand } from "./exec.ts";
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
  Deno.readFile(new URL(`../testdata/import/${name}`, import.meta.url));

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
  }) as typeof fetch;
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

Deno.test("sniffing names real containers and refuses everything else", async () => {
  assertEquals(sniffAudio(await fixture("tone-8k.wav"))?.label, "wav");
  assertEquals(sniffAudio(await fixture("tone.webm"))?.label, "webm");
  assertEquals(sniffAudio(new TextEncoder().encode("OggS...."))?.label, "ogg");
  assertEquals(
    sniffAudio(new Uint8Array([0xff, 0xfb, 0x90, 0x00]))?.label,
    "mp3",
  );
  assertEquals(
    sniffAudio(new TextEncoder().encode("....ftypM4A "))?.label,
    "mp4",
  );
  assertEquals(
    sniffAudio(new TextEncoder().encode("#EXTM3U\nfile:///etc/passwd")),
    null,
  );
  assertEquals(
    sniffAudio(new TextEncoder().encode("ffconcat version 1.0\n")),
    null,
  );
  assertEquals(sniffAudio(new Uint8Array(0)), null);
  assertEquals(sniffAudio(await fixture("workout.pdf")), null);
});

Deno.test("E4B answers: converted 16 kHz mono WAV goes out as input_audio", async () => {
  const { fetchFn, seen } = fakeBackends({ e4b: "ok", whisper: "down" });
  const { deps, specs } = depsWith(fetchFn);
  const res = await serveTranscribe(upload(await fixture("tone-8k.wav")), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.text, "bench press 3 sets of 5 at 135");
  assertEquals(body.engine, "e4b");
  assertEquals(body.fallback, false);
  assert(
    Math.abs(body.durationSec - 0.6) < 0.11,
    `duration ${body.durationSec}`,
  );

  assertEquals(seen.e4b.length, 1);
  assertEquals(seen.whisper.length, 0, "whisper untouched when E4B answers");
  const req = seen.e4b[0];
  assertEquals(req.url, "http://127.0.0.1:8083/v1/chat/completions");
  assertEquals(req.body["model"], "gemma-4-E4B-mm");
  assertEquals(req.body["temperature"], 0);
  const messages = req.body["messages"] as {
    role: string;
    content: {
      type: string;
      text?: string;
      input_audio?: { data: string; format: string };
    }[];
  }[];
  assertEquals(messages.length, 1);
  assertEquals(messages[0].role, "user");
  const audio = messages[0].content.find((p) => p.type === "input_audio");
  const text = messages[0].content.find((p) => p.type === "text");
  assertEquals(text?.text, E4B_INSTRUCTION);
  assertEquals(audio?.input_audio?.format, "wav");
  const sent = fromBase64(audio!.input_audio!.data);
  const info = wavInfo(sent);
  assertEquals(
    [info?.sampleRate, info?.channels, info?.bits],
    [16000, 1, 16],
    "what E4B receives is 16 kHz mono 16-bit",
  );

  // ffmpeg was spawned with an argument array that pins the format and the
  // protocol, not with a shell string.
  assertEquals(specs.length, 1);
  assertEquals(specs[0].cmd, "/usr/bin/ffmpeg");
  const args = specs[0].args;
  assertEquals(args[args.indexOf("-f") + 1], "wav");
  assertEquals(args[args.indexOf("-protocol_whitelist") + 1], "file");
  assertEquals(args[args.indexOf("-t") + 1], "31");
});

Deno.test("a WebM/Opus upload (what the browser records) is decoded too", async () => {
  const { fetchFn, seen } = fakeBackends({ e4b: "ok", whisper: "down" });
  const { deps } = depsWith(fetchFn);
  const res = await serveTranscribe(
    upload(await fixture("tone.webm"), "audio/webm"),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).engine, "e4b");
  assertEquals(seen.e4b.length, 1);
});

Deno.test("E4B down: whisper.cpp answers with the example-weights prompt", async () => {
  const { fetchFn, seen } = fakeBackends({ e4b: "down", whisper: "ok" });
  const { deps } = depsWith(fetchFn);
  const res = await serveTranscribe(upload(await fixture("tone-8k.wav")), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.engine, "whisper");
  assertEquals(body.fallback, true);
  assertEquals(body.text, "Bench press 3 sets of 5 at 135.");
  assert(
    body.fallbackReason.includes("connection refused"),
    body.fallbackReason,
  );

  assertEquals(seen.whisper.length, 1);
  const { url, form } = seen.whisper[0];
  assertEquals(url, "http://127.0.0.1:8082/inference");
  assertEquals(form.get("prompt"), WHISPER_PROMPT);
  assertEquals(form.get("response_format"), "json");
  assertEquals(form.get("temperature"), "0");
  const file = form.get("file") as File;
  const info = wavInfo(new Uint8Array(await file.arrayBuffer()));
  assertEquals([info?.sampleRate, info?.channels, info?.bits], [16000, 1, 16]);
});

Deno.test("E4B answering badly (500, non-JSON) also falls back", async () => {
  for (const bad of ["http500", "notjson"] as const) {
    const { fetchFn, seen } = fakeBackends({ e4b: bad, whisper: "ok" });
    const { deps } = depsWith(fetchFn);
    const res = await serveTranscribe(
      upload(await fixture("tone-8k.wav")),
      deps,
    );
    assertEquals(res.status, 200, bad);
    assertEquals((await res.json()).engine, "whisper", bad);
    assertEquals(seen.whisper.length, 1);
  }
});

Deno.test("whisper's blank-audio marker becomes an empty transcript", async () => {
  const { fetchFn } = fakeBackends({
    e4b: "down",
    whisper: "ok",
    whisperText: " [BLANK_AUDIO]\n",
  });
  const { deps } = depsWith(fetchFn);
  const res = await serveTranscribe(upload(await fixture("tone-8k.wav")), deps);
  assertEquals((await res.json()).text, "");
});

Deno.test("both backends down is a 502 degraded response, not a 500 or a hang", async () => {
  const { fetchFn } = fakeBackends({ e4b: "down", whisper: "down" });
  const { deps } = depsWith(fetchFn);
  const res = await serveTranscribe(upload(await fixture("tone-8k.wav")), deps);
  assertEquals(res.status, 502);
  const body = await res.json();
  assertEquals(body.degraded, true);
  assert(
    body.error.includes("E4B") && body.error.includes("whisper"),
    body.error,
  );
});

Deno.test("an oversize upload is refused before ffmpeg or any model runs", async () => {
  const { fetchFn, seen } = fakeBackends({ e4b: "ok", whisper: "ok" });
  const { deps, specs } = depsWith(fetchFn);
  const tooBig = new Uint8Array(TRANSCRIBE_LIMITS.maxUploadBytes + 2048);
  tooBig.set(new TextEncoder().encode("RIFF\0\0\0\0WAVE"));
  const res = await serveTranscribe(upload(tooBig), deps);
  assertEquals(res.status, 413);

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
  assertEquals(chunked.headers.get("content-length"), null);
  const res2 = await serveTranscribe(chunked, deps);
  assertEquals(res2.status, 413);
  assert(
    sent <= TRANSCRIBE_LIMITS.maxUploadBytes + 4 * 1024 * 1024,
    `read ${sent}`,
  );

  assertEquals(specs.length, 0, "ffmpeg never ran");
  assertEquals(seen.e4b.length + seen.whisper.length, 0, "no model call");
});

Deno.test("a stalled upload times out with 408 and never holds the gate", async () => {
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
  assertEquals(meanwhile.status, 200);
  const res = await pending;
  assertEquals(res.status, 408);
  assertEquals(seen.e4b.length, 1, "only the finished upload reached a model");
  const slot = gate.tryEnter();
  assert(slot !== null, "the gate is free after the timeout");
  slot();
});

Deno.test("a clip over 30 seconds is refused with a clear message", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qala-test-" });
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
    assertEquals(made.code, 0, made.stderr);
    const { fetchFn, seen } = fakeBackends({ e4b: "ok", whisper: "ok" });
    const { deps } = depsWith(fetchFn);
    const res = await serveTranscribe(upload(await Deno.readFile(long)), deps);
    assertEquals(res.status, 422);
    assert((await res.json()).error.includes("longer than 30 seconds"));
    assertEquals(seen.e4b.length, 0, "model never sees an over-length clip");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("not audio, a playlist, and undecodable audio are refused", async () => {
  const { fetchFn, seen } = fakeBackends({ e4b: "ok", whisper: "ok" });
  const { deps, specs } = depsWith(fetchFn);

  const pdf = await serveTranscribe(upload(await fixture("workout.pdf")), deps);
  assertEquals(pdf.status, 415);
  const m3u = await serveTranscribe(
    upload("#EXTM3U\n#EXT-X-VERSION:3\nfile:///etc/passwd\n"),
    deps,
  );
  assertEquals(m3u.status, 415);
  assertEquals(specs.length, 0, "ffmpeg is not even started for these");

  const junk = new Uint8Array(2000);
  junk.set(new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt "));
  const bad = await serveTranscribe(upload(junk), deps);
  assertEquals(bad.status, 422);
  assertEquals(specs.length, 1);
  assertEquals(seen.e4b.length, 0);

  const empty = await serveTranscribe(upload(new Uint8Array(0)), deps);
  assertEquals(empty.status, 400);
});

Deno.test("ffmpeg missing is a degraded 503, not a 500", async () => {
  const { fetchFn } = fakeBackends({ e4b: "ok", whisper: "ok" });
  const { deps } = depsWith(fetchFn, { ffmpeg: "/nonexistent/ffmpeg" });
  const res = await serveTranscribe(upload(await fixture("tone-8k.wav")), deps);
  assertEquals(res.status, 503);
  assertEquals((await res.json()).degraded, true);
});

Deno.test("only POST, and at most the gate's limit at once", async () => {
  const { fetchFn } = fakeBackends({ e4b: "ok", whisper: "ok" });
  const { deps } = depsWith(fetchFn);
  assertEquals(
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
  assertEquals(slow.seen.e4b.length, 1);
  assertEquals((await serveTranscribe(upload(wav), one)).status, 429);
  release();
  assertEquals((await first).status, 200);
  assertEquals((await serveTranscribe(upload(wav), one)).status, 200);
});

Deno.test("transcript cleanup: one line, no wrapping quotes, bounded", () => {
  assertEquals(
    cleanTranscript(' "squat 5 by 5\nat 225" '),
    "squat 5 by 5 at 225",
  );
  assertEquals(cleanTranscript("[BLANK_AUDIO]"), "");
  assertEquals(
    cleanTranscript("x".repeat(5000)).length,
    TRANSCRIBE_LIMITS.maxTranscriptChars,
  );
});
