import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  acknowledge,
  deserialize,
  enqueue,
  nextBackoffMs,
  type QueuedOp,
} from "./offlineQueue.ts";

function op(id: string): QueuedOp {
  return {
    id,
    kind: "log-set",
    at: "2026-09-13T17:00:00Z",
    payload: {},
    attempts: 0,
  };
}

test("outbox keeps FIFO order and acknowledges by id", () => {
  const q = enqueue(enqueue([], op("a")), op("b"));
  assert.deepStrictEqual(q.map((o) => o.id), ["a", "b"]);
  assert.deepStrictEqual(acknowledge(q, "a").map((o) => o.id), ["b"]);
});

test("backoff doubles and caps at 60s", () => {
  assert.deepStrictEqual(nextBackoffMs(0), 1000);
  assert.deepStrictEqual(nextBackoffMs(3), 8000);
  assert.deepStrictEqual(nextBackoffMs(99), 60_000);
});

test("deserialize rejects garbage and keeps valid ops", () => {
  assert.deepStrictEqual(deserialize(null), []);
  assert.deepStrictEqual(deserialize("not json"), []);
  assert.deepStrictEqual(deserialize('{"x":1}'), []);
  const kept = deserialize(JSON.stringify([op("a"), { id: 7 }]));
  assert.deepStrictEqual(kept.map((o) => o.id), ["a"]);
});
