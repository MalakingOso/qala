// LLM proxy (PLAN.md section 11). Forwards chat completions to the shared
// llama-server on 127.0.0.1:8080 and degrades gracefully when it is absent:
// every feature works without the model, so a down backend is a 502 with a
// `degraded: true` body, never a hung request or a 500.

export const LLAMA_DEFAULTS = {
  baseUrl: "http://127.0.0.1:8080",
  model: "gemma-4-E4B_q4_0-it",
  temperature: 0,
  /** Same 60 s request timeout as Beamer's LLM client. */
  timeoutMs: 60_000,
} as const;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  baseUrl?: string;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
  /** Value for the OpenAI `response_format` field (json_schema calls). */
  responseFormat?: unknown;
  /** Extra body fields passed straight through to llama-server. */
  extra?: Record<string, unknown>;
}

export type LlmResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; degraded: true; status?: number; error: string };

/** Build an OpenAI `json_schema` response format for structured calls. */
export function jsonSchemaFormat(
  name: string,
  schema: unknown,
): Record<string, unknown> {
  return {
    type: "json_schema",
    json_schema: { name, schema, strict: true },
  };
}

function degraded(error: string, status?: number): LlmResult {
  return status === undefined
    ? { ok: false, degraded: true, error }
    : { ok: false, degraded: true, status, error };
}

/**
 * POST to `{baseUrl}/v1/chat/completions` with model, temperature 0 and an
 * abort timeout. Returns a degraded result (never throws) when the backend
 * is down, slow, or answers with non-JSON or an error status.
 */
export async function proxyChatCompletions(
  options: ChatOptions,
  fetchFn: typeof fetch = fetch,
): Promise<LlmResult> {
  const {
    messages,
    baseUrl = LLAMA_DEFAULTS.baseUrl,
    model = LLAMA_DEFAULTS.model,
    temperature = LLAMA_DEFAULTS.temperature,
    timeoutMs = LLAMA_DEFAULTS.timeoutMs,
    responseFormat,
    extra = {},
  } = options;
  const body: Record<string, unknown> = {
    model,
    temperature,
    messages,
    ...extra,
  };
  if (responseFormat !== undefined) body["response_format"] = responseFormat;
  let res: Response;
  try {
    res = await fetchFn(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return degraded(err instanceof Error ? err.message : String(err));
  }
  let data: unknown;
  try {
    data = JSON.parse(await res.text());
  } catch {
    return degraded(
      `model server returned non-JSON (status ${res.status})`,
      res.status,
    );
  }
  if (!res.ok) {
    const message =
      (data as { error?: { message?: string } })?.error?.message ??
        `model server status ${res.status}`;
    return degraded(message, res.status);
  }
  return { ok: true, status: res.status, data };
}

/** Shape of the HTTP body accepted at POST /api/llm/chat. */
export interface LlmApiBody {
  messages?: ChatMessage[];
  response_format?: unknown;
  model?: string;
  extra?: Record<string, unknown>;
}

/** Serve POST /api/llm/chat: validate, proxy, degrade gracefully. */
export async function serveLlmChat(
  req: Request,
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }
  let body: LlmApiBody;
  try {
    body = (await req.json()) as LlmApiBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "messages[] is required" }, { status: 400 });
  }
  const result = await proxyChatCompletions(
    {
      messages: body.messages,
      baseUrl,
      model: body.model,
      responseFormat: body.response_format,
      extra: body.extra,
    },
    fetchFn,
  );
  if (!result.ok) {
    return Response.json(
      { degraded: true, error: result.error },
      { status: 502 },
    );
  }
  return Response.json(result.data, { status: result.status });
}
