import { assertEquals } from "@std/assert";
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

Deno.test("outbox keeps FIFO order and acknowledges by id", () => {
  const q = enqueue(enqueue([], op("a")), op("b"));
  assertEquals(q.map((o) => o.id), ["a", "b"]);
  assertEquals(acknowledge(q, "a").map((o) => o.id), ["b"]);
});

Deno.test("backoff doubles and caps at 60s", () => {
  assertEquals(nextBackoffMs(0), 1000);
  assertEquals(nextBackoffMs(3), 8000);
  assertEquals(nextBackoffMs(99), 60_000);
});

Deno.test("deserialize rejects garbage and keeps valid ops", () => {
  assertEquals(deserialize(null), []);
  assertEquals(deserialize("not json"), []);
  assertEquals(deserialize('{"x":1}'), []);
  const kept = deserialize(JSON.stringify([op("a"), { id: 7 }]));
  assertEquals(kept.map((o) => o.id), ["a"]);
});
