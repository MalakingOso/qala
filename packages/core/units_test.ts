import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  convertDistance,
  convertWeight,
  displayToDistanceM,
  distanceMToDisplay,
  formatPace,
  formatWeight,
  mpsToMph,
  parsePaceToSecPerM,
  secPerMToMps,
  weightValueToUnit,
} from "./units.ts";

test("lb/kg conversions round-trip", () => {
  assert.ok(Math.abs(convertWeight(45, "lb", "kg") - 20.4117) <= 1e-3);
  assert.ok(Math.abs(convertWeight(convertWeight(100, "lb", "kg"), "kg", "lb") - 100) <= 1e-6);
  assert.deepStrictEqual(convertWeight(45, "lb", "lb"), 45);
});

test("mi/km/m conversions", () => {
  assert.ok(Math.abs(convertDistance(1, "mi", "m") - 1609.344) <= 1e-9);
  assert.deepStrictEqual(convertDistance(5, "km", "m"), 5000);
  assert.ok(Math.abs(distanceMToDisplay(1609.344, "mi") - 1) <= 1e-9);
  assert.ok(Math.abs(displayToDistanceM(1, "mi") - 1609.344) <= 1e-9);
  assert.ok(Math.abs(convertDistance(convertDistance(3.1, "mi", "km"), "km", "mi") - 3.1) <= 1e-9);
});

test("lifting weights pass through as {value, unit}", () => {
  const w = { value: 135, unit: "lb" as const };
  assert.deepStrictEqual(weightValueToUnit(w, "lb"), w);
  assert.ok(Math.abs(weightValueToUnit(w, "kg").value - 61.235) <= 1e-3);
  assert.deepStrictEqual(formatWeight(w), "135 lb");
});

test("pace formats as min/mi and parses back (running stays SI)", () => {
  // 8:00/mi in SI.
  const secPerM = parsePaceToSecPerM("8:00", "mi");
  assert.ok(Math.abs(secPerM - 480 / 1609.344) <= 1e-9);
  assert.deepStrictEqual(formatPace(secPerM, "mi"), "8:00");
  // Speed round-trip.
  assert.ok(Math.abs(secPerMToMps(secPerM) * secPerM - 1) <= 1e-9);
  assert.ok(Math.abs(mpsToMph(secPerMToMps(secPerM)) - 7.5) <= 1e-9);
  assert.throws(() => parsePaceToSecPerM("fast", "mi"), RangeError);
  assert(formatPace(parsePaceToSecPerM("5:00", "km"), "km") === "5:00");
});
