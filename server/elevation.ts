// Server-side elevation (docs/PLAN.md section 8a): Copernicus GLO-30 lookup for
// the filtered run track (GPS altitude is never used).

import { stat } from "node:fs/promises";

/**
 * GLO-30 tile name covering `lat`/`lon`. Tiles are 1x1 degree, named like
 * `Copernicus_DSM_COG_10_N52_00_E004_00_DEM.tif`.
 */
export function glo30TileName(lat: number, lon: number): string {
  const latFloor = Math.floor(lat);
  const lonFloor = Math.floor(lon);
  const latPart = `${latFloor >= 0 ? "N" : "S"}${
    String(Math.abs(latFloor)).padStart(2, "0")
  }_00`;
  const lonPart = `${lonFloor >= 0 ? "E" : "W"}${
    String(Math.abs(lonFloor)).padStart(3, "0")
  }_00`;
  return `Copernicus_DSM_COG_10_${latPart}_${lonPart}_DEM.tif`;
}

/** Local path of the DEM tile covering `lat`/`lon`. */
export function tileFileFor(demDir: string, lat: number, lon: number): string {
  return `${demDir.replace(/\/+$/, "")}/${glo30TileName(lat, lon)}`;
}

/**
 * Look up elevation in metres for one coordinate.
 *
 * TODO (needs the dem:fetch tiles): decode the GLO-30 tile (deflate GeoTIFF)
 * and bilinearly interpolate the cell covering lat/lon. Until a GeoTIFF
 * decoder lands, this returns null when the tile file is absent (the normal
 * state before `dem:fetch` runs) so callers fall back to recording no
 * elevation rather than wrong elevation. Returns null for out-of-range input.
 */
export async function lookupElevation(
  lat: number,
  lon: number,
  demDir: string,
): Promise<number | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  try {
    await stat(tileFileFor(demDir, lat, lon));
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
  // Tile present but no decoder yet; see TODO above.
  return null;
}
