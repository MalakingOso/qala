import { assert, assertEquals } from "@std/assert";
import { sampleBlock, sampleLifts } from "../store/sample.ts";
import {
  generateNextBlock,
  NEXT_BLOCK_PLAN,
  nextBlockInput,
} from "./nextBlock.ts";

Deno.test("the input comes from the block and the lift estimates", () => {
  const input = nextBlockInput({ of: 6 }, [
    { id: "squat", kalman: 282.6 },
    { id: "press", kalman: 154 },
  ]);
  assertEquals(input.blockWeeks, 6);
  assertEquals(input.referenceRm, { squat: 283, ohp: 154 });
  assertEquals(input.goal, "strength");
  assertEquals(input.daysPerWeek, 4);
  assertEquals(input.equipment, [], "empty is a full gym to the generator");
});

Deno.test("the fixed plan agrees with the block the page shows", () => {
  assert(
    sampleBlock.profile.startsWith(`${NEXT_BLOCK_PLAN.daysPerWeek}-day`),
    `profile "${sampleBlock.profile}"`,
  );
  assert(/strength/i.test(sampleBlock.name), `name "${sampleBlock.name}"`);
  const input = nextBlockInput(sampleBlock, sampleLifts);
  assertEquals(Object.keys(input.referenceRm).sort(), [
    "bench",
    "deadlift",
    "ohp",
    "squat",
  ]);
  assertEquals(input.referenceRm["ohp"], 154, "Press's Kalman e1RM");
});

Deno.test("the sample block generates program text, the same every time", () => {
  const input = nextBlockInput(sampleBlock, sampleLifts);
  const a = generateNextBlock(input);
  const b = generateNextBlock(input);
  assert(a.ok && b.ok);
  assertEquals(a.text, b.text);
  assertEquals(a.name, "Strength block (DUP)");
  assert(a.text.startsWith("# Strength block (DUP)\n"), a.text.slice(0, 40));
  assert(a.text.includes("referenceRm: bench=243"), "bench reference");
});

Deno.test("an input the generator refuses comes back as a sentence", () => {
  const input = nextBlockInput({ of: 9 }, sampleLifts);
  const out = generateNextBlock(input);
  assert(!out.ok);
  assertEquals(
    out.message,
    "The generator stopped: blockWeeks must be 2-7 (docs/PLAN.md 12 block length)",
  );
});
