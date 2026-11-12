// Server routing tests: health, elevation, tiles, static.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { createHandler, createState, type ServerOptions } from "./mod.ts";

async function testState(): Promise<
  { state: ReturnType<typeof createState>; cleanup: () => Promise<void> }
> {
  const root = await mkdtemp(join(tmpdir(), "qala-mod-"));
  const options: ServerOptions = {
    dataRoot: `${root}/data`,
    distDir: `${root}/dist`,
    tilesDir: `${root}/tiles`,
    demDir: `${root}/dem`,
    llmBaseUrl: "http://127.0.0.1:1",
  };
  await mkdir(`${root}/dist`, { recursive: true });
  await writeFile(`${root}/dist/index.html`, "<html>qala</html>");
  return {
    state: createState(options),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("health endpoint answers ok", async () => {
  const { state, cleanup } = await testState();
  try {
    const handle = createHandler(state);
    for (const path of ["/health", "/api/health"]) {
      const res = await handle(new Request(`http://127.0.0.1:8500${path}`));
      assert.deepStrictEqual(res.status, 200);
      assert.deepStrictEqual((await res.json() as { ok: boolean }).ok, true);
    }
  } finally {
    await cleanup();
  }
});

test("elevation endpoint validates and answers null without tiles", async () => {
  const { state, cleanup } = await testState();
  try {
    const handle = createHandler(state);
    const res = await handle(
      new Request("http://127.0.0.1:8500/api/elevation?lat=52.37&lon=4.9"),
    );
    assert.deepStrictEqual(res.status, 200);
    const body = await res.json() as { elevationM: null };
    assert.deepStrictEqual(body.elevationM, null);

    const bad = await handle(
      new Request("http://127.0.0.1:8500/api/elevation?lat=x"),
    );
    assert.deepStrictEqual(bad.status, 400);
  } finally {
    await cleanup();
  }
});

test("transcribe is routed and refuses what is not an audio POST", async () => {
  const { state, cleanup } = await testState();
  try {
    const handle = createHandler(state);
    const get = await handle(
      new Request("http://127.0.0.1:8500/api/transcribe"),
    );
    assert.deepStrictEqual(get.status, 405);
    const text = await handle(
      new Request("http://127.0.0.1:8500/api/transcribe", {
        method: "POST",
        body: "not audio",
      }),
    );
    assert.deepStrictEqual(text.status, 415);
  } finally {
    await cleanup();
  }
});

test("PDF import is routed and refuses what is not a PDF POST", async () => {
  const { state, cleanup } = await testState();
  try {
    const handle = createHandler(state);
    const get = await handle(
      new Request("http://127.0.0.1:8500/api/import/pdf"),
    );
    assert.deepStrictEqual(get.status, 405);
    const text = await handle(
      new Request("http://127.0.0.1:8500/api/import/pdf", {
        method: "POST",
        body: "not a pdf",
      }),
    );
    assert.deepStrictEqual(text.status, 415);
  } finally {
    await cleanup();
  }
});

test("unknown paths fall through to static", async () => {
  const { state, cleanup } = await testState();
  try {
    const handle = createHandler(state);
    const app = await handle(new Request("http://127.0.0.1:8500/plan"));
    assert.deepStrictEqual(app.status, 200);
    const missing = await handle(
      new Request("http://127.0.0.1:8500/assets/gone.js"),
    );
    assert.deepStrictEqual(missing.status, 404);
  } finally {
    await cleanup();
  }
});

test("server refuses non-loopback binds before listening", async () => {
  const { state, cleanup } = await testState();
  try {
    const { startServer } = await import("./mod.ts");
    let threw = false;
    try {
      startServer(state.options, { hostname: "0.0.0.0", port: 0 });
    } catch {
      threw = true;
    }
    assert(threw, "expected non-loopback bind to throw");
  } finally {
    await cleanup();
  }
});
