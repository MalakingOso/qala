// Fetch Copernicus GLO-30 DEM tiles covering a bbox (PLAN.md section 8a).
//
//   deno run --allow-all scripts/dem_fetch.ts \
//     --bbox "-84.6,42.6,-83.5,43.4" --out server/tiles/dem \
//     --base-url https://example-mirror.org/glo30 [--dry-run]
//
// Tile file names reuse server/elevation.ts's rule (e.g.
// `Copernicus_DSM_COG_10_N52_00_E004_00_DEM.tif`) and are fetched as
// `<base-url>/<name>`. No mirror is hardcoded: pass the base URL of a
// GLO-30 mirror holding that layout (the Copernicus AWS Open Data bucket
// uses it). Existing files are skipped, so reruns resume. --dry-run only
// lists the 1-degree cells the bbox needs.
//
// Bbox format: minlon,minlat,maxlon,maxlat (WGS84 degrees).

import { glo30TileName } from "../server/elevation.ts";

function arg(name: string, def?: string): string | undefined {
  const i = Deno.args.findIndex((a) => a === `--${name}`);
  if (i >= 0) return Deno.args[i + 1] ?? def;
  const kv = Deno.args.find((a) => a.startsWith(`--${name}=`));
  return kv ? kv.slice(name.length + 3) : def;
}
const flag = (name: string): boolean => Deno.args.includes(`--${name}`);

const bboxArg = arg("bbox");
const outDir = arg("out", "server/tiles/dem") ?? "server/tiles/dem";
const base = (arg("base-url") ?? "").replace(/\/+$/, "");
const dryRun = flag("dry-run");
if (!bboxArg) {
  console.error(
    "usage: dem_fetch.ts --bbox minlon,minlat,maxlon,maxlat [--out server/tiles/dem] --base-url <mirror> [--dry-run]",
  );
  Deno.exit(1);
}
const bbox = (bboxArg as string).split(",").map(Number);
if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) {
  console.error("bad --bbox; want minlon,minlat,maxlon,maxlat");
  Deno.exit(1);
}
if (!dryRun && !base) {
  console.error(
    "pass --base-url <mirror holding <name> files> (or --dry-run to list cells)",
  );
  Deno.exit(1);
}
const [minlon, minlat, maxlon, maxlat] = bbox;

// 1-degree cells covering the bbox (GLO-30 tiles are 1-degree squares).
const cells = new Set<string>();
for (let lat = Math.floor(minlat); lat <= Math.floor(maxlat); lat++) {
  for (let lon = Math.floor(minlon); lon <= Math.floor(maxlon); lon++) {
    cells.add(glo30TileName(lat + 0.5, lon + 0.5));
  }
}
const names = [...cells].sort();
if (dryRun || !base) {
  console.log(`${names.length} cell(s):`);
  for (const n of names) console.log(`  ${n}`);
  Deno.exit(0);
}

await Deno.mkdir(outDir, { recursive: true });
let fetched = 0;
let skipped = 0;
for (const n of names) {
  const dest = `${outDir}/${n}`;
  try {
    await Deno.stat(dest);
    skipped++;
    continue;
  } catch {
    // missing: fetch it
  }
  const url = `${base}/${n}`;
  console.log(`fetch ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    console.error(`  HTTP ${res.status}; left for a later rerun`);
    continue;
  }
  const file = await Deno.open(dest + ".part", { write: true, create: true });
  try {
    await res.body.pipeTo(file.writable);
  } catch (err) {
    console.error(`  download failed: ${(err as Error).message}`);
    continue;
  }
  await Deno.rename(dest + ".part", dest);
  fetched++;
}
console.log(
  `dem: ${fetched} fetched, ${skipped} already present, ${names.length} needed`,
);
