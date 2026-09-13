// Elevation tests: GLO-30 tile naming, absent-tile stub, 3 m hysteresis.

import { assert, assertEquals } from "@std/assert";
import {
  elevationGain,
  enrichTrackWithElevation,
  glo30TileName,
  lookupElevation,
} from "./elevation.ts";

Deno.test("GLO-30 tile names are 1-degree cells", () => {
  assertEquals(
    glo30TileName(52.37, 4.9),
    "Copernicus_DSM_COG_10_N52_00_E004_00_DEM.tif",
  );
  assertEquals(
    glo30TileName(-33.8, 151.2),
    "Copernicus_DSM_COG_10_S34_00_E151_00_DEM.tif",
  );
  assertEquals(
    glo30TileName(0, -0.5),
    "Copernicus_DSM_COG_10_N00_00_W001_00_DEM.tif",
  );
});

Deno.test("lookup returns null when tiles are absent or input is bad", async () => {
  const demDir = await Deno.makeTempDir({ prefix: "qala-dem-" });
  try {
    assertEquals(await lookupElevation(52.37, 4.9, demDir), null);
    assertEquals(await lookupElevation(91, 0, demDir), null);
    assertEquals(await lookupElevation(NaN, 0, demDir), null);
  } finally {
    await Deno.remove(demDir, { recursive: true });
  }
});

Deno.test("3 m hysteresis gain ignores sub-band noise", () => {
  // Noise of +/-1 m around 100 commits nothing.
  const flat = elevationGain([100, 101, 100, 101, 100, 99, 100]);
  assertEquals(flat.gainM, 0);
  assertEquals(flat.lossM, 0);
  assertEquals(flat.samples, 7);

  // A 4 m rise past the band commits, then a 3 m fall commits.
  const climb = elevationGain([0, 1, 2, 4, 4, 4, 1, 0]);
  assertEquals(climb.gainM, 4);
  assertEquals(climb.lossM, 3);

  // Null samples (no DEM coverage) are skipped without resetting.
  const gappy = elevationGain([0, null, 4, null, 1]);
  assertEquals(gappy.gainM, 4);
  assertEquals(gappy.lossM, 3);
  assertEquals(gappy.samples, 3);
});

Deno.test("track enrichment keeps nulls when tiles are absent", async () => {
  const demDir = await Deno.makeTempDir({ prefix: "qala-dem-" });
  try {
    const { track, summary } = await enrichTrackWithElevation(
      [{ lat: 52.37, lon: 4.9 }, { lat: 52.38, lon: 4.91 }],
      demDir,
    );
    assert(track.every((p) => p.alt === null));
    assertEquals(summary.samples, 0);
    assertEquals(summary.gainM, 0);
  } finally {
    await Deno.remove(demDir, { recursive: true });
  }
});
