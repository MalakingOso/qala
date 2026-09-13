// Envelope validation for Gemma numeric adjustments.
//
// PLAN.md section 11 + DECISIONS.md P3: Gemma may nudge the engine
// recommendation inside a fixed envelope (weight -10% to +2.5%,
// sets -2 to +1). Adjusted and engine values are both shown, one tap
// reverts, every adjustment is logged with the model's one-sentence
// reason. Parseable but out-of-envelope numbers are clamped into the
// envelope; unparseable output (or output missing a required field)
// is discarded. Both paths produce an llmLog entry.

export interface Envelope {
  weightPctMin: number;
  weightPctMax: number;
  setsMin: number;
  setsMax: number;
}

export const DEFAULT_ENVELOPE: Envelope = {
  weightPctMin: -10,
  weightPctMax: 2.5,
  setsMin: -2,
  setsMax: 1,
};

export interface EnvelopeAdjustment {
  /** Weight change in percent of the engine recommendation. */
  weightPct: number;
  /** Set-count change relative to the engine recommendation. */
  sets: number;
  /** The model's one-sentence reason, shown next to the engine value. */
  reason: string;
}

export interface LlmLogEntry {
  date: string;
  kind: string;
  promptHash: string;
  output: unknown;
  accepted: boolean;
}

export type AdjustmentStatus = "accepted" | "clamped" | "discarded";

export interface AdjustmentResult {
  status: AdjustmentStatus;
  /** Null when discarded. */
  value: EnvelopeAdjustment | null;
  log: LlmLogEntry;
}

export interface ValidateOptions {
  envelope?: Envelope;
  kind?: string;
  promptHash?: string;
  date?: string;
  /**
   * When true, out-of-envelope numbers discard instead of clamping.
   * Default false: clamp per PLAN 11 ("clamped/discarded and logged").
   */
  strict?: boolean;
}

/** FNV-1a 32-bit hash, hex encoded. Sync stand-in for a prompt hash. */
export function hashPrompt(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ("0000000" + (h >>> 0).toString(16)).slice(-8);
}

export function clampWeightPct(
  v: number,
  env: Envelope = DEFAULT_ENVELOPE,
): number {
  return Math.min(env.weightPctMax, Math.max(env.weightPctMin, v));
}

export function clampSets(v: number, env: Envelope = DEFAULT_ENVELOPE): number {
  return Math.min(env.setsMax, Math.max(env.setsMin, Math.round(v)));
}

export function isOutOfEnvelope(
  adj: EnvelopeAdjustment,
  env: Envelope = DEFAULT_ENVELOPE,
): boolean {
  return (
    adj.weightPct < env.weightPctMin ||
    adj.weightPct > env.weightPctMax ||
    adj.sets < env.setsMin ||
    adj.sets > env.setsMax
  );
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function discard(
  output: unknown,
  opts: ValidateOptions,
  _reason: string,
): AdjustmentResult {
  return {
    status: "discarded",
    value: null,
    log: {
      date: opts.date ?? new Date().toISOString(),
      kind: opts.kind ?? "envelope-adjust",
      promptHash: opts.promptHash ?? "",
      output,
      accepted: false,
    },
  };
}

/**
 * Validate one envelope-adjustment object. Accepts either an already
 * parsed value or a raw JSON string (model output is often a string).
 */
export function validateEnvelopeAdjustment(
  raw: unknown,
  opts: ValidateOptions = {},
): AdjustmentResult {
  const env = opts.envelope ?? DEFAULT_ENVELOPE;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return discard(raw, opts, "unparseable JSON");
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return discard(raw, opts, "not an object");
  }
  const rec = parsed as Record<string, unknown>;
  const weightPct = toFiniteNumber(rec["weightPct"]);
  const sets = toFiniteNumber(rec["sets"]);
  const reason = rec["reason"];
  if (weightPct === null || sets === null) {
    return discard(raw, opts, "weightPct/sets missing or not numeric");
  }
  if (typeof reason !== "string" || reason.trim() === "") {
    return discard(raw, opts, "reason missing");
  }
  const adj: EnvelopeAdjustment = {
    weightPct,
    sets: Math.round(sets),
    reason: reason.trim(),
  };
  if (isOutOfEnvelope(adj, env)) {
    if (opts.strict) return discard(raw, opts, "out of envelope (strict)");
    const clamped: EnvelopeAdjustment = {
      weightPct: clampWeightPct(adj.weightPct, env),
      sets: clampSets(adj.sets, env),
      reason: adj.reason,
    };
    return {
      status: "clamped",
      value: clamped,
      log: {
        date: opts.date ?? new Date().toISOString(),
        kind: opts.kind ?? "envelope-adjust",
        promptHash: opts.promptHash ?? "",
        output: clamped,
        accepted: true,
      },
    };
  }
  return {
    status: "accepted",
    value: adj,
    log: {
      date: opts.date ?? new Date().toISOString(),
      kind: opts.kind ?? "envelope-adjust",
      promptHash: opts.promptHash ?? "",
      output: adj,
      accepted: true,
    },
  };
}

// Persona boundary for the Coach tab (docs/adr/0001-coach-open-chat.md):
// conversation is open-ended within fitness/training/health/recovery
// and declines unrelated requests. Actions the coach proposes must
// still resolve to a PLAN 11 feature and pass the envelope above.

export const COACH_TOPICS = [
  "fitness",
  "training",
  "health",
  "recovery",
] as const;

export const DECLINE_TEXT =
  "I am your training coach, so I stay inside fitness, training, health " +
  "and recovery. I cannot help with that one, but I can help with your " +
  "training, running, recovery, or health habits.";

const IN_SCOPE_KEYWORDS = [
  "fitness",
  "train",
  "lift",
  "squat",
  "bench",
  "deadlift",
  "press",
  "program",
  "workout",
  "exercise",
  "set",
  "rep",
  "rpe",
  "rir",
  "run",
  "pace",
  "mile",
  "kilometer",
  "tempo",
  "interval",
  "marathon",
  "recovery",
  "recover",
  "sleep",
  "sore",
  "muscle",
  "cardio",
  "strength",
  "hypertrophy",
  "powerlift",
  "bodybuild",
  "protein",
  "nutrition",
  "diet",
  "health",
  "injury",
  "pain",
  "fatigue",
  "readiness",
  "warmup",
  "warm-up",
  "warm up",
  "rest",
  "deload",
  "volume",
  "tonnage",
  "1rm",
  "e1rm",
  "pr",
  "plate",
  "barbell",
  "dumbbell",
  "coach",
  "goal",
  "weight",
  "bodyweight",
  "mobility",
  "stretch",
  "foam",
  "heart rate",
  "hrv",
  "zone 2",
  "vo2",
  "vdot",
  "taper",
  "meet",
  "race",
  "habit",
  "stress",
  "wellness",
];

const OUT_OF_SCOPE_PHRASES = [
  "tax",
  "election",
  "vote for",
  "president",
  "mortgage",
  "loan",
  "crypto",
  "bitcoin",
  "stock",
  "homework",
  "essay",
  "exam",
  "visa",
  "lawsuit",
  "lawyer",
  "debug",
  "borrow checker",
  "compiler",
  "javascript",
  "typescript",
  "python",
  "rust",
  "computer program",
  "insurance claim",
  "car repair",
  "plumbing",
];

export interface TopicVerdict {
  inScope: boolean;
  topics: string[];
}

/**
 * These are short enough to turn up embedded in unrelated words under a
 * plain substring check ("pr"/"rep" inside "prepare", "set" inside "upset",
 * "rest" inside "restaurant", "run" inside "brunch") — require a real word
 * boundary, with an optional trailing "s" for the plural ("reps", "sets").
 */
const AMBIGUOUS_SHORT_KEYWORDS = new Set([
  "pr",
  "rep",
  "set",
  "run",
  "rest",
  "rpe",
  "rir",
  "1rm",
]);

function inScopeHit(lower: string): boolean {
  return IN_SCOPE_KEYWORDS.some((k) =>
    AMBIGUOUS_SHORT_KEYWORDS.has(k)
      ? new RegExp(`\\b${k}s?\\b`, "i").test(lower)
      : lower.includes(k)
  );
}

/**
 * Keyword classifier for the coach persona boundary. Default is decline:
 * scope requires a genuine in-scope hit, and any out-of-scope hit declines
 * even alongside one (a message that mixes topics still isn't clearly
 * in-scope).
 */
export function classifyCoachTopic(text: string): TopicVerdict {
  const lower = text.toLowerCase();
  const inHit = inScopeHit(lower);
  const outHit = OUT_OF_SCOPE_PHRASES.some((p) => lower.includes(p));
  if (!inHit || outHit) return { inScope: false, topics: [] };
  const topics = COACH_TOPICS.filter((t) => lower.includes(t));
  return { inScope: true, topics: topics.length > 0 ? topics : ["training"] };
}

export function isCoachTopic(text: string): boolean {
  return classifyCoachTopic(text).inScope;
}

export function declineResponse(): { message: string } {
  return { message: DECLINE_TEXT };
}
