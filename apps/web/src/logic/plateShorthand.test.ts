import { assertEquals } from "@std/assert";
import {
  changeInstruction,
  formatShorthand,
  platesPerSide,
} from "./plateShorthand.ts";

Deno.test("245 on a 45 bar is 45+45+10 per side", () => {
  assertEquals(platesPerSide(245), [45, 45, 10]);
});

Deno.test("warm-up ramp keeps inner plates describable", () => {
  assertEquals(platesPerSide(100), [25, 2.5]);
  assertEquals(platesPerSide(135), [45]);
});

Deno.test("shorthand formats per DESIGN 5.8", () => {
  assertEquals(formatShorthand([45, 45, 10]), "per side 45 · 45 · 10");
  assertEquals(formatShorthand([]), "bar only");
});

Deno.test("change instruction diffs inner runs", () => {
  assertEquals(changeInstruction([45, 45, 10], [45, 45, 10]), "Same as last set");
  assertEquals(
    changeInstruction([45, 10], [45, 25]),
    "take off 10, add 25 each side",
  );
});
