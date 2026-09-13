import { assertEquals } from "@std/assert";
import { weekTotals } from "./weeklyLoad.ts";
import { sampleWeekLoad } from "../store/sample.ts";

Deno.test("sample week totals split lifting and running", () => {
  const t = weekTotals(sampleWeekLoad);
  assertEquals(t.liftDone, 1250);
  assertEquals(t.runDone, 600);
  assertEquals(t.planned, 1760 + 1020);
  assertEquals(t.done, 1850);
});
