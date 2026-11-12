import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  formatClock,
  MAX_DICTATION_MS,
  pickRecorderMime,
  sendClip,
} from "./dictation.ts";

test("the cap matches what E4B takes", () => {
  assert.deepStrictEqual(MAX_DICTATION_MS, 30_000);
});

test("recorder format: first supported candidate, undefined when none", () => {
  assert.deepStrictEqual(
    pickRecorderMime((t) => t === "audio/webm"),
    "audio/webm",
  );
  assert.deepStrictEqual(
    pickRecorderMime(() => true),
    "audio/webm;codecs=opus",
  );
  assert.deepStrictEqual(
    pickRecorderMime((t) => t === "audio/mp4"),
    "audio/mp4",
  );
  assert.deepStrictEqual(pickRecorderMime(() => false), undefined);
  assert.deepStrictEqual(
    pickRecorderMime(() => {
      throw new Error("no MediaRecorder");
    }),
    undefined,
  );
});

test("clock reads m:ss", () => {
  assert.deepStrictEqual(formatClock(0), "0:00");
  assert.deepStrictEqual(formatClock(7400), "0:07");
  assert.deepStrictEqual(formatClock(30_000), "0:30");
  assert.deepStrictEqual(formatClock(75_000), "1:15");
  assert.deepStrictEqual(formatClock(-5), "0:00");
});

function fakeFetch(status: number, body: unknown, seen?: {
  url?: string;
  init?: RequestInit;
}): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) => {
    if (seen) {
      seen.url = String(url);
      seen.init = init;
    }
    return Promise.resolve(
      typeof body === "string"
        ? new Response(body, { status })
        : Response.json(body, { status }),
    );
  }) as unknown as typeof fetch;
}

test("a clip is posted raw with its own type, and the transcript comes back", async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const clip = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
  const out = await sendClip(
    clip,
    fakeFetch(
      200,
      {
        text: "squat 5 by 5 at 225",
        engine: "e4b",
        fallback: false,
        durationSec: 4.2,
      },
      seen,
    ),
  );
  assert.deepStrictEqual(seen.url, "/api/transcribe");
  assert.deepStrictEqual(seen.init?.method, "POST");
  assert.deepStrictEqual(
    (seen.init?.headers as Record<string, string>)["content-type"],
    "audio/webm",
  );
  assert(seen.init?.body === clip);
  assert(out.ok);
  assert.deepStrictEqual(out.result.text, "squat 5 by 5 at 225");
  assert.deepStrictEqual(out.result.engine, "e4b");
});

test("whisper's fallback answer is passed through", async () => {
  const out = await sendClip(
    new Blob(["x"], { type: "audio/webm" }),
    fakeFetch(200, {
      text: "Bench 3x8.",
      engine: "whisper",
      fallback: true,
      durationSec: 2,
    }),
  );
  assert(out.ok);
  assert.deepStrictEqual([out.result.engine, out.result.fallback], ["whisper", true]);
});

test("every failure becomes a sentence the owner can act on", async () => {
  const clip = new Blob(["x"], { type: "audio/webm" });
  const degraded = await sendClip(
    clip,
    fakeFetch(502, {
      degraded: true,
      error: "speech to text is unavailable (...)",
    }),
  );
  assert(!degraded.ok);
  assert(degraded.message.includes("Type it instead"));

  const tooLong = await sendClip(
    clip,
    fakeFetch(422, { error: "the clip is longer than 30 seconds" }),
  );
  assert(!tooLong.ok);
  assert.deepStrictEqual(tooLong.message, "the clip is longer than 30 seconds");

  const saturated = await sendClip(
    clip,
    fakeFetch(503, {
      degraded: true,
      error: "too many uploads are in progress, try again shortly",
    }),
  );
  assert(!saturated.ok);
  assert.deepStrictEqual(
    saturated.message,
    "too many uploads are in progress, try again shortly",
  );

  const busy = await sendClip(clip, fakeFetch(429, { error: "busy" }));
  assert(!busy.ok);
  assert(busy.message.includes("Try again"));

  const html = await sendClip(clip, fakeFetch(500, "<html>oops</html>"));
  assert(!html.ok);
  assert.deepStrictEqual(html.message, "The server answered 500.");

  const offline = await sendClip(
    clip,
    (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch,
  );
  assert(!offline.ok);
  assert.deepStrictEqual(offline.message, "Could not reach the server.");
});
