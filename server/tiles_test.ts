// Tile server tests: PMTiles + unpacked z/x/y, Range requests, 404s.

import { assert, assertEquals } from "@std/assert";
import { createTilesHandler, parseRange, resolveTilePath } from "./tiles.ts";

async function fixtureDir(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "qala-tiles-" });
  const tile = new Uint8Array(100).map((_, i) => i % 256);
  await Deno.mkdir(`${dir}/12/654`, { recursive: true });
  await Deno.writeFile(`${dir}/12/654/1583.mvt`, tile);
  await Deno.writeFile(`${dir}/region.pmtiles`, tile);
  return dir;
}

Deno.test("tile paths resolve inside the dir only", async () => {
  const dir = await fixtureDir();
  try {
    assertEquals(
      resolveTilePath(dir, "/tiles/12/654/1583.mvt"),
      `${dir}/12/654/1583.mvt`,
    );
    assertEquals(
      resolveTilePath(dir, "/tiles/region.pmtiles"),
      `${dir}/region.pmtiles`,
    );
    assertEquals(resolveTilePath(dir, "/tiles/../mod.ts"), null);
    assertEquals(resolveTilePath(dir, "/tiles/%2e%2e/mod.ts"), null);
    assertEquals(resolveTilePath(dir, "/tiles/12/654/"), null);
    assertEquals(resolveTilePath(dir, "/other/12/654/1.mvt"), null);
    assertEquals(resolveTilePath(dir, "/tiles/foo.txt"), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("range parsing follows bytes=start-end inclusive", () => {
  assertEquals(parseRange(null, 100), null);
  assertEquals(parseRange("bytes=0-9", 100), { start: 0, end: 9 });
  assertEquals(parseRange("bytes=90-", 100), { start: 90, end: 99 });
  assertEquals(parseRange("bytes=0-999", 100), { start: 0, end: 99 });
  assertEquals(parseRange("bytes=-10", 100), { start: 90, end: 99 });
  assertEquals(parseRange("bytes=100-200", 100), null);
  assertEquals(parseRange("items=0-9", 100), null);
});

Deno.test("unpacked tiles serve 200, 206, and 404", async () => {
  const dir = await fixtureDir();
  try {
    const handle = createTilesHandler(dir);
    const full = await handle(
      new Request("http://127.0.0.1:8500/tiles/12/654/1583.mvt"),
    );
    assertEquals(full.status, 200);
    assertEquals(full.headers.get("accept-ranges"), "bytes");
    assertEquals((await full.bytes()).length, 100);

    const part = await handle(
      new Request("http://127.0.0.1:8500/tiles/12/654/1583.mvt", {
        headers: { Range: "bytes=10-19" },
      }),
    );
    assertEquals(part.status, 206);
    assertEquals(part.headers.get("content-range"), "bytes 10-19/100");
    assertEquals((await part.bytes()).length, 10);

    const archive = await handle(
      new Request("http://127.0.0.1:8500/tiles/region.pmtiles", {
        headers: { Range: "bytes=0-9" },
      }),
    );
    assertEquals(archive.status, 206);

    const missing = await handle(
      new Request("http://127.0.0.1:8500/tiles/9/1/1.mvt"),
    );
    assertEquals(missing.status, 404);

    const badRange = await handle(
      new Request("http://127.0.0.1:8500/tiles/12/654/1583.mvt", {
        headers: { Range: "bytes=500-600" },
      }),
    );
    assertEquals(badRange.status, 416);
    assert(badRange.headers.get("content-range")?.includes("/100") ?? false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
