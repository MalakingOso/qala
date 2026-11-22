// Auth tests: Tailscale header identity and loopback bind refusal.

import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  assertLoopbackBind,
  AuthError,
  isLoopbackHost,
  normalizeLogin,
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
