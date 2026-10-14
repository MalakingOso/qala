// readTextCapped: the cap holds for a chunked body with no Content-Length, a
// body longer than its Content-Length says, and bytes rather than characters.

import { assert, assertEquals } from "@std/assert";
import { readTextCapped } from "./body.ts";

function post(
  body: BodyInit | null,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://qala.test/x", {
    method: "POST",
    headers,
    body,
    // @ts-ignore Deno needs `duplex` for a stream body; the DOM types lack it.
    duplex: "half",
  });
}

/** A stream of `chunks` chunks of `size` bytes that counts what was pulled and notes a cancel. */
function counting(chunks: number, size: number) {
  const state = { pulled: 0, canceled: false };
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= chunks) return controller.close();
      sent++;
      state.pulled += size;
      controller.enqueue(new Uint8Array(size).fill(0x61));
    },
    cancel() {
      state.canceled = true;
    },
  });
  return { stream, state };
}

Deno.test("a chunked body past the cap is a 413, stops early and cancels the stream", async () => {
  const { stream, state } = counting(10_000, 1024);
  const req = post(stream);
  assertEquals(req.headers.get("content-length"), null);
  const result = await readTextCapped(req, 4096);
  assertEquals(result, {
    ok: false,
    status: 413,
    error: "request body too large",
  });
  assert(state.pulled < 4096 + 8 * 1024, `pulled ${state.pulled} bytes`);
  assert(state.canceled, "the stream was cancelled");
});

Deno.test("a Content-Length that lies small does not lift the cap", async () => {
  const result = await readTextCapped(
    post("x".repeat(5000), { "content-length": "10" }),
    1000,
  );
  assertEquals(result.ok, false);
  assert(!result.ok && result.status === 413);
});

Deno.test("a Content-Length over the cap is refused before any byte is read", async () => {
  const { stream, state } = counting(10, 100);
  const result = await readTextCapped(
    post(stream, { "content-length": "5000" }),
    1000,
  );
  assert(!result.ok && result.status === 413);
  // The stream prefetches one chunk by itself; the reader asked for none.
  assert(state.pulled <= 100, `pulled ${state.pulled} bytes`);
  assert(state.canceled, "the stream was cancelled");
});

Deno.test("a Content-Length that is not a non-negative integer is a 400", async () => {
  for (const bad of ["abc", "-5", "1e3", "12 34", "", "0x10", "1.5"]) {
    const result = await readTextCapped(
      post("hello", { "content-length": bad }),
      1000,
    );
    assert(!result.ok && result.status === 400, `Content-Length: "${bad}"`);
    assertEquals(!result.ok && result.error, "invalid Content-Length");
  }
});

Deno.test("a body inside the cap comes back whole, including a character split across chunks", async () => {
  const bytes = new TextEncoder().encode('{"text":"café ☕"}');
  const split = bytes.indexOf(0xe2) + 1; // inside the three bytes of the coffee cup
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, split));
      controller.enqueue(bytes.slice(split));
      controller.close();
    },
  });
  const result = await readTextCapped(post(stream), 1000);
  assertEquals(result, { ok: true, text: '{"text":"café ☕"}' });

  const exact = await readTextCapped(
    post("hello", { "content-length": "5" }),
    5,
  );
  assertEquals(exact, { ok: true, text: "hello" });
});

Deno.test("the cap counts bytes, not characters", async () => {
  // Three characters, six bytes.
  const result = await readTextCapped(post("ééé"), 5);
  assert(!result.ok && result.status === 413);
  assertEquals(await readTextCapped(post("ééé"), 6), {
    ok: true,
    text: "ééé",
  });
});

Deno.test("no body reads as empty text, a broken stream is a 400", async () => {
  assertEquals(
    await readTextCapped(new Request("http://qala.test/x"), 100),
    { ok: true, text: "" },
  );
  const broken = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error("connection reset"));
    },
  });
  const result = await readTextCapped(post(broken), 100);
  assertEquals(result, {
    ok: false,
    status: 400,
    error: "could not read body",
  });
});
