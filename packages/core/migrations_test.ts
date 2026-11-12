import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  createBaselineDocument,
  CURRENT_SCHEMA_VERSION,
  migrate,
  migrateV0ToV1,
} from "./migrations.ts";

test("baseline document is v1 with required sections", () => {
  const doc = createBaselineDocument();
  assert.deepStrictEqual(doc.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.deepStrictEqual(doc.settings.units, { weight: "lb", distance: "mi" });
  assert.deepStrictEqual(doc.settings.barbellStep, 5);
  assert.deepStrictEqual(doc.settings.dumbbellStep, 5);
  assert.deepStrictEqual(doc.settings.plates.bars, [
    { id: "bar-olympic", name: "Olympic bar", weight: 45, default: true },
  ]);
  assert.deepStrictEqual(doc.equipment.recovery, ["foamRoller", "percussionMassager"]);
  assert.deepStrictEqual(doc.history, []);
  assert.deepStrictEqual(doc.activeProgramId, "");
  assert.deepStrictEqual(doc.daySkips, []);
  assert.deepStrictEqual(doc.availability, { status: "active" });
});

test("v0 document (no schemaVersion) migrates to v1 baseline", () => {
  const doc = migrateV0ToV1({});
  assert.deepStrictEqual(doc.schemaVersion, 1);
  assert.deepStrictEqual(doc.settings.warmup.preferPercussion, true);
  // Partial v0 settings are preserved and completed.
  const partial = migrateV0ToV1({
    settings: { units: { weight: "kg", distance: "km" } },
  });
  assert.deepStrictEqual(partial.settings.units, { weight: "kg", distance: "km" });
  assert.deepStrictEqual(partial.settings.barbellStep, 5);
  assert.deepStrictEqual(partial.history, []);
});

test("migrate passes v1 through and rejects the future", () => {
  const v1 = createBaselineDocument();
  assert.deepStrictEqual(migrate(v1), v1);
  assert.deepStrictEqual(migrate({}).schemaVersion, 1);
  assert.throws(() => migrate({ schemaVersion: 999 }), RangeError);
});
