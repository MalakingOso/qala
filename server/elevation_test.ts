// Elevation tests: GLO-30 tile naming and the absent-tile stub.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  glo30TileName,
  lookupElevation,
} from "./elevation.ts";

test("GLO-30 tile names are 1-degree cells", () => {
  assert.deepStrictEqual(
    glo30TileName(52.37, 4.9),
    "Copernicus_DSM_COG_10_N52_00_E004_00_DEM.tif",
  );
  assert.deepStrictEqual(
    glo30TileName(-33.8, 151.2),
    "Copernicus_DSM_COG_10_S34_00_E151_00_DEM.tif",
  );
  assert.deepStrictEqual(
    glo30TileName(0, -0.5),
    "Copernicus_DSM_COG_10_N00_00_W001_00_DEM.tif",
  );
});

test("lookup returns null when tiles are absent or input is bad", async () => {
  const demDir = await mkdtemp(join(tmpdir(), "qala-dem-"));
  try {
    assert.deepStrictEqual(await lookupElevation(52.37, 4.9, demDir), null);
    assert.deepStrictEqual(await lookupElevation(91, 0, demDir), null);
    assert.deepStrictEqual(await lookupElevation(NaN, 0, demDir), null);
  } finally {
    await rm(demDir, { recursive: true, force: true });
  }
});
