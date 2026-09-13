// Auth tests: Tailscale header identity, cross-user doc rejection,
// loopback bind refusal, WebSocket Origin accept/reject policy.

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  assertLoopbackBind,
  AuthError,
  checkWsUpgrade,
  isLoopbackHost,
  normalizeLogin,
  requireDocOwnership,
  requireUser,
  userIdFromRequest,
} from "./auth.ts";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1:8500/sync", { headers });
}

Deno.test("identity header maps to a stable lowercase user id", () => {
  assertEquals(
    userIdFromRequest(req({ "Tailscale-User-Login": "Berkley" })),
    "berkley",
  );
  assertEquals(userIdFromRequest(req()), null);
  assertEquals(userIdFromRequest(req({ "Tailscale-User-Login": "  " })), null);
});

Deno.test("normalizeLogin trims and lowercases", () => {
  assertEquals(normalizeLogin("  Alice@Example  "), "alice@example");
});

Deno.test("missing identity header is a 401", () => {
  const err = assertThrows(() => requireUser(req()), AuthError);
  assertEquals(err.status, 401);
});

Deno.test("cross-user document access is rejected", () => {
  assertThrows(
    () => requireDocOwnership("alice", "doc-bob", "doc-alice"),
    AuthError,
  );
  try {
    requireDocOwnership("alice", "doc-bob", "doc-alice");
    throw new Error("unreachable");
  } catch (err) {
    assert(err instanceof AuthError && err.status === 403);
  }
  // Unknown users own nothing.
  assertThrows(
    () => requireDocOwnership("mallory", "doc-alice", null),
    AuthError,
  );
});

Deno.test("own document passes the ownership check", () => {
  requireDocOwnership("alice", "doc-alice", "doc-alice");
});

Deno.test("non-loopback binds are refused", () => {
  assertLoopbackBind("127.0.0.1");
  assertLoopbackBind("127.0.0.2");
  assertLoopbackBind("::1");
  assertLoopbackBind("localhost");
  assertThrows(() => assertLoopbackBind("0.0.0.0"), Error);
  assertThrows(() => assertLoopbackBind("192.168.1.5"), Error);
  assertThrows(() => assertLoopbackBind("100.105.14.62"), Error);
  assertThrows(() => assertLoopbackBind("example.com"), Error);
  assert(!isLoopbackHost("128.0.0.1"));
  assert(isLoopbackHost("127.255.255.255"));
});

Deno.test("ws upgrade: Capacitor origin with header is accepted", () => {
  const { userId } = checkWsUpgrade(
    new Request("ws://127.0.0.1:8500/sync", {
      headers: {
        Origin: "https://localhost",
        "Tailscale-User-Login": "berkley",
      },
    }),
  );
  assertEquals(userId, "berkley");
});

Deno.test("ws upgrade: tailnet origin with header is accepted (auth is header-only)", () => {
  const { userId } = checkWsUpgrade(
    new Request("ws://127.0.0.1:8500/sync", {
      headers: {
        Origin: "https://callisto.taila63f23.ts.net",
        "Tailscale-User-Login": "berkley",
      },
    }),
  );
  assertEquals(userId, "berkley");
});

Deno.test("ws upgrade: any origin without the header is rejected", () => {
  for (
    const origin of [
      "https://localhost",
      "https://callisto.taila63f23.ts.net",
      "https://evil.example",
    ]
  ) {
    const err = assertThrows(
      () =>
        checkWsUpgrade(
          new Request("ws://127.0.0.1:8500/sync", {
            headers: { Origin: origin },
          }),
        ),
      AuthError,
    );
    assertEquals(err.status, 401);
  }
});
