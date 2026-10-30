/* Generate next block (DESIGN 7.15, PLAN 12): the generator's input built
 * from what the program page shows, then generateBlock and emitProgram. The
 * web app runs on sample data, so the input is the sample block and the lift
 * estimates; the text goes to the editor as an unsaved draft and nothing is
 * saved. */

import {
  emitProgram,
  generateBlock,
  type GeneratorInput,
} from "../../../../packages/generator/mod.ts";

/** What the current block is, where the sample has no field for it: a
 * 4-day upper/lower strength block (the page's profile line), about 5 h a
 * week with warm-ups over the 4 lift days, an intermediate lifter. */
export const NEXT_BLOCK_PLAN = {
  goal: "strength",
  daysPerWeek: 4,
  sessionMinutes: 75,
  experience: "intermediate",
} as const satisfies Partial<GeneratorInput>;

/** Lift ids in the web app that the generator spells differently. */
const GENERATOR_ID: Record<string, string> = { press: "ohp" };

export interface BlockShape {
  /** Weeks in the block, the last one the deload. */
  of: number;
}

export interface LiftEstimate {
  id: string;
  /** Kalman e1RM, which becomes the next block's reference 1RM (PLAN 6.3). */
  kalman: number;
}

export function nextBlockInput(
  block: BlockShape,
  lifts: readonly LiftEstimate[],
): GeneratorInput {
  const referenceRm: Record<string, number> = {};
  for (const l of lifts) {
    referenceRm[GENERATOR_ID[l.id] ?? l.id] = Math.round(l.kalman);
  }
  return {
    ...NEXT_BLOCK_PLAN,
    // Empty means a full gym to the generator. The settings' equipment list
    // is recovery kit (foam roller, bike), not lifting gear.
    equipment: [],
    priorities: {},
    exclusions: [],
    blockWeeks: block.of,
    referenceRm,
  };
}

export type NextBlockOutcome =
  | { ok: true; text: string; name: string }
  | { ok: false; message: string };

/** Never throws: the generator's input checks come back as a sentence. */
export function generateNextBlock(input: GeneratorInput): NextBlockOutcome {
  try {
    const block = generateBlock(input);
    return { ok: true, text: emitProgram(block, input), name: block.name };
  } catch (err) {
    return {
      ok: false,
      message: `The generator stopped: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}
