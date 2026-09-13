/* Sync client toward the Deno automerge-repo server (PLAN 7). Transport is a
 * plain WebSocket owned here; the document itself graduates to
 * @automerge/automerge-repo's `useDocument` once the server shell lands.
 * Until then the offline outbox in the store is the source of truth for
 * pending mutations, and flush order is FIFO. */

import type { QueuedOp } from "../logic/offlineQueue.ts";

export type SyncStatus = "offline" | "connecting" | "live" | "denied";

const DEFAULT_URL = "wss://callisto.taila63f23.ts.net:8443/sync";

export class SyncClient {
  private socket: WebSocket | null = null;
  status: SyncStatus = "offline";
  private onStatus: (s: SyncStatus) => void = () => {};

  constructor(private url: string = DEFAULT_URL) {}

  watchStatus(fn: (s: SyncStatus) => void): () => void {
    this.onStatus = fn;
    return () => {
      this.onStatus = () => {};
    };
  }

  private setStatus(s: SyncStatus): void {
    this.status = s;
    this.onStatus(s);
  }

  connect(): void {
    if (typeof WebSocket === "undefined") return;
    this.setStatus("connecting");
    try {
      this.socket = new WebSocket(this.url);
    } catch {
      this.setStatus("offline");
      return;
    }
    this.socket.addEventListener("open", () => this.setStatus("live"));
    this.socket.addEventListener("close", () => this.setStatus("offline"));
    this.socket.addEventListener("error", () => this.setStatus("offline"));
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.setStatus("offline");
  }

  /** FIFO flush of the outbox; returns the ops still pending. */
  async flush(outbox: QueuedOp[]): Promise<QueuedOp[]> {
    if (this.status !== "live" || !this.socket || outbox.length === 0) return outbox;
    const remaining: QueuedOp[] = [];
    for (const op of outbox) {
      try {
        this.socket.send(JSON.stringify({ type: "op", op }));
      } catch {
        remaining.push({ ...op, attempts: op.attempts + 1 });
        // Preserve order: stop at the first failure.
        const idx = outbox.indexOf(op);
        return [...remaining, ...outbox.slice(idx + 1)];
      }
    }
    return remaining;
  }
}
