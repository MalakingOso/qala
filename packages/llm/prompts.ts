// Prompt builders for the seven PLAN.md section 11 features.
//
// Every builder injects the same context block: coach memory, the
// computed profile, the last-4-weeks summary, today's engine output,
// and the numeric envelope. Transport is injected: builders return
// messages, the caller passes them to chat(messages, schema).

import { DEFAULT_ENVELOPE, type Envelope } from "./validate.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type JsonSchema = Record<string, unknown>;

/**
 * Transport the caller provides. Receives the built messages plus the
 * feature's JSON schema and resolves with parsed JSON.
 */
export type ChatTransport = (
  messages: ChatMessage[],
  schema: JsonSchema,
) => Promise<unknown>;

export interface CoachMemoryEntry {
  id: string;
  date: string;
  source: "user" | "gemma" | "engine";
  text: string;
  accepted: boolean;
}

export interface ComputedProfile {
  /** Calibrated engine parameters, e.g. per-lift p0/k1/theta. */
  calibration: string;
  /** Per-muscle recovery pattern. */
  recoveryPattern: string;
  /** Adherence, e.g. sessions completed vs planned. */
  adherence: string;
  /** PR trend, e.g. e1RM change per main lift. */
  prTrend: string;
  notes?: string;
}

export interface FourWeekSummary {
  sessions: number;
  runs: number;
  distanceKm: number;
  /** Combined sRPE-load, labelled TRIMP in the UI. */
  trimp: number;
  trimpLift: number;
  trimpRun: number;
  /** Composite performance score, % change vs baseline. */
  performancePct: number;
  vdotTrend: string;
  notes?: string;
}

export interface EngineOutput {
  kind: "lift" | "run" | "general";
  /** Engine recommendation in words and numbers. */
  recommendation: string;
  /** Reason codes the model narrates, including cross-modal ones. */
  reasons: string[];
  envelopeNote?: string;
}

export interface PromptContext {
  coachMemory: CoachMemoryEntry[];
  computedProfile: ComputedProfile;
  fourWeekSummary: FourWeekSummary;
  engineOutput: EngineOutput;
  envelope: Envelope;
}

export function defaultContext(): PromptContext {
  return {
    coachMemory: [],
    computedProfile: {
      calibration: "No calibrated parameters yet; population defaults.",
      recoveryPattern: "No per-muscle recovery pattern yet.",
      adherence: "No history yet.",
      prTrend: "No PRs yet.",
    },
    fourWeekSummary: {
      sessions: 0,
      runs: 0,
      distanceKm: 0,
      trimp: 0,
      trimpLift: 0,
      trimpRun: 0,
      performancePct: 0,
      vdotTrend: "No VDOT observations yet.",
    },
    engineOutput: {
      kind: "general",
      recommendation: "No engine recommendation yet.",
      reasons: [],
    },
    envelope: { ...DEFAULT_ENVELOPE },
  };
}

function renderMemory(memory: CoachMemoryEntry[]): string {
  const accepted = memory.filter((m) => m.accepted);
  if (accepted.length === 0) return "Coach memory: none yet.";
  const lines = accepted.map((m) => `- [${m.date}] (${m.source}) ${m.text}`);
  return `Coach memory (visible, editable per-user facts):\n${lines.join("\n")}`;
}

function renderProfile(p: ComputedProfile): string {
  const lines = [
    `Computed profile:`,
    `- Calibration: ${p.calibration}`,
    `- Recovery pattern: ${p.recoveryPattern}`,
    `- Adherence: ${p.adherence}`,
    `- PR trend: ${p.prTrend}`,
  ];
  if (p.notes) lines.push(`- Notes: ${p.notes}`);
  return lines.join("\n");
}

function renderSummary(s: FourWeekSummary): string {
  const lines = [
    `Last 4 weeks: ${s.sessions} sessions, ${s.runs} runs, ` +
    `${s.distanceKm} km, TRIMP ${s.trimp} ` +
    `(lift ${s.trimpLift} / run ${s.trimpRun}), ` +
    `performance ${s.performancePct >= 0 ? "+" : ""}${s.performancePct}%.`,
    `VDOT trend: ${s.vdotTrend}`,
  ];
  if (s.notes) lines.push(`Notes: ${s.notes}`);
  return lines.join("\n");
}

function renderEngine(e: EngineOutput): string {
  const lines = [
    `Today's engine output (${e.kind}): ${e.recommendation}`,
    e.reasons.length > 0
      ? `Reason codes: ${e.reasons.join(", ")}`
      : `Reason codes: none.`,
  ];
  if (e.envelopeNote) lines.push(e.envelopeNote);
  return lines.join("\n");
}

function renderEnvelope(env: Envelope): string {
  return `Envelope: weight ${env.weightPctMin}% to +${env.weightPctMax}%, ` +
    `sets ${env.setsMin} to +${env.setsMax}. ` +
    `Stay inside it; out-of-envelope numbers are clamped or discarded.`;
}

/** Shared context block injected into every feature prompt. */
export function renderContextBlock(ctx: PromptContext): string {
  return [
    renderMemory(ctx.coachMemory),
    renderProfile(ctx.computedProfile),
    renderSummary(ctx.fourWeekSummary),
    renderEngine(ctx.engineOutput),
    renderEnvelope(ctx.envelope),
  ].join("\n\n");
}

const COACH_SYSTEM =
  "You are Qala's training coach. You speak plainly about fitness, " +
  "training, health and recovery, and you decline anything outside those " +
  "topics. You never diagnose injuries. Numbers you suggest must stay " +
  "inside the given envelope. Reply with JSON only, matching the schema.";

function build(systemExtra: string, ctx: PromptContext, task: string): ChatMessage[] {
  return [
    { role: "system", content: `${COACH_SYSTEM}\n\n${systemExtra}\n\n${renderContextBlock(ctx)}` },
    { role: "user", content: task },
  ];
}

/** Feature 1: check-in free text -> structured JSON. */
export function buildCheckinPrompt(ctx: PromptContext, freeText: string): ChatMessage[] {
  return build(
    "Parse the athlete's free-text check-in line into sleep hours, " +
    "stress, injury flags, time limits and notes. Only use what the text says.",
    ctx,
    `Check-in text: ${JSON.stringify(freeText)}`,
  );
}

/** Feature 2: bounded adjustment of the engine recommendation. */
export function buildEnvelopeAdjustPrompt(
  ctx: PromptContext,
  engineRecommendation: string,
): ChatMessage[] {
  return build(
    "Suggest a bounded adjustment to the engine recommendation as " +
    "{weightPct, sets, reason} with a one-sentence reason. " +
    "Both values must stay inside the envelope.",
    ctx,
    `Engine recommendation to adjust: ${engineRecommendation}`,
  );
}

/** Feature 3: explain today's session or run from the reason codes. */
export function buildExplanationPrompt(
  ctx: PromptContext,
  sessionDescription: string,
): ChatMessage[] {
  return build(
    "Explain today's session or run workout in plain words from the " +
    "reason codes, including cross-modal ones such as why a planned " +
    "interval run became easy. Use the computed numbers only.",
    ctx,
    `Session to explain: ${sessionDescription}`,
  );
}

/** Feature 4: phrase recovery nudges and injury flags. */
export function buildRecoveryPrompt(
  ctx: PromptContext,
  flagCodes: string[],
): ChatMessage[] {
  return build(
    "Phrase the engine recovery/injury flag codes as a short coach " +
    "message. Flag, never diagnose. Suggest a deload or rest when the " +
    "codes call for one.",
    ctx,
    `Flag codes: ${flagCodes.join(", ") || "none"}`,
  );
}

/** Feature 5: weekly summary narrative from the computed numbers. */
export function buildWeeklyNarrativePrompt(ctx: PromptContext): ChatMessage[] {
  return build(
    "Write the weekly summary narrative from the computed numbers only: " +
    "sessions, runs, distance, TRIMP with the lift/run split, " +
    "performance percent change, VDOT trend.",
    ctx,
    "Write this week's summary narrative.",
  );
}

/** Feature 6: goal free text -> generator parameters JSON. */
export function buildGoalParamsPrompt(
  ctx: PromptContext,
  goalText: string,
): ChatMessage[] {
  return build(
    "Map the athlete's free-text goal to generator parameters JSON, for " +
    "lifting (goal, days, priorities) and running (race distance and " +
    "date, runs per week, hybrid priority). Ask for nothing; use defaults " +
    "for anything unstated.",
    ctx,
    `Goal text: ${JSON.stringify(goalText)}`,
  );
}

/** Feature 7: propose coach-memory facts for accept/reject. */
export function buildMemoryProposalPrompt(
  ctx: PromptContext,
  recentCheckins: string[],
): ChatMessage[] {
  return build(
    "Propose dated, sourced coach-memory facts from the recent " +
    "check-ins. Each proposal is shown for accept/reject before saving, " +
    "so keep them atomic and cite the source check-in.",
    ctx,
    `Recent check-ins:\n${recentCheckins.map((c) => `- ${c}`).join("\n") || "- none"}`,
  );
}
