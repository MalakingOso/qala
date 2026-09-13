// Extract the owner's map region from a Protomaps source archive
// (PLAN.md section 8a: `pmtiles extract --bbox --maxzoom 15`, then unpack to
// z/x/y because a service worker cannot cache 206 responses).
//
//   deno run --allow-all scripts/tiles_extract.ts \
//     --src ~/maps/protomaps-us.pmtiles --bbox "-84.6,42.6,-83.5,43.4" \
//     --maxzoom 15 --out server/tiles --name region
//
// Steps: (1) `pmtiles extract` into <out>/<name>.pmtiles (the measured step;
// PLAN's size guidance: a metro area at z15 is tens to low hundreds of MB,
// the whole US ~13-16 GB); (2) unpack every tile to <out>/<z>/<x>/<y>.mvt by
// reading the PMTiles v3 archive directly (no extra tooling); (3) print a
// size report. Requires nothing but Deno; the `pmtiles` CLI is NOT needed.
//
// Bbox format: minlon,minlat,maxlon,maxlat (WGS84 degrees).

import { join } from "node:path";

function arg(name: string, def?: string): string | undefined {
  const i = Deno.args.findIndex((a) => a === `--${name}`);
  if (i >= 0) return Deno.args[i + 1] ?? def;
  const kv = Deno.args.find((a) => a.startsWith(`--${name}=`));
  return kv ? kv.slice(name.length + 3) : def;
}

// --- PMTiles v3 minimal reader (spec: protobush/pmtiles, directory only) ---

function readVarint(buf: Uint8Array, off: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = off;
  while (true) {
    const b = buf[pos++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return [result >>> 0, pos];
}

interface DirEntry {
  tileId: number;
  offset: number;
  length: number;
  runLength: number;
  isLeaf: boolean;
}

function parseDirectory(bytes: Uint8Array): DirEntry[] {
  const [numEntries, p0] = readVarint(bytes, 0);
  let pos = p0;
  const ids = new Array<number>(numEntries);
  let lastId = 0;
  for (let i = 0; i < numEntries; i++) {
    const [v, p] = readVarint(bytes, pos);
    pos = p;
    lastId += v;
    ids[i] = lastId;
  }
  const runLengths = new Array<number>(numEntries);
  for (let i = 0; i < numEntries; i++) {
    const [v, p] = readVarint(bytes, pos);
    pos = p;
    runLengths[i] = v + 1;
  }
  const lengths = new Array<number>(numEntries);
  for (let i = 0; i < numEntries; i++) {
    const [v, p] = readVarint(bytes, pos);
    pos = p;
    lengths[i] = v;
  }
  const out: DirEntry[] = new Array(numEntries);
  for (let i = 0; i < numEntries; i++) {
    const [v, p] = readVarint(bytes, pos);
    pos = p;
    out[i] = {
      tileId: ids[i],
      runLength: runLengths[i],
      length: lengths[i],
      offset: v === 0 && i > 0 ? out[i - 1].offset + out[i - 1].length : v - 1,
      isLeaf: runLengths[i] === 0,
    };
  }
  return out;
}

// Tiles before zoom z, and Hilbert (z/x/y) id per the PMTiles v3 spec
// (canonical xy2d/d2xy; order-1 curve: (0,0)->0, (0,1)->1, (1,1)->2, (1,0)->3).
function zoomBase(z: number): number {
  let base = 0;
  for (let i = 0; i < z; i++) base += 4 ** i;
  return base;
}

function rot(n: number, a: number, b: number, rx: number, ry: number): [number, number] {
  if (ry === 0) {
    if (rx === 1) {
      a = n - 1 - a;
      b = n - 1 - b;
    }
    return [b, a];
  }
  return [a, b];
}

function zxyToTileId(z: number, x: number, y: number): number {
  const n = 1 << z;
  let d = 0;
  for (let s = n >> 1; s >= 1; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    [x, y] = rot(s, x, y, rx, ry);
  }
  return zoomBase(z) + d;
}

function tileIdToZxy(id: number): [number, number, number] {
  let z = 0;
  while (zoomBase(z + 1) <= id) z++;
  let t = id - zoomBase(z);
  let x = 0;
  let y = 0;
  for (let s = 1; s < (1 << z); s *= 2) {
    const rx = 1 & (t / 2);
    const ry = 1 & (t ^ rx);
    [x, y] = rot(s, x, y, rx, ry);
    x += s * rx;
    y += s * ry;
    t = Math.floor(t / 4);
  }
  return [z, x, y];
}

// Startup self-check against the known order-1 Hilbert curve.
{
  const known: Array<[number, number, number, number]> = [
    [0, 0, 0, 0],
    [1, 0, 0, 1],
    [1, 0, 1, 2],
    [1, 1, 1, 3],
    [1, 1, 0, 4],
  ];
  for (const [z, x, y, id] of known) {
    if (zxyToTileId(z, x, y) !== id) throw new Error(`hilbert self-check failed at ${z}/${x}/${y}`);
    const [rz, rx, ry] = tileIdToZxy(id);
    if (rz !== z || rx !== x || ry !== y) throw new Error(`hilbert inverse self-check failed at ${id}`);
  }
  for (let z = 0; z <= 4; z++) {
    for (let x = 0; x < (1 << z); x += 3) {
      for (let y = 0; y < (1 << z); y += 5) {
        const [rz, rx, ry] = tileIdToZxy(zxyToTileId(z, x, y));
        if (rz !== z || rx !== x || ry !== y) throw new Error(`hilbert round-trip failed at ${z}/${x}/${y}`);
      }
    }
  }
}

async function gunzipAsync(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("gzip");
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const out = await new Response(new Blob([ab]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}

interface Archive {
  data: Uint8Array;
  view: DataView;
  tileDataOffset: number;
}

function openArchive(data: Uint8Array): Archive {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = new TextDecoder().decode(data.subarray(0, 7));
  if (magic !== "PMTiles" || view.getUint8(7) !== 3) throw new Error("not a PMTiles v3 archive");
  // Header layout: rootOffset u64 @8, rootLength u64 @16, ..., tileDataOffset u64 @72.
  const tileDataOffset = Number(view.getBigUint64(72, true));
  return { data, view, tileDataOffset };
}

async function readDirEntries(
  archive: Archive,
  offset: number,
  length: number,
): Promise<DirEntry[]> {
  const raw = archive.data.subarray(offset, offset + length);
  return parseDirectory(await gunzipAsync(raw));
}

function findEntry(entries: DirEntry[], tileId: number): DirEntry | null {
  let lo = 0;
  let hi = entries.length - 1;
  let best: DirEntry | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].tileId <= tileId) {
      best = entries[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (!best) return null;
  return tileId < best.tileId + best.runLength ? best : null;
}

async function getTile(
  archive: Archive,
  root: DirEntry[],
  tileId: number,
): Promise<Uint8Array | null> {
  const rootHit = findEntry(root, tileId);
  if (!rootHit) return null;
  if (!rootHit.isLeaf) {
    const off = archive.tileDataOffset + rootHit.offset;
    return archive.data.subarray(off, off + rootHit.length);
  }
  const leaf = await readDirEntries(archive, archive.tileDataOffset + rootHit.offset, rootHit.length);
  const hit = findEntry(leaf, tileId);
  if (!hit) return null;
  const off = archive.tileDataOffset + hit.offset;
  return archive.data.subarray(off, off + hit.length);
}

function lonLatToTile(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const latR = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const y = Math.min(
    n - 1,
    Math.max(0, Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n)),
  );
  return [x, y];
}

// --- main ---

const src = arg("src");
const bboxArg = arg("bbox");
const outDir = arg("out", "server/tiles") ?? "server/tiles";
const name = arg("name", "region") ?? "region";
const maxzoom = Number(arg("maxzoom", "15") ?? "15");
if (!src || !bboxArg || !Number.isInteger(maxzoom) || maxzoom < 0 || maxzoom > 15) {
  console.error("usage: tiles_extract.ts --src <archive.pmtiles> --bbox minlon,minlat,maxlon,maxlat [--maxzoom 15] [--out server/tiles] [--name region]");
  Deno.exit(1);
}
const bbox = bboxArg.split(",").map(Number);
if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) {
  console.error("bad --bbox; want minlon,minlat,maxlon,maxlat");
  Deno.exit(1);
}
const [minlon, minlat, maxlon, maxlat] = bbox;

let archiveBytes: Uint8Array;
try {
  archiveBytes = await Deno.readFile(src);
} catch {
  console.error(`cannot read source archive: ${src}`);
  Deno.exit(1);
}
const archive = openArchive(archiveBytes);
const rootOffset = Number(archive.view.getBigUint64(8, true));
const rootLength = Number(archive.view.getBigUint64(16, true));
const root = await readDirEntries(archive, rootOffset, rootLength);

// Enumerate every z/x/y in the bbox up to maxzoom, pull present tiles.
let wrote = 0;
let bytes = 0;
for (let z = 0; z <= maxzoom; z++) {
  const [x0, y1] = lonLatToTile(minlon, maxlat, z);
  const [x1, y0] = lonLatToTile(maxlon, minlat, z);
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      const tile = await getTile(archive, root, zxyToTileId(z, x, y));
      if (!tile) continue;
      const path = join(outDir, String(z), String(x), `${y}.mvt`);
      await Deno.mkdir(join(path, ".."), { recursive: true });
      await Deno.writeFile(path, tile);
      wrote++;
      bytes += tile.length;
    }
  }
}
await Deno.copyFile(src, join(outDir, `${name}.pmtiles`));
console.log(`tiles: ${wrote} tiles (${(bytes / 1048576).toFixed(1)} MB unpacked) + ${name}.pmtiles`);
console.log(`serve from ${outDir}`);
