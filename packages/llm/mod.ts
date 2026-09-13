// @qala/llm: prompt builders, JSON schemas, response validation and
// coach-memory proposals. Transport-injected: this package never calls
// fetch; the caller passes chat(messages, schema) -> parsed JSON.

export type {
  ChatMessage,
  ChatTransport,
  CoachMemoryEntry,
  ComputedProfile,
  EngineOutput,
  FourWeekSummary,
  JsonSchema,
  PromptContext,
} from "./prompts.ts";
export {
  buildCheckinPrompt,
  buildEnvelopeAdjustPrompt,
  buildExplanationPrompt,
  buildGoalParamsPrompt,
  buildMemoryProposalPrompt,
  buildRecoveryPrompt,
  buildWeeklyNarrativePrompt,
  defaultContext,
  renderContextBlock,
} from "./prompts.ts";
export {
  CheckinParseSchema,
  EnvelopeAdjustSchema,
  ExplanationSchema,
  FeatureSchemas,
  GoalParamsSchema,
  MemoryProposalSchema,
  RecoveryPhrasingSchema,
  WeeklyNarrativeSchema,
} from "./schemas.ts";
export type { FeatureKind } from "./schemas.ts";
export {
  acceptedMemories,
  acceptProposal,
  deserializeProposals,
  pendingProposals,
  proposeMemories,
  rejectProposal,
  serializeProposals,
} from "./memory.ts";
export type { MemoryProposal, MemorySource, ProposalStatus } from "./memory.ts";
export {
  clampSets,
  clampWeightPct,
  classifyCoachTopic,
  COACH_TOPICS,
  DECLINE_TEXT,
  declineResponse,
  DEFAULT_ENVELOPE,
  hashPrompt,
  isCoachTopic,
  isOutOfEnvelope,
  validateEnvelopeAdjustment,
} from "./validate.ts";
export type {
  AdjustmentResult,
  AdjustmentStatus,
  Envelope,
  EnvelopeAdjustment,
  LlmLogEntry,
  TopicVerdict,
  ValidateOptions,
} from "./validate.ts";
