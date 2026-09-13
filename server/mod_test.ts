// Server routing tests: health, sync auth gate, elevation, tiles, static.

import { assert, assertEquals } from "@std/assert";
import { createHandler, createState, type ServerOptions } from "./mod.ts";

async function testState(): Promise<
  { state: ReturnType<typeof createState>; cleanup: () => Promise<void> }
> {
  const root = await Deno.makeTempDir({ prefix: "qala-mod-" });
  const options: ServerOptions = {
    dataRoot: `${root}/data`,
    distDir: `${root}/dist`,
    tilesDir: `${root}/tiles`,
    demDir: `${root}/dem`,
    llmBaseUrl: "http://127.0.0.1:1",
  };
  await Deno.mkdir(`${root}/dist`, { recursive: true });
  await Deno.writeTextFile(`${root}/dist/index.html`, "<html>qala</html>");
  return {
    state: createState(options),
    cleanup: () => Deno.remove(root, { recursive: true }),
  };
}

Deno.test("health endpoint answers ok", async () => {
  const { state, cleanup } = await testState();
  try {
    const handle = createHandler(state);
    for (const path of ["/health", "/api/health"]) {
      const res = await handle(new Request(`http://127.0.0.1:8500${path}`));
      assertEquals(res.status, 200);
      assertEquals((await res.json() as { ok: boolean }).ok, true);
    }
  } finally {
    await cleanup();
  }
});

Deno.test("sync without identity is 401 and cross-user doc is 403", async () => {
  const { state, cleanup } = await testState();
  try {
    const handle = createHandler(state);
    const anon = await handle(new Request("http://127.0.0.1:8500/sync"));
    assertEquals(anon.status, 401);

    const alice = await state.store.docForUser("alice");
    const bob = "bob";
    await state.store.docForUser(bob);
    const cross = await handle(
      new Request(`http://127.0.0.1:8500/sync?docId=${alice.docId}`, {
        headers: { "Tailscale-User-Login": bob },
      }),
    );
    assertEquals(cross.status, 403);

    // Non-upgrade request with valid auth reaches the socket route (426).
    const plain = await handle(
      new Request("http://127.0.0.1:8500/sync", {
        headers: { "Tailscale-User-Login": "alice" },
      }),
    );
    assertEquals(plain.status, 426);
  } finally {
    await cleanup();
  }
});

Deno.test("elevation endpoint validates and answers null without tiles", async () => {
  const { state, cleanup } = await testState();
  try {
    const handle = createHandler(state);
    const res = await handle(
      new Request("http://127.0.0.1:8500/api/elevation?lat=52.37&lon=4.9"),
    );
    assertEquals(res.status, 200);
    const body = await res.json() as { elevationM: null };
    assertEquals(body.elevationM, null);

    const bad = await handle(
      new Request("http://127.0.0.1:8500/api/elevation?lat=x"),
    );
    assertEquals(bad.status, 400);
  } finally {
    await cleanup();
  }
});

Deno.test("unknown paths fall through to static", async () => {
  const { state, cleanup } = await testState();
  try {
    const handle = createHandler(state);
    const app = await handle(new Request("http://127.0.0.1:8500/plan"));
    assertEquals(app.status, 200);
    const missing = await handle(
      new Request("http://127.0.0.1:8500/assets/gone.js"),
    );
    assertEquals(missing.status, 404);
  } finally {
    await cleanup();
  }
});

Deno.test("server refuses non-loopback binds before listening", async () => {
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
