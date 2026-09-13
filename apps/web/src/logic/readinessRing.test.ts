import { assertEquals } from "@std/assert";
import { readinessRing } from "./readinessRing.ts";

Deno.test("sample ring: 72 with avg 76, low 64", () => {
  const r = readinessRing(0.72, 76, 64, 20, 7);
  assertEquals(r.value, 72);
  assertEquals(r.low, false);
  assertEquals(r.avgFrac, 0.76);
  assertEquals(r.legendAvg, "your avg 76");
  assertEquals(r.legendLow, "low under 64");
});

Deno.test("PRS 4 or below is always low", () => {
  assertEquals(readinessRing(0.8, 76, 64, 20, 4).low, true);
});

Deno.test("average hidden before 14 check-ins, low line at 50", () => {
  const r = readinessRing(0.72, 76, 64, 5, 7);
  assertEquals(r.avgFrac, null);
  assertEquals(r.lowFrac, 0.5);
  assertEquals(r.legendLow, "low under 50");
});
