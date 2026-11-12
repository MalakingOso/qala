// Auth tests: Tailscale header identity, cross-user doc rejection,
// loopback bind refusal, WebSocket Origin accept/reject policy.

import { test } from "bun:test";
import assert from "node:assert/strict";
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

test("identity header maps to a stable lowercase user id", () => {
  assert.deepStrictEqual(
    userIdFromRequest(req({ "Tailscale-User-Login": "Berkley" })),
    "berkley",
  );
  assert.deepStrictEqual(userIdFromRequest(req()), null);
  assert.deepStrictEqual(userIdFromRequest(req({ "Tailscale-User-Login": "  " })), null);
});

test("normalizeLogin trims and lowercases", () => {
  assert.deepStrictEqual(normalizeLogin("  Alice@Example  "), "alice@example");
});

test("missing identity header is a 401", () => {
  assert.throws(
    () => requireUser(req()),
    (err) => err instanceof AuthError && err.status === 401,
  );
});

test("cross-user document access is rejected", () => {
  assert.throws(
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
  assert.throws(
    () => requireDocOwnership("mallory", "doc-alice", null),
    AuthError,
  );
});

test("own document passes the ownership check", () => {
  requireDocOwnership("alice", "doc-alice", "doc-alice");
});

test("non-loopback binds are refused", () => {
  assertLoopbackBind("127.0.0.1");
  assertLoopbackBind("127.0.0.2");
  assertLoopbackBind("::1");
  assertLoopbackBind("localhost");
  assert.throws(() => assertLoopbackBind("0.0.0.0"), Error);
  assert.throws(() => assertLoopbackBind("192.168.1.5"), Error);
  assert.throws(() => assertLoopbackBind("100.105.14.62"), Error);
  assert.throws(() => assertLoopbackBind("example.com"), Error);
  assert(!isLoopbackHost("128.0.0.1"));
  assert(isLoopbackHost("127.255.255.255"));
});

test("ws upgrade: localhost origin with header is accepted", () => {
  const { userId } = checkWsUpgrade(
    new Request("ws://127.0.0.1:8500/sync", {
      headers: {
        Origin: "https://localhost",
        "Tailscale-User-Login": "berkley",
      },
    }),
  );
  assert.deepStrictEqual(userId, "berkley");
});

test("ws upgrade: no Origin with header is accepted (native client)", () => {
  const { userId } = checkWsUpgrade(
    new Request("ws://127.0.0.1:8500/sync", {
      headers: { "Tailscale-User-Login": "berkley" },
    }),
  );
  assert.deepStrictEqual(userId, "berkley");
});

test("ws upgrade: tailnet origin with header is accepted (auth is header-only)", () => {
  const { userId } = checkWsUpgrade(
    new Request("ws://127.0.0.1:8500/sync", {
      headers: {
        Origin: "https://callisto.taila63f23.ts.net",
        "Tailscale-User-Login": "berkley",
      },
    }),
  );
  assert.deepStrictEqual(userId, "berkley");
});

test("ws upgrade: any origin without the header is rejected", () => {
  for (
    const origin of [
      "https://localhost",
      "https://callisto.taila63f23.ts.net",
      "https://evil.example",
    ]
  ) {
    assert.throws(
      () =>
        checkWsUpgrade(
          new Request("ws://127.0.0.1:8500/sync", {
            headers: { Origin: origin },
          }),
        ),
      (err) => err instanceof AuthError && err.status === 401,
    );
  }
});
