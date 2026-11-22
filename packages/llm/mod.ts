// @qala/llm: the coach prompt and reply validation and the program import
// pipeline. Transport-injected: this package never calls fetch; the caller
// passes chat(messages, schema) -> parsed JSON.

export type {
  ChatMessage,
  ChatTransport,
  CoachMemoryEntry,
  JsonSchema,
} from "./prompts.ts";
export { EnvelopeAdjustSchema } from "./schemas.ts";
export {
  EditListSchema,
  IMPORT_LIMITS,
  validateEditList,
} from "./importSchema.ts";
export type {
  EditItem,
  EditListResult,
  RejectedItem,
  WeightUnit,
} from "./importSchema.ts";
export {
  ALIASES,
  AMBIGUOUS_NAMES,
  matchExercise,
  nameKey,
} from "./importMatch.ts";
export type {
  CatalogEntry,
  ConfirmReason,
  MatchResult,
} from "./importMatch.ts";
export {
  buildImportPrompt,
  IMPORT_SYSTEM_PROMPT,
  MAX_IMPORT_CHARS,
} from "./importPrompt.ts";
export {
  diffLines,
  emitLine,
  emitProgram,
  safeDayLabel,
} from "./importEmit.ts";
export type { DiffLine, ResolvedItem } from "./importEmit.ts";
export { importText, resolveEditList } from "./importPipeline.ts";
export {
  CHUNK_CHARS,
  chunkProgramText,
  importChunks,
  MAX_CHUNKS,
} from "./importChunk.ts";
export type { ChunkedImport, ChunkedText, ImportChunk } from "./importChunk.ts";
export type {
  ConfirmItem,
  ImportDeps,
  ImportProposal,
  ImportStatus,
  Resolutions,
} from "./importPipeline.ts";
export {
  buildCoachChatPrompt,
  COACH_LIMITS,
  coachReplySchema,
  coachScopeText,
  isCoachInScope,
  recentTurns,
  sanitizeCoachText,
  validateCoachReply,
} from "./coach.ts";
export type {
  CoachChatInput,
  CoachLift,
  CoachReplyResult,
  CoachTurn,
  CoachUnit,
  CoachWho,
} from "./coach.ts";
export {
  clampSets,
  clampWeightPct,
  classifyCoachTopic,
  COACH_TOPICS,
  DECLINE_TEXT,
  DEFAULT_ENVELOPE,
  hashPrompt,
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
