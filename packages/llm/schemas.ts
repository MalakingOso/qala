// JSON schemas for the seven PLAN.md section 11 features.
// Passed to chat(messages, schema) as response_format json_schema.

import type { JsonSchema } from "./prompts.ts";

function strictObject(
  properties: Record<string, JsonSchema>,
  required: string[],
): JsonSchema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

/** Feature 1: check-in free text parse. */
export const CheckinParseSchema: JsonSchema = strictObject(
  {
    sleepHours: { type: "number", minimum: 0, maximum: 24 },
    stress: { type: "number", minimum: 1, maximum: 7 },
    injury: { type: "string" },
    timeLimitMin: { type: "number", minimum: 0 },
    notes: { type: "string" },
  },
  [],
);

/** Feature 2: envelope adjustment. */
export const EnvelopeAdjustSchema: JsonSchema = strictObject(
  {
    weightPct: { type: "number" },
    sets: { type: "integer" },
    reason: { type: "string" },
  },
  ["weightPct", "sets", "reason"],
);

/** Feature 3: prescription explanation. */
export const ExplanationSchema: JsonSchema = strictObject(
  {
    title: { type: "string" },
    body: { type: "string" },
    bullets: { type: "array", items: { type: "string" } },
  },
  ["title", "body"],
);

/** Feature 4: recovery nudge / injury flag phrasing. */
export const RecoveryPhrasingSchema: JsonSchema = strictObject(
  {
    message: { type: "string" },
    severity: { type: "string", enum: ["info", "caution", "stop"] },
    suggestedAction: { type: "string" },
  },
  ["message", "severity"],
);

/** Feature 5: weekly summary narrative. */
export const WeeklyNarrativeSchema: JsonSchema = strictObject(
  {
    headline: { type: "string" },
    body: { type: "string" },
    highlights: { type: "array", items: { type: "string" } },
  },
  ["headline", "body"],
);

/** Feature 6: goal text -> generator parameters. */
export const GoalParamsSchema: JsonSchema = strictObject(
  {
    lifting: strictObject(
      {
        goal: {
          type: "string",
          enum: ["hypertrophy", "strength", "meetPrep", "athleticMaintenance"],
        },
        daysPerWeek: { type: "integer", minimum: 1, maximum: 7 },
        priorities: { type: "array", items: { type: "string" } },
        blockWeeks: { type: "integer", minimum: 2, maximum: 7 },
      },
      [],
    ),
    running: strictObject(
      {
        raceDistanceM: { type: "number", minimum: 0 },
        raceDate: { type: "string" },
        runsPerWeek: { type: "integer", minimum: 0, maximum: 14 },
        hybridPriority: { type: "string", enum: ["lifting", "running"] },
      },
      [],
    ),
  },
  [],
);

/** Feature 7: coach-memory proposals. */
export const MemoryProposalSchema: JsonSchema = strictObject(
  {
    proposals: {
      type: "array",
      items: strictObject(
        {
          text: { type: "string" },
          source: { type: "string", enum: ["user", "gemma", "engine"] },
          reason: { type: "string" },
        },
        ["text", "source"],
      ),
    },
  },
  ["proposals"],
);

export const FeatureSchemas = {
  checkinParse: CheckinParseSchema,
  envelopeAdjust: EnvelopeAdjustSchema,
  explanation: ExplanationSchema,
  recoveryPhrasing: RecoveryPhrasingSchema,
  weeklyNarrative: WeeklyNarrativeSchema,
  goalParams: GoalParamsSchema,
  memoryProposals: MemoryProposalSchema,
} as const;

export type FeatureKind = keyof typeof FeatureSchemas;
