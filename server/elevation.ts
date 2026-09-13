// Server-side elevation (PLAN.md section 8a): Copernicus GLO-30 lookup for
// the filtered run track (GPS altitude is never used), with a 3 m hysteresis
// band for gain so barometer-style noise does not inflate climbing.

/** Hysteresis band in metres: smaller swings are treated as noise. */
export const ELEVATION_HYSTERESIS_M = 3;

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
    await Deno.stat(tileFileFor(demDir, lat, lon));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
  // Tile present but no decoder yet; see TODO above.
  return null;
}

export interface ElevationSummary {
  gainM: number;
  lossM: number;
  samples: number;
}

/**
 * Climb and descent with a hysteresis band: only accumulated movement beyond
 * the band commits to gain/loss, so small oscillations around a level do not
 * count. Null samples (no DEM coverage) are skipped without resetting.
 */
export function elevationGain(
  elevations: ReadonlyArray<number | null>,
  hysteresisM = ELEVATION_HYSTERESIS_M,
): ElevationSummary {
  let gainM = 0;
  let lossM = 0;
  let samples = 0;
  let ref: number | null = null;
  for (const e of elevations) {
    if (e === null || !Number.isFinite(e)) continue;
    samples += 1;
    if (ref === null) {
      ref = e;
      continue;
    }
    if (e - ref >= hysteresisM) {
      gainM += e - ref;
      ref = e;
    } else if (ref - e >= hysteresisM) {
      lossM += ref - e;
      ref = e;
    }
  }
  return { gainM, lossM, samples };
}

export interface TrackPoint {
  lat: number;
  lon: number;
  alt?: number | null;
}

/**
 * Fill `alt` for each track point from the DEM and summarise climb/descent.
 * Points without coverage keep `alt: null` and are skipped by the gain math.
 */
export async function enrichTrackWithElevation(
  track: TrackPoint[],
  demDir: string,
  hysteresisM = ELEVATION_HYSTERESIS_M,
): Promise<{ track: TrackPoint[]; summary: ElevationSummary }> {
  const out: TrackPoint[] = [];
  for (const p of track) {
    out.push({ ...p, alt: await lookupElevation(p.lat, p.lon, demDir) });
  }
  const summary = elevationGain(
    out.map((p) => p.alt ?? null),
    hysteresisM,
  );
  return { track: out, summary };
}
