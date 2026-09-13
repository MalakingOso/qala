import { assertEquals, assertThrows } from "@std/assert";
import {
  createBaselineDocument,
  CURRENT_SCHEMA_VERSION,
  migrate,
  migrateV0ToV1,
} from "./migrations.ts";

Deno.test("baseline document is v1 with required sections", () => {
  const doc = createBaselineDocument();
  assertEquals(doc.schemaVersion, CURRENT_SCHEMA_VERSION);
  assertEquals(doc.settings.units, { weight: "lb", distance: "mi" });
  assertEquals(doc.settings.barbellStep, 5);
  assertEquals(doc.settings.dumbbellStep, 5);
  assertEquals(doc.settings.plates.bars, [
    { id: "bar-olympic", name: "Olympic bar", weight: 45, default: true },
  ]);
  assertEquals(doc.equipment.recovery, ["foamRoller", "percussionMassager"]);
  assertEquals(doc.history, []);
  assertEquals(doc.activeProgramId, "");
});

Deno.test("v0 document (no schemaVersion) migrates to v1 baseline", () => {
  const doc = migrateV0ToV1({});
  assertEquals(doc.schemaVersion, 1);
  assertEquals(doc.settings.warmup.preferPercussion, true);
  // Partial v0 settings are preserved and completed.
  const partial = migrateV0ToV1({
    settings: { units: { weight: "kg", distance: "km" } },
  });
  assertEquals(partial.settings.units, { weight: "kg", distance: "km" });
  assertEquals(partial.settings.barbellStep, 5);
  assertEquals(partial.history, []);
});

Deno.test("migrate passes v1 through and rejects the future", () => {
  const v1 = createBaselineDocument();
  assertEquals(migrate(v1), v1);
  assertEquals(migrate({}).schemaVersion, 1);
  assertThrows(() => migrate({ schemaVersion: 999 }), RangeError);
});
