// Static file tests: PWA dist serving, SPA fallback, traversal blocks.

import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { parseRange, resolveStaticPath, serveStatic } from "./static.ts";

async function fixtureDist(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "qala-dist-"));
  await mkdir(`${dir}/assets`, { recursive: true });
  await writeFile(`${dir}/index.html`, "<html>qala</html>");
  await writeFile(`${dir}/assets/app.js`, "console.log(1)");
  return dir;
}

test("static paths stay inside dist", async () => {
  const dir = await fixtureDist();
  try {
    assert.deepStrictEqual(resolveStaticPath(dir, "/"), `${dir}/index.html`);
    assert.deepStrictEqual(
      resolveStaticPath(dir, "/assets/app.js"),
      `${dir}/assets/app.js`,
    );
    assert.deepStrictEqual(resolveStaticPath(dir, "/../mod.ts"), null);
    assert.deepStrictEqual(resolveStaticPath(dir, "/%2e%2e/mod.ts"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dist serves files, SPA fallback, and 404s", async () => {
  const dir = await fixtureDist();
  try {
    const js = await serveStatic(
      new Request("http://127.0.0.1:8500/assets/app.js"),
      dir,
    );
    assert.deepStrictEqual(js.status, 200);
    assert(js.headers.get("content-type")?.includes("javascript") ?? false);

    const route = await serveStatic(
      new Request("http://127.0.0.1:8500/plan"),
      dir,
    );
    assert.deepStrictEqual(route.status, 200);
    assert((await route.text()).includes("qala"));

    const missingAsset = await serveStatic(
      new Request("http://127.0.0.1:8500/assets/gone.js"),
      dir,
    );
    assert.deepStrictEqual(missingAsset.status, 404);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function videoDist(): Promise<{ dir: string; bytes: Uint8Array }> {
  const dir = await mkdtemp(join(tmpdir(), "qala-dist-"));
  await mkdir(`${dir}/assets`, { recursive: true });
  const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
  await writeFile(`${dir}/assets/intro.mp4`, bytes);
  await copyFile(`${dir}/assets/intro.mp4`, `${dir}/assets/intro.webm`);
  return { dir, bytes };
}

test("video files get video MIME types and advertise ranges", async () => {
  const { dir } = await videoDist();
  try {
    const mp4 = await serveStatic(
      new Request("http://127.0.0.1:8500/assets/intro.mp4"),
      dir,
    );
    assert.deepStrictEqual(mp4.status, 200);
    assert.deepStrictEqual(mp4.headers.get("content-type"), "video/mp4");
    assert.deepStrictEqual(mp4.headers.get("accept-ranges"), "bytes");
    await mp4.body?.cancel();
    const webm = await serveStatic(
      new Request("http://127.0.0.1:8500/assets/intro.webm"),
      dir,
    );
    assert.deepStrictEqual(webm.headers.get("content-type"), "video/webm");
    await webm.body?.cancel();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("wasm files get the wasm MIME type, so browsers can stream-compile them", async () => {
  const dir = await fixtureDist();
  try {
    await mkdir(`${dir}/wasm/abc123`, { recursive: true });
    await writeFile(
      `${dir}/wasm/abc123/qala_lspp_wasm_bg.wasm`,
      new Uint8Array([0, 0x61, 0x73, 0x6d]),
    );
    const res = await serveStatic(
      new Request("http://127.0.0.1:8500/wasm/abc123/qala_lspp_wasm_bg.wasm"),
      dir,
    );
    assert.deepStrictEqual(res.status, 200);
    assert.deepStrictEqual(res.headers.get("content-type"), "application/wasm");
    await res.body?.cancel();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Range requests answer 206 with the right bytes", async () => {
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
    assert.deepStrictEqual(a.status, 206);
    assert.deepStrictEqual(a.headers.get("content-range"), "bytes 10-19/1000");
    assert.deepStrictEqual(a.headers.get("content-length"), "10");
    assert.deepStrictEqual(
      new Uint8Array(await a.arrayBuffer()),
      bytes.subarray(10, 20),
    );

    const open = await get("bytes=990-");
    assert.deepStrictEqual(open.status, 206);
    assert.deepStrictEqual(open.headers.get("content-range"), "bytes 990-999/1000");
    assert.deepStrictEqual(
      new Uint8Array(await open.arrayBuffer()),
      bytes.subarray(990),
    );

    const suffix = await get("bytes=-5");
    assert.deepStrictEqual(suffix.headers.get("content-range"), "bytes 995-999/1000");
    assert.deepStrictEqual(
      new Uint8Array(await suffix.arrayBuffer()),
      bytes.subarray(995),
    );

    // an end past the file is clamped, not an error
    const clamped = await get("bytes=900-5000");
    assert.deepStrictEqual(clamped.status, 206);
    assert.deepStrictEqual(clamped.headers.get("content-range"), "bytes 900-999/1000");
    await clamped.body?.cancel();

    // Safari's first probe
    const probe = await get("bytes=0-1");
    assert.deepStrictEqual(probe.status, 206);
    assert.deepStrictEqual(probe.headers.get("content-range"), "bytes 0-1/1000");
    await probe.body?.cancel();

    const head = await get("bytes=0-99", "HEAD");
    assert.deepStrictEqual(head.status, 206);
    assert.deepStrictEqual(head.headers.get("content-length"), "100");
    assert.deepStrictEqual(head.body, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unsatisfiable Range answers 416 with the size", async () => {
  const { dir } = await videoDist();
  try {
    for (const range of ["bytes=1000-", "bytes=5000-6000", "bytes=-0"]) {
      const res = await serveStatic(
        new Request("http://127.0.0.1:8500/assets/intro.mp4", {
          headers: { range },
        }),
        dir,
      );
      assert.deepStrictEqual(res.status, 416, range);
      assert.deepStrictEqual(res.headers.get("content-range"), "bytes */1000", range);
      await res.body?.cancel();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ranges we cannot honour are ignored, not rejected", async () => {
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
      assert.deepStrictEqual(res.status, 200, range);
      assert.deepStrictEqual(res.headers.get("content-length"), "1000", range);
      await res.body?.cancel();
    }
    const ifRange = await serveStatic(
      new Request("http://127.0.0.1:8500/assets/intro.mp4", {
        headers: { range: "bytes=0-9", "if-range": '"etag"' },
      }),
      dir,
    );
    assert.deepStrictEqual(ifRange.status, 200);
    await ifRange.body?.cancel();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseRange covers the three forms", () => {
  assert.deepStrictEqual(parseRange("bytes=0-499", 1000), { start: 0, end: 499 });
  assert.deepStrictEqual(parseRange("bytes=500-", 1000), { start: 500, end: 999 });
  assert.deepStrictEqual(parseRange("bytes=-200", 1000), { start: 800, end: 999 });
  assert.deepStrictEqual(parseRange("bytes=-5000", 1000), { start: 0, end: 999 });
  assert.deepStrictEqual(parseRange("bytes=1000-", 1000), "unsatisfiable");
  assert.deepStrictEqual(parseRange(null, 1000), null);
});
