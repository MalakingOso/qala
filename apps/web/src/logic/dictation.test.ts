import { assert, assertEquals } from "@std/assert";
import {
  formatClock,
  MAX_DICTATION_MS,
  pickRecorderMime,
  sendClip,
} from "./dictation.ts";

Deno.test("the cap matches what E4B takes", () => {
  assertEquals(MAX_DICTATION_MS, 30_000);
});

Deno.test("recorder format: first supported candidate, undefined when none", () => {
  assertEquals(
    pickRecorderMime((t) => t === "audio/webm"),
    "audio/webm",
  );
  assertEquals(
    pickRecorderMime(() => true),
    "audio/webm;codecs=opus",
  );
  assertEquals(
    pickRecorderMime((t) => t === "audio/mp4"),
    "audio/mp4",
  );
  assertEquals(pickRecorderMime(() => false), undefined);
  assertEquals(
    pickRecorderMime(() => {
      throw new Error("no MediaRecorder");
    }),
    undefined,
  );
});

Deno.test("clock reads m:ss", () => {
  assertEquals(formatClock(0), "0:00");
  assertEquals(formatClock(7400), "0:07");
  assertEquals(formatClock(30_000), "0:30");
  assertEquals(formatClock(75_000), "1:15");
  assertEquals(formatClock(-5), "0:00");
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
  }) as typeof fetch;
}

Deno.test("a clip is posted raw with its own type, and the transcript comes back", async () => {
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
  assertEquals(seen.url, "/api/transcribe");
  assertEquals(seen.init?.method, "POST");
  assertEquals(
    (seen.init?.headers as Record<string, string>)["content-type"],
    "audio/webm",
  );
  assert(seen.init?.body === clip);
  assert(out.ok);
  assertEquals(out.result.text, "squat 5 by 5 at 225");
  assertEquals(out.result.engine, "e4b");
});

Deno.test("whisper's fallback answer is passed through", async () => {
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
  assertEquals([out.result.engine, out.result.fallback], ["whisper", true]);
});

Deno.test("every failure becomes a sentence the owner can act on", async () => {
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
  assertEquals(tooLong.message, "the clip is longer than 30 seconds");

  const saturated = await sendClip(
    clip,
    fakeFetch(503, {
      degraded: true,
      error: "too many uploads are in progress, try again shortly",
    }),
  );
  assert(!saturated.ok);
  assertEquals(
    saturated.message,
    "too many uploads are in progress, try again shortly",
  );

  const busy = await sendClip(clip, fakeFetch(429, { error: "busy" }));
  assert(!busy.ok);
  assert(busy.message.includes("Try again"));

  const html = await sendClip(clip, fakeFetch(500, "<html>oops</html>"));
  assert(!html.ok);
  assertEquals(html.message, "The server answered 500.");

  const offline = await sendClip(
    clip,
    (() => Promise.reject(new TypeError("offline"))) as typeof fetch,
  );
  assert(!offline.ok);
  assertEquals(offline.message, "Could not reach the server.");
});
