// JSON schema for the coach's envelope adjustment.
// Passed to chat(messages, schema) as response_format json_schema.

import type { JsonSchema } from "./prompts.ts";

/** Envelope adjustment: weight percent and sets, with a one-sentence reason. */
export const EnvelopeAdjustSchema: JsonSchema = {
  type: "object",
  properties: {
    weightPct: { type: "number" },
    sets: { type: "integer" },
    reason: { type: "string" },
  },
  required: ["weightPct", "sets", "reason"],
  additionalProperties: false,
};
