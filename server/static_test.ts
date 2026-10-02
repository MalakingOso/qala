// Static file tests: PWA dist serving, SPA fallback, traversal blocks.

import { assert, assertEquals } from "@std/assert";
import { parseRange, resolveStaticPath, serveStatic } from "./static.ts";

async function fixtureDist(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "qala-dist-" });
  await Deno.mkdir(`${dir}/assets`, { recursive: true });
  await Deno.writeTextFile(`${dir}/index.html`, "<html>qala</html>");
  await Deno.writeTextFile(`${dir}/assets/app.js`, "console.log(1)");
  return dir;
}

Deno.test("static paths stay inside dist", async () => {
  const dir = await fixtureDist();
  try {
    assertEquals(resolveStaticPath(dir, "/"), `${dir}/index.html`);
    assertEquals(
      resolveStaticPath(dir, "/assets/app.js"),
      `${dir}/assets/app.js`,
    );
    assertEquals(resolveStaticPath(dir, "/../mod.ts"), null);
    assertEquals(resolveStaticPath(dir, "/%2e%2e/mod.ts"), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dist serves files, SPA fallback, and 404s", async () => {
  const dir = await fixtureDist();
  try {
    const js = await serveStatic(
      new Request("http://127.0.0.1:8500/assets/app.js"),
      dir,
    );
    assertEquals(js.status, 200);
    assert(js.headers.get("content-type")?.includes("javascript") ?? false);

    const route = await serveStatic(
      new Request("http://127.0.0.1:8500/plan"),
      dir,
    );
    assertEquals(route.status, 200);
    assert((await route.text()).includes("qala"));

    const missingAsset = await serveStatic(
      new Request("http://127.0.0.1:8500/assets/gone.js"),
      dir,
    );
    assertEquals(missingAsset.status, 404);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

async function videoDist(): Promise<{ dir: string; bytes: Uint8Array }> {
  const dir = await Deno.makeTempDir({ prefix: "qala-dist-" });
  await Deno.mkdir(`${dir}/assets`, { recursive: true });
  const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
  await Deno.writeFile(`${dir}/assets/intro.mp4`, bytes);
  await Deno.copyFile(`${dir}/assets/intro.mp4`, `${dir}/assets/intro.webm`);
  return { dir, bytes };
}

Deno.test("video files get video MIME types and advertise ranges", async () => {
  const { dir } = await videoDist();
  try {
    const mp4 = await serveStatic(
      new Request("http://127.0.0.1:8500/assets/intro.mp4"),
      dir,
    );
    assertEquals(mp4.status, 200);
    assertEquals(mp4.headers.get("content-type"), "video/mp4");
    assertEquals(mp4.headers.get("accept-ranges"), "bytes");
    await mp4.body?.cancel();
    const webm = await serveStatic(
      new Request("http://127.0.0.1:8500/assets/intro.webm"),
      dir,
    );
    assertEquals(webm.headers.get("content-type"), "video/webm");
    await webm.body?.cancel();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Range requests answer 206 with the right bytes", async () => {
  const { dir, bytes } = await videoDist();
  const get = (range: string, method = "GET") =>
    serveStatic(
      new Request("http://127.0.0.1:8500/assets/intro.mp4", {
        method,
        headers: { range },
      }),
      dir,
    );
  try {
    const a = await get("bytes=10-19");
    assertEquals(a.status, 206);
    assertEquals(a.headers.get("content-range"), "bytes 10-19/1000");
    assertEquals(a.headers.get("content-length"), "10");
    assertEquals(
      new Uint8Array(await a.arrayBuffer()),
      bytes.subarray(10, 20),
    );

    const open = await get("bytes=990-");
    assertEquals(open.status, 206);
    assertEquals(open.headers.get("content-range"), "bytes 990-999/1000");
    assertEquals(
      new Uint8Array(await open.arrayBuffer()),
      bytes.subarray(990),
    );

    const suffix = await get("bytes=-5");
    assertEquals(suffix.headers.get("content-range"), "bytes 995-999/1000");
    assertEquals(
      new Uint8Array(await suffix.arrayBuffer()),
      bytes.subarray(995),
    );

    // an end past the file is clamped, not an error
    const clamped = await get("bytes=900-5000");
    assertEquals(clamped.status, 206);
    assertEquals(clamped.headers.get("content-range"), "bytes 900-999/1000");
    await clamped.body?.cancel();

    // Safari's first probe
    const probe = await get("bytes=0-1");
    assertEquals(probe.status, 206);
    assertEquals(probe.headers.get("content-range"), "bytes 0-1/1000");
    await probe.body?.cancel();

    const head = await get("bytes=0-99", "HEAD");
    assertEquals(head.status, 206);
    assertEquals(head.headers.get("content-length"), "100");
    assertEquals(head.body, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an unsatisfiable Range answers 416 with the size", async () => {
  const { dir } = await videoDist();
  try {
    for (const range of ["bytes=1000-", "bytes=5000-6000", "bytes=-0"]) {
      const res = await serveStatic(
        new Request("http://127.0.0.1:8500/assets/intro.mp4", {
          headers: { range },
        }),
        dir,
      );
      assertEquals(res.status, 416, range);
      assertEquals(res.headers.get("content-range"), "bytes */1000", range);
      await res.body?.cancel();
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("ranges we cannot honour are ignored, not rejected", async () => {
  const { dir } = await videoDist();
  try {
    for (
      const range of ["bytes=0-1,5-6", "items=0-5", "bytes=9-3", "nonsense"]
    ) {
      const res = await serveStatic(
        new Request("http://127.0.0.1:8500/assets/intro.mp4", {
          headers: { range },
        }),
        dir,
      );
      assertEquals(res.status, 200, range);
      assertEquals(res.headers.get("content-length"), "1000", range);
      await res.body?.cancel();
    }
    const ifRange = await serveStatic(
      new Request("http://127.0.0.1:8500/assets/intro.mp4", {
        headers: { range: "bytes=0-9", "if-range": '"etag"' },
      }),
      dir,
    );
    assertEquals(ifRange.status, 200);
    await ifRange.body?.cancel();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("parseRange covers the three forms", () => {
  assertEquals(parseRange("bytes=0-499", 1000), { start: 0, end: 499 });
  assertEquals(parseRange("bytes=500-", 1000), { start: 500, end: 999 });
  assertEquals(parseRange("bytes=-200", 1000), { start: 800, end: 999 });
  assertEquals(parseRange("bytes=-5000", 1000), { start: 0, end: 999 });
  assertEquals(parseRange("bytes=1000-", 1000), "unsatisfiable");
  assertEquals(parseRange(null, 1000), null);
});
