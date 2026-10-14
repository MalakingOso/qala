// The real runner against real, harmless programs, plus the gate and the
// upload reader.

import { assert, assertEquals } from "@std/assert";
import { createGate, createKeyedGate, runCommand } from "./exec.ts";
import { readUpload, readUploadGated, UploadError } from "./upload.ts";

const text = (b: Uint8Array) => new TextDecoder().decode(b);

Deno.test("runner passes arguments literally, never through a shell", async () => {
  const r = await runCommand({
    cmd: "/bin/echo",
    args: ["$(echo pwned); `id` && x", "a b"],
    timeoutMs: 5000,
  });
  assertEquals(r.code, 0);
  assertEquals(text(r.stdout).trim(), "$(echo pwned); `id` && x a b");
});

Deno.test("runner scrubs the environment and feeds stdin", async () => {
  Deno.env.set("QALA_TEST_SECRET", "hunter2");
  try {
    const env = await runCommand({
      cmd: "/usr/bin/env",
      args: [],
      timeoutMs: 5000,
    });
    assert(!text(env.stdout).includes("hunter2"), "secret not inherited");
    const cat = await runCommand({
      cmd: "/bin/cat",
      args: [],
      stdin: new TextEncoder().encode("hello"),
      timeoutMs: 5000,
    });
    assertEquals(text(cat.stdout), "hello");
  } finally {
    Deno.env.delete("QALA_TEST_SECRET");
  }
});

Deno.test("runner reports a missing program instead of throwing", async () => {
  const r = await runCommand({
    cmd: "/nonexistent/qala-test",
    args: [],
    timeoutMs: 5000,
  });
  assert(r.spawnFailed);
  assertEquals(r.code, null);
  assert(r.stderr.includes("cannot run"), r.stderr);
});

Deno.test("runner kills a program that runs past its timeout", async () => {
  const t0 = performance.now();
  const r = await runCommand({
    cmd: "/bin/sleep",
    args: ["30"],
    timeoutMs: 200,
  });
  assert(r.timedOut);
  assertEquals(r.code, null);
  assert(performance.now() - t0 < 5000, "returned promptly");
});

Deno.test("runner stops a program that writes past the stdout cap", async () => {
  const r = await runCommand({
    cmd: "/usr/bin/yes",
    args: [],
    timeoutMs: 10_000,
    maxStdoutBytes: 4096,
  });
  assert(r.truncated);
  assertEquals(r.code, null);
  assert(r.stdout.length <= 4096);
});

Deno.test("an own-session run takes its forked workers down on timeout", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qala-exec-" });
  try {
    const pidFile = `${dir}/pid`;
    const r = await runCommand({
      cmd: "/bin/sh",
      args: ["-c", `sleep 60 & echo $! > "${pidFile}"; wait`],
      timeoutMs: 300,
      ownSession: true,
    });
    assert(r.timedOut);
    const pid = (await Deno.readTextFile(pidFile)).trim();
    let alive = true;
    for (let i = 0; i < 40 && alive; i++) {
      try {
        await Deno.stat(`/proc/${pid}`);
        await new Promise((res) => setTimeout(res, 50));
      } catch {
        alive = false;
      }
    }
    assert(!alive, `worker ${pid} should be gone`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("gate admits up to its limit and frees a slot on release", () => {
  const gate = createGate(2);
  const a = gate.tryEnter();
  const b = gate.tryEnter();
  assert(a && b);
  assertEquals(gate.tryEnter(), null);
  a();
  a(); // releasing twice must not free a second slot
  const c = gate.tryEnter();
  assert(c);
  assertEquals(gate.tryEnter(), null);
});

function post(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request("http://x/up", { method: "POST", body, headers });
}

Deno.test("upload reads a raw body and a multipart file part", async () => {
  const raw = await readUpload(
    post(new Uint8Array([1, 2, 3]), { "content-type": "audio/wav" }),
    100,
  );
  assertEquals([...raw.bytes], [1, 2, 3]);
  assertEquals(raw.contentType, "audio/wav");

  const form = new FormData();
  form.set(
    "file",
    new Blob([new Uint8Array([9, 8])], { type: "audio/webm" }),
    "c.webm",
  );
  const multi = await readUpload(post(form), 100);
  assertEquals([...multi.bytes], [9, 8]);
  assertEquals(multi.contentType, "audio/webm");
});

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (err) {
    if (err instanceof UploadError) return err.status;
    throw err;
  }
}

Deno.test("upload refuses empty, oversize and malformed bodies", async () => {
  assertEquals(await status(readUpload(post(new Uint8Array(0)), 100)), 400);
  assertEquals(
    await status(readUpload(post(new Uint8Array(500_000)), 100)),
    413,
  );
  // No Content-Length: a streamed body is cut off at the cap while reading.
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += 64;
      controller.enqueue(new Uint8Array(64));
      if (sent > 1_000_000) controller.close();
    },
  });
  const chunked = new Request("http://x/up", {
    method: "POST",
    body: stream,
    // @ts-expect-error duplex is required for stream bodies
    duplex: "half",
  });
  assertEquals(await status(readUpload(chunked, 1000)), 413);
  assert(sent < 100_000, `stopped reading early (read ${sent})`);

  const noFile = new FormData();
  noFile.set("note", "hi");
  assertEquals(await status(readUpload(post(noFile), 100)), 400);
  const big = new FormData();
  big.set("file", new Blob([new Uint8Array(5000)]), "b.bin");
  assertEquals(await status(readUpload(post(big), 100)), 413);
});

/** A request whose body sends `first`, then stalls forever. */
function stalledRequest(first: Uint8Array): Request {
  let sentFirst = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sentFirst) {
        sentFirst = true;
        controller.enqueue(first);
        return;
      }
      return new Promise<void>(() => {});
    },
  });
  return new Request("http://x/up", {
    method: "POST",
    body: stream,
    // @ts-expect-error duplex is required for stream bodies
    duplex: "half",
  });
}

Deno.test("an upload that stalls mid-body is cut off with 408", async () => {
  const t0 = performance.now();
  const err = await readUpload(
    stalledRequest(new Uint8Array(100)),
    1000,
    { timeoutMs: 150, idleTimeoutMs: 60_000 },
  ).catch((e) => e);
  assert(err instanceof UploadError);
  assertEquals(err.status, 408);
  assert(performance.now() - t0 < 2000, "gave up promptly");
  // A finished upload inside the deadline is unaffected by it.
  const ok = await readUpload(post(new Uint8Array([1])), 1000, {
    timeoutMs: 150,
  });
  assertEquals([...ok.bytes], [1]);
});

Deno.test("a sender that goes quiet is cut off by the idle clock, a steady one is not", async () => {
  const t0 = performance.now();
  const err = await readUpload(stalledRequest(new Uint8Array(10)), 1000, {
    timeoutMs: 60_000,
    idleTimeoutMs: 100,
  }).catch((e) => e);
  assert(err instanceof UploadError);
  assertEquals(err.status, 408);
  assertEquals(err.message, "the upload stalled");
  assert(performance.now() - t0 < 2000, "gave the slot back quickly");

  // Six chunks 40 ms apart take longer than the idle limit in total, but no
  // single gap does.
  let n = 0;
  const steady = new Request("http://x/up", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((r) => setTimeout(r, 40));
        if (++n > 6) return controller.close();
        controller.enqueue(new Uint8Array(10));
      },
    }),
    // @ts-expect-error duplex is required for stream bodies
    duplex: "half",
  });
  const ok = await readUpload(steady, 1000, {
    timeoutMs: 60_000,
    idleTimeoutMs: 150,
  });
  assertEquals(ok.bytes.length, 60);
});

function withIdentity(req: Request, login: string): Request {
  const headers = new Headers(req.headers);
  headers.set("tailscale-user-login", login);
  return new Request(req, { headers });
}

Deno.test("one upload read per identity: the second is 429, others and anonymous are not", async () => {
  const identityGate = createKeyedGate(1);
  const gate = createGate(8);
  const opts = { timeoutMs: 300, idleTimeoutMs: 60_000, gate, identityGate };
  const mine = () => stalledRequest(new Uint8Array(10));

  const first = readGatedStatus(withIdentity(mine(), "Me@Example.com"), opts);
  const second = await readGatedStatus(
    withIdentity(mine(), " me@example.com "),
    opts,
  );
  assertEquals(second, 429, "same identity, normalised, while one is arriving");
  const other = readGatedStatus(withIdentity(mine(), "you@example.com"), opts);
  const anon1 = readGatedStatus(mine(), opts);
  const anon2 = readGatedStatus(mine(), opts);
  // Everyone else got in (and then hit the 300 ms deadline).
  assertEquals(await other, 408);
  assertEquals(await anon1, 408);
  assertEquals(await anon2, 408);
  assertEquals(await first, 408);

  // Once the first read has ended, the identity can upload again.
  const again = await readUploadGated(
    withIdentity(
      new Request("http://x/up", { method: "POST", body: new Uint8Array([7]) }),
      "me@example.com",
    ),
    100,
    opts,
  );
  assertEquals([...again.bytes], [7]);
  assertEquals(gate.tryEnter() !== null, true, "no read slot leaked");
});

async function readGatedStatus(
  req: Request,
  opts: Parameters<typeof readUploadGated>[2],
): Promise<number> {
  try {
    await readUploadGated(req, 1000, opts);
    return 200;
  } catch (err) {
    if (err instanceof UploadError) return err.status;
    throw err;
  }
}

Deno.test("keyed gate limits per key and frees on release", () => {
  const g = createKeyedGate(1);
  const a = g.tryEnter("a");
  assert(a !== null);
  assertEquals(g.tryEnter("a"), null);
  assert(g.tryEnter("b") !== null);
  a();
  a();
  assert(g.tryEnter("a") !== null);
});

Deno.test("upload refuses a Content-Length that is not a plain integer", async () => {
  for (const bad of ["abc", "-5", "1e3", "12 34", "0x10"]) {
    const req = new Request("http://x/up", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
      headers: { "content-length": bad },
    });
    assertEquals(await status(readUpload(req, 100)), 400, `length ${bad}`);
  }
});

Deno.test("a chunked upload with no Content-Length is cut off over real HTTP", async () => {
  let handled = 0;
  let seenLength: string | null = "unset";
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (req) => {
      seenLength = req.headers.get("content-length");
      try {
        await readUpload(req, 1000);
        return new Response("ok");
      } catch (err) {
        const code = err instanceof UploadError ? err.status : 500;
        return new Response("refused", { status: code });
      } finally {
        handled++;
      }
    },
  );
  try {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 20_000_000) return controller.close();
        sent += 65_536;
        controller.enqueue(new Uint8Array(65_536));
      },
    });
    const res = await fetch(`http://127.0.0.1:${server.addr.port}/`, {
      method: "POST",
      body,
      // @ts-expect-error duplex is required for stream bodies
      duplex: "half",
    }).catch(() => null);
    // The server may reset the connection once it has answered, so the client
    // sees either the 413 or a reset. It must never see a 200.
    if (res !== null) {
      assertEquals(res.status, 413);
      await res.body?.cancel();
    }
    assertEquals(seenLength, null, "the request really had no Content-Length");
    assertEquals(handled, 1);
    assert(sent < 20_000_000, `client was stopped early (sent ${sent})`);
  } finally {
    await server.shutdown();
  }
});
