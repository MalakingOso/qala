// LLM proxy tests: request shape forwarded to llama-server, and graceful
// degradation when the backend is down, slow, or answers badly.

import { assert, assertEquals } from "@std/assert";
import {
  jsonSchemaFormat,
  LLAMA_DEFAULTS,
  proxyChatCompletions,
  serveLlmChat,
} from "./llm.ts";

Deno.test("proxy forwards model, temperature 0, and json_schema format", async () => {
  let seenUrl = "";
  let seenBody: Record<string, unknown> = {};
  const stubFetch = (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    seenUrl = String(url);
    seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Promise.resolve(
      Response.json({ choices: [{ message: { content: "{}" } }] }),
    );
  };
  const schema = { type: "object", properties: { ok: { type: "boolean" } } };
  const result = await proxyChatCompletions(
    {
      messages: [{ role: "user", content: "hi" }],
      responseFormat: jsonSchemaFormat("checkin", schema),
    },
    stubFetch as typeof fetch,
  );
  assert(result.ok);
  assertEquals(seenUrl, `${LLAMA_DEFAULTS.baseUrl}/v1/chat/completions`);
  assertEquals(seenBody["model"], LLAMA_DEFAULTS.model);
  assertEquals(seenBody["temperature"], 0);
  assertEquals(
    seenBody["response_format"],
    jsonSchemaFormat("checkin", schema),
  );
});

Deno.test("proxy degrades when the backend is down (never throws)", async () => {
  const refused = (): Promise<Response> =>
    Promise.reject(new TypeError("fetch failed: connection refused"));
  const result = await proxyChatCompletions(
    { messages: [{ role: "user", content: "hi" }], timeoutMs: 1000 },
    refused as unknown as typeof fetch,
  );
  assert(!result.ok && result.degraded);
  assert(result.error.length > 0);
});

Deno.test("proxy degrades on timeout", async () => {
  const slow = (
    _url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")));
    });
  const result = await proxyChatCompletions(
    { messages: [{ role: "user", content: "hi" }], timeoutMs: 50 },
    slow as unknown as typeof fetch,
  );
  assert(!result.ok && result.degraded);
});

Deno.test("proxy degrades on error status and non-JSON", async () => {
  const errStatus = (): Promise<Response> =>
    Promise.resolve(
      new Response(JSON.stringify({ error: { message: "no models" } }), {
        status: 500,
      }),
    );
  const failed = await proxyChatCompletions(
    { messages: [{ role: "user", content: "hi" }] },
    errStatus as typeof fetch,
  );
  assert(!failed.ok && failed.degraded && failed.status === 500);

  const notJson = (): Promise<Response> =>
    Promise.resolve(new Response("not json", { status: 200 }));
  const garbled = await proxyChatCompletions(
    { messages: [{ role: "user", content: "hi" }] },
    notJson as typeof fetch,
  );
  assert(!garbled.ok && garbled.degraded);
});

Deno.test("POST /api/llm/chat validates and maps degrade to 502", async () => {
  const down = (): Promise<Response> =>
    Promise.reject(new TypeError("connection refused"));
  const bad = await serveLlmChat(
    new Request("http://x/api/llm/chat", {
      method: "POST",
      body: JSON.stringify({}),
    }),
    "http://127.0.0.1:1",
    down as unknown as typeof fetch,
  );
  assertEquals(bad.status, 400);

  const degraded = await serveLlmChat(
    new Request("http://x/api/llm/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    }),
    "http://127.0.0.1:1",
    down as unknown as typeof fetch,
  );
  assertEquals(degraded.status, 502);
  const body = await degraded.json() as { degraded?: boolean };
  assertEquals(body.degraded, true);

  const wrongMethod = await serveLlmChat(
    new Request("http://x/api/llm/chat"),
    "http://127.0.0.1:1",
    down as unknown as typeof fetch,
  );
  assertEquals(wrongMethod.status, 405);
});
