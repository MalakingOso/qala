// Chat types and the coach system prompt. Transport is injected: the caller
// passes the built messages to chat(messages, schema).

import { type Envelope } from "./validate.ts";

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

export function renderEnvelope(env: Envelope): string {
  return `Envelope: weight ${env.weightPctMin}% to +${env.weightPctMax}%, ` +
    `sets ${env.setsMin} to +${env.setsMax}. ` +
    `Stay inside it; out-of-envelope numbers are clamped or discarded.`;
}

export const COACH_SYSTEM =
  "You are Qala's training coach. You speak plainly about fitness, " +
  "training, health and recovery, and you decline anything outside those " +
  "topics. You never diagnose injuries. Numbers you suggest must stay " +
  "inside the given envelope. Reply with JSON only, matching the schema.";
