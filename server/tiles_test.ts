// Tile server tests: PMTiles + unpacked z/x/y, Range requests, 404s.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { createTilesHandler, parseRange, resolveTilePath } from "./tiles.ts";

async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "qala-tiles-"));
  const tile = new Uint8Array(100).map((_, i) => i % 256);
  await mkdir(`${dir}/12/654`, { recursive: true });
  await writeFile(`${dir}/12/654/1583.mvt`, tile);
  await writeFile(`${dir}/region.pmtiles`, tile);
  return dir;
}

test("tile paths resolve inside the dir only", async () => {
  const dir = await fixtureDir();
  try {
    assert.deepStrictEqual(
      resolveTilePath(dir, "/tiles/12/654/1583.mvt"),
      `${dir}/12/654/1583.mvt`,
    );
    assert.deepStrictEqual(
      resolveTilePath(dir, "/tiles/region.pmtiles"),
      `${dir}/region.pmtiles`,
    );
    assert.deepStrictEqual(resolveTilePath(dir, "/tiles/../mod.ts"), null);
    assert.deepStrictEqual(resolveTilePath(dir, "/tiles/%2e%2e/mod.ts"), null);
    assert.deepStrictEqual(resolveTilePath(dir, "/tiles/12/654/"), null);
    assert.deepStrictEqual(resolveTilePath(dir, "/other/12/654/1.mvt"), null);
    assert.deepStrictEqual(resolveTilePath(dir, "/tiles/foo.txt"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("range parsing follows bytes=start-end inclusive", () => {
  assert.deepStrictEqual(parseRange(null, 100), null);
  assert.deepStrictEqual(parseRange("bytes=0-9", 100), { start: 0, end: 9 });
  assert.deepStrictEqual(parseRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepStrictEqual(parseRange("bytes=0-999", 100), { start: 0, end: 99 });
  assert.deepStrictEqual(parseRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepStrictEqual(parseRange("bytes=100-200", 100), null);
  assert.deepStrictEqual(parseRange("items=0-9", 100), null);
});

test("unpacked tiles serve 200, 206, and 404", async () => {
  const dir = await fixtureDir();
  try {
    const handle = createTilesHandler(dir);
    const full = await handle(
      new Request("http://127.0.0.1:8500/tiles/12/654/1583.mvt"),
    );
    assert.deepStrictEqual(full.status, 200);
    assert.deepStrictEqual(full.headers.get("accept-ranges"), "bytes");
    assert.deepStrictEqual((await full.bytes()).length, 100);

    const part = await handle(
      new Request("http://127.0.0.1:8500/tiles/12/654/1583.mvt", {
        headers: { Range: "bytes=10-19" },
      }),
    );
    assert.deepStrictEqual(part.status, 206);
    assert.deepStrictEqual(part.headers.get("content-range"), "bytes 10-19/100");
    assert.deepStrictEqual((await part.bytes()).length, 10);

    const archive = await handle(
      new Request("http://127.0.0.1:8500/tiles/region.pmtiles", {
        headers: { Range: "bytes=0-9" },
      }),
    );
    assert.deepStrictEqual(archive.status, 206);

    const missing = await handle(
      new Request("http://127.0.0.1:8500/tiles/9/1/1.mvt"),
    );
    assert.deepStrictEqual(missing.status, 404);

    const badRange = await handle(
      new Request("http://127.0.0.1:8500/tiles/12/654/1583.mvt", {
        headers: { Range: "bytes=500-600" },
      }),
    );
    assert.deepStrictEqual(badRange.status, 416);
    assert(badRange.headers.get("content-range")?.includes("/100") ?? false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
