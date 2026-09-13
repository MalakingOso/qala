import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
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

Deno.test("lb/kg conversions round-trip", () => {
  assertAlmostEquals(convertWeight(45, "lb", "kg"), 20.4117, 1e-3);
  assertAlmostEquals(
    convertWeight(convertWeight(100, "lb", "kg"), "kg", "lb"),
    100,
    1e-6,
  );
  assertEquals(convertWeight(45, "lb", "lb"), 45);
});

Deno.test("mi/km/m conversions", () => {
  assertAlmostEquals(convertDistance(1, "mi", "m"), 1609.344, 1e-9);
  assertEquals(convertDistance(5, "km", "m"), 5000);
  assertAlmostEquals(distanceMToDisplay(1609.344, "mi"), 1, 1e-9);
  assertAlmostEquals(displayToDistanceM(1, "mi"), 1609.344, 1e-9);
  assertAlmostEquals(
    convertDistance(convertDistance(3.1, "mi", "km"), "km", "mi"),
    3.1,
    1e-9,
  );
});

Deno.test("lifting weights pass through as {value, unit}", () => {
  const w = { value: 135, unit: "lb" as const };
  assertEquals(weightValueToUnit(w, "lb"), w);
  assertAlmostEquals(weightValueToUnit(w, "kg").value, 61.235, 1e-3);
  assertEquals(formatWeight(w), "135 lb");
});

Deno.test("pace formats as min/mi and parses back (running stays SI)", () => {
  // 8:00/mi in SI.
  const secPerM = parsePaceToSecPerM("8:00", "mi");
  assertAlmostEquals(secPerM, 480 / 1609.344, 1e-9);
  assertEquals(formatPace(secPerM, "mi"), "8:00");
  // Speed round-trip.
  assertAlmostEquals(secPerMToMps(secPerM) * secPerM, 1, 1e-9);
  assertAlmostEquals(mpsToMph(secPerMToMps(secPerM)), 7.5, 1e-9);
  assertThrows(() => parsePaceToSecPerM("fast", "mi"), RangeError);
  assert(formatPace(parsePaceToSecPerM("5:00", "km"), "km") === "5:00");
});
