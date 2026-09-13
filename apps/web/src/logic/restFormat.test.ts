import { assertEquals } from "@std/assert";
import { formatClock, formatRestWhy } from "./restFormat.ts";

Deno.test("ticking clock pads seconds", () => {
  assertEquals(formatClock(225), "3:45");
  assertEquals(formatClock(9.2), "0:10");
});

Deno.test("why-line matches the DESIGN 7.6 shape", () => {
  assertEquals(
    formatRestWhy(225, {
      base: 180,
      adjustments: [
        { label: "your pace", seconds: -15 },
        { label: "last set RPE 9 vs 8", seconds: 30 },
        { label: "set 4 of squat", seconds: 30 },
      ],
    }),
    "3:45 · base 3:00, your pace -15 s, last set RPE 9 vs 8 +30 s, set 4 of squat +30 s",
  );
});
