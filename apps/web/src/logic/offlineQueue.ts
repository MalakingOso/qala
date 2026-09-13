/* Offline mutation outbox (M4/M9). Pure, DOM-free: persistence is injected so
 * the store can use localStorage while tests use memory. */

export interface QueuedOp {
  id: string;
  kind: string;
  at: string;
  payload: unknown;
  attempts: number;
}

export interface OutboxStorage {
  read(): string | null;
  write(raw: string): void;
}

export function enqueue(queue: QueuedOp[], op: QueuedOp): QueuedOp[] {
  return [...queue, op];
}

export function acknowledge(queue: QueuedOp[], id: string): QueuedOp[] {
  return queue.filter((op) => op.id !== id);
}

/** Capped exponential backoff: 1s, 2s, 4s ... capped at 60s. */
export function nextBackoffMs(attempts: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, attempts));
}

export function serialize(queue: QueuedOp[]): string {
  return JSON.stringify(queue);
}

export function deserialize(raw: string | null): QueuedOp[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (op): op is QueuedOp =>
        typeof op === "object" &&
        op !== null &&
        typeof (op as QueuedOp).id === "string" &&
        typeof (op as QueuedOp).kind === "string" &&
        typeof (op as QueuedOp).attempts === "number",
    );
  } catch {
    return [];
  }
}

const KEY = "qala.outbox.v1";

function webStorage(): OutboxStorage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return {
      read: () => localStorage.getItem(KEY),
      write: (raw: string) => localStorage.setItem(KEY, raw),
    };
  } catch {
    return null;
  }
}

export function loadOutbox(storage: OutboxStorage | null = webStorage()): QueuedOp[] {
  return deserialize(storage?.read() ?? null);
}

export function saveOutbox(
  queue: QueuedOp[],
  storage: OutboxStorage | null = webStorage(),
): void {
  try {
    storage?.write(serialize(queue));
  } catch {
    // Outbox persistence is best-effort; the in-memory queue still works.
  }
}
