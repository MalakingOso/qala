// POST /api/coach/ask (DECISIONS S14, docs/android-native.md sections 6 and 10).
// The Coach tab sends the athlete's message with a little context. The route
// builds the prompt with packages/llm, asks the shared llama-server for a JSON
// reply, checks it with packages/llm's validators and returns typed JSON. It
// writes nothing, and a model that is down, slow or answers with junk gives
// the degraded body that server/llm.ts uses, never a hang or a 500.
//
// The contract below is the one the Android client mirrors.
// testdata/golden/coach/ holds a request and the responses; the Deno tests
// here and the Kotlin tests in apps/android both check against those files.
//
//   Request: POST, JSON, identity from the Tailscale header (requireUser).
//     {
//       message: string,                  required, up to 600 characters
//       thread?: { who: "you" | "coach", text: string }[],
//                                         earlier turns, oldest first
//       context?: {
//         today?: string,                 "Lower A"
//         checkIn?: string,               "recovery 7, quads 4"
//         lift?: { title, weight, unit: "lb" | "kg", sets, reps, rpe? },
//                                         today's engine numbers; without
//                                         them the coach cannot suggest one
//         memory?: { date: "YYYY-MM-DD", source: "user" | "gemma" | "engine",
//                    text: string }[],    accepted facts only
//       }
//     }
//     Optional context that does not parse is dropped, not rejected.
//
//   200: CoachAskResponse below. "declined" means the athlete asked about
//        something outside fitness, training, health and recovery.
//   502: { degraded: true, error }   the model is unavailable or unusable
//   400, 405, 413: { error }         the request is wrong
//   401: { error }                   no Tailscale identity on the request

import { authErrorResponse, requireUser } from "./auth.ts";
import {
  buildCoachChatPrompt,
  COACH_LIMITS,
  type CoachChatInput,
  type CoachLift,
  type CoachMemoryEntry,
  coachReplySchema,
  type CoachTurn,
  type CoachUnit,
  DECLINE_TEXT,
  DEFAULT_ENVELOPE,
  type Envelope,
  hashPrompt,
  isCoachInScope,
  sanitizeCoachText,
  validateCoachReply,
} from "../packages/llm/mod.ts";
import type { AdjustmentResult } from "../packages/llm/mod.ts";
import { jsonSchemaFormat, proxyChatCompletions } from "./llm.ts";

/** Request body cap. The text caps are in COACH_LIMITS; this guards the JSON. */
export const MAX_COACH_BODY_BYTES = 32 * 1024;

/** The model call gets less than llm.ts's 60 s so the phone's own timeout comes second. */
export const COACH_TIMEOUT_MS = 45_000;

/** One lift's numbers, as the athlete would read them. */
export interface CoachNumbers {
  weight: number;
  unit: CoachUnit;
  sets: number;
  reps: number;
  rpe?: number;
}

/**
 * The coach's bounded change to today's lift, next to the engine's numbers.
 * `status` is "clamped" when the model went outside the limits and the numbers
 * were pulled back in. The weight is rounded to 2.5 lb or 1 kg; the phone may
 * snap it to what the plates can load.
 */
export interface CoachSuggestion {
  title: string;
  engine: CoachNumbers;
  coach: CoachNumbers;
  /** Percent change to the weight, after clamping. */
  weightPct: number;
  /** Change in the number of sets, after clamping. */
  setsDelta: number;
  /** The model's one-sentence reason. */
  reason: string;
  status: "accepted" | "clamped";
}

export interface CoachAskResponse {
  status: "ok" | "declined";
  reply: string;
  /** What the coach may move, so the phone prints the limits the server enforces. */
  limits: Envelope;
  suggestion?: CoachSuggestion;
}

export interface CoachRouteDeps {
  /** Base URL of the llama-server, for example http://127.0.0.1:8080. */
  baseUrl: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function label(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const text = sanitizeCoachText(v, COACH_LIMITS.labelChars);
  return text === "" ? undefined : text;
}

function inRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

function parseLift(v: unknown): CoachLift | undefined {
  if (!isRecord(v)) return undefined;
  const title = label(v["title"]);
  const unit = v["unit"] === "lb" || v["unit"] === "kg" ? v["unit"] : undefined;
  const { weight, sets, reps, rpe } = v;
  if (
    title === undefined || unit === undefined || !inRange(weight, 0.5, 2000) ||
    !inRange(sets, 1, 20) || !Number.isInteger(sets) ||
    !inRange(reps, 1, 100) || !Number.isInteger(reps)
  ) return undefined;
  const lift: CoachLift = { title, weight, unit, sets, reps };
  if (inRange(rpe, 1, 10)) lift.rpe = rpe;
  return lift;
}

function parseThread(v: unknown): CoachTurn[] {
  if (!Array.isArray(v)) return [];
  const turns: CoachTurn[] = [];
  for (const t of v) {
    if (!isRecord(t) || (t["who"] !== "you" && t["who"] !== "coach")) continue;
    if (typeof t["text"] !== "string") continue;
    const text = sanitizeCoachText(t["text"], COACH_LIMITS.turnChars);
    if (text !== "") turns.push({ who: t["who"], text });
  }
  return turns.slice(-COACH_LIMITS.turns);
}

function parseMemory(v: unknown): CoachMemoryEntry[] {
  if (!Array.isArray(v)) return [];
  const out: CoachMemoryEntry[] = [];
  for (const m of v) {
    if (!isRecord(m)) continue;
    const { date, source, text } = m;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (source !== "user" && source !== "gemma" && source !== "engine") {
      continue;
    }
    if (typeof text !== "string") continue;
    const clean = sanitizeCoachText(text, COACH_LIMITS.memoryChars);
    if (clean === "") continue;
    out.push({
      id: `m${out.length}`,
      date,
      source,
      text: clean,
      accepted: true,
    });
  }
  return out.slice(0, COACH_LIMITS.memoryEntries);
}

/** Turn a request body into prompt input, or say what is wrong with it. */
export function parseCoachRequest(
  body: unknown,
): { ok: true; input: CoachChatInput } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "body must be an object" };
  const message = body["message"];
  if (typeof message !== "string" || message.trim() === "") {
    return { ok: false, error: "message is required" };
  }
  if (message.length > COACH_LIMITS.messageChars) {
    return {
      ok: false,
      error: `message is longer than ${COACH_LIMITS.messageChars} characters`,
    };
  }
  const ctx = isRecord(body["context"]) ? body["context"] : {};
  return {
    ok: true,
    input: {
      message: sanitizeCoachText(message, COACH_LIMITS.messageChars),
      thread: parseThread(body["thread"]),
      today: label(ctx["today"]),
      checkIn: label(ctx["checkIn"]),
      lift: parseLift(ctx["lift"]),
      memory: parseMemory(ctx["memory"]),
    },
  };
}

const ROUND_STEP: Record<CoachUnit, number> = { lb: 2.5, kg: 1 };

function numbers(l: CoachLift, weight: number, sets: number): CoachNumbers {
  const out: CoachNumbers = { weight, unit: l.unit, sets, reps: l.reps };
  if (l.rpe !== undefined) out.rpe = l.rpe;
  return out;
}

/**
 * The coach's weight: the percent applied, rounded to the unit's step, and
 * kept inside the envelope. Rounding alone can step a few tenths of a percent
 * past a limit, so an overshoot moves back in by one step. If no step fits
 * inside the envelope (a very light weight) the engine's weight stays.
 */
function coachWeightFor(
  weight: number,
  pct: number,
  step: number,
  env: Envelope,
): number {
  const eps = 1e-9;
  const lo = weight * (1 + env.weightPctMin / 100);
  const hi = weight * (1 + env.weightPctMax / 100);
  let w = Math.round(weight * (1 + pct / 100) / step) * step;
  if (w < lo) w = Math.ceil(lo / step - eps) * step;
  if (w > hi) w = Math.floor(hi / step + eps) * step;
  return w < lo - eps || w > hi + eps ? weight : w;
}

/**
 * The card's numbers: the engine's lift beside the coach's, from the
 * validated (and possibly clamped) percent and set change. Null when the
 * adjustment moves nothing once rounded.
 */
export function buildSuggestion(
  lift: CoachLift,
  adjustment: AdjustmentResult,
  env: Envelope = DEFAULT_ENVELOPE,
): CoachSuggestion | null {
  const value = adjustment.value;
  if (value === null || adjustment.status === "discarded") return null;
  const coachWeight = coachWeightFor(
    lift.weight,
    value.weightPct,
    ROUND_STEP[lift.unit],
    env,
  );
  const coachSets = Math.max(1, lift.sets + value.sets);
  if (coachWeight === lift.weight && coachSets === lift.sets) return null;
  const pct = Math.round((coachWeight / lift.weight - 1) * 1000) / 10;
  return {
    title: lift.title,
    engine: numbers(lift, lift.weight, lift.sets),
    coach: numbers(lift, coachWeight, coachSets),
    weightPct: pct,
    setsDelta: coachSets - lift.sets,
    reason: value.reason,
    status: adjustment.status,
  };
}

function degraded(error: string): Response {
  return Response.json({ degraded: true, error }, { status: 502 });
}

function declined(): Response {
  const body: CoachAskResponse = {
    status: "declined",
    reply: DECLINE_TEXT,
    limits: { ...DEFAULT_ENVELOPE },
  };
  return Response.json(body);
}

/** Serve POST /api/coach/ask. Never hangs: the model call has its own timeout. */
export async function serveCoachAsk(
  req: Request,
  deps: CoachRouteDeps,
): Promise<Response> {
  try {
    requireUser(req);
  } catch (err) {
    return authErrorResponse(err);
  }
  if (req.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_COACH_BODY_BYTES) {
    return Response.json({ error: "request body too large" }, { status: 413 });
  }
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ error: "could not read body" }, { status: 400 });
  }
  if (raw.length > MAX_COACH_BODY_BYTES) {
    return Response.json({ error: "request body too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = parseCoachRequest(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const { input } = parsed;
  if (!isCoachInScope(input)) return declined();

  try {
    const messages = buildCoachChatPrompt(input);
    const withAdjustment = input.lift !== undefined;
    const result = await proxyChatCompletions({
      messages,
      baseUrl: deps.baseUrl,
      responseFormat: jsonSchemaFormat(
        "coach_reply",
        coachReplySchema(withAdjustment),
      ),
      timeoutMs: deps.timeoutMs ?? COACH_TIMEOUT_MS,
      // A reply is at most four sentences; the cap keeps a runaway model short.
      extra: { max_tokens: 700 },
    }, deps.fetchFn);
    if (!result.ok) return degraded(result.error);
    const content = (result.data as {
      choices?: { message?: { content?: unknown } }[];
    })?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return degraded("model reply had no content");
    }
    const reply = validateCoachReply(content, {
      withAdjustment,
      promptHash: hashPrompt(JSON.stringify(messages)),
    });
    if (!reply.ok) {
      return degraded(`model reply was not usable: ${reply.error}`);
    }
    if (reply.declined) return declined();
    const response: CoachAskResponse = {
      status: "ok",
      reply: reply.message,
      limits: { ...DEFAULT_ENVELOPE },
    };
    if (input.lift && reply.adjustment) {
      const suggestion = buildSuggestion(input.lift, reply.adjustment);
      if (suggestion) response.suggestion = suggestion;
    }
    return Response.json(response);
  } catch (err) {
    return degraded(err instanceof Error ? err.message : String(err));
  }
}
