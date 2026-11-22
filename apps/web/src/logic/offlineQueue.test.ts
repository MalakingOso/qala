import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  deserialize,
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

test("deserialize rejects garbage and keeps valid ops", () => {
  assert.deepStrictEqual(deserialize(null), []);
  assert.deepStrictEqual(deserialize("not json"), []);
  assert.deepStrictEqual(deserialize('{"x":1}'), []);
  const kept = deserialize(JSON.stringify([op("a"), { id: 7 }]));
  assert.deepStrictEqual(kept.map((o) => o.id), ["a"]);
});
