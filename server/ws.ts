// WebSocket transport for automerge-repo on Deno (PLAN.md section 7).
//
// The bundled `WebSocketServerAdapter` assumes a Node `ws` server, so this
// module provides `DenoWebSocketServerAdapter`: the same join/peer/message
// protocol over sockets accepted with `Deno.upgradeWebSocket`. One adapter
// serves all sockets; each accepted socket is attached with `addSocket`.

import {
  cbor,
  type Message,
  NetworkAdapter,
  type PeerId,
  type PeerMetadata,
} from "@automerge/automerge-repo";
import { ProtocolV1 } from "@automerge/automerge-repo-network-websocket";

interface JoinMessage {
  type: "join";
  senderId: PeerId;
  peerMetadata?: PeerMetadata;
  supportedProtocolVersions?: string[];
}

function assertValue(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** Narrow ArrayBuffer views without copying the whole backing store. */
function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export class DenoWebSocketServerAdapter extends NetworkAdapter {
  sockets: Record<string, WebSocket> = {};
  #ready = false;
  #readyResolve: (() => void) | undefined;
  #readyPromise = new Promise<void>((resolve) => {
    this.#readyResolve = resolve;
  });

  isReady(): boolean {
    return this.#ready;
  }

  whenReady(): Promise<void> {
    return this.#readyPromise;
  }

  connect(peerId: PeerId, peerMetadata?: PeerMetadata): void {
    this.peerId = peerId;
    this.peerMetadata = peerMetadata;
    if (!this.#ready) {
      this.#ready = true;
      this.#readyResolve?.();
    }
  }

  /** Attach one socket already accepted via `Deno.upgradeWebSocket`. */
  addSocket(socket: WebSocket): void {
    socket.onmessage = async (event: MessageEvent) => {
      const data = event.data as unknown;
      const bytes = data instanceof Blob
        ? new Uint8Array(await data.arrayBuffer())
        : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data as ArrayBuffer);
      this.receiveMessage(bytes, socket);
    };
    socket.onclose = () => this.#removeSocket(socket);
    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        // ignore close errors on a broken socket
      }
    };
  }

  override send(message: Message): void {
    const targetId = (message as { targetId?: string }).targetId;
    assertValue(targetId !== undefined, "No targetId on message");
    const data = (message as { data?: { byteLength?: number } }).data;
    if (data && data.byteLength === 0) {
      throw new Error("Tried to send a zero-length message");
    }
    assertValue(this.peerId, "No peerId set for the websocket server adapter");
    const socket = this.sockets[targetId];
    if (!socket) return; // peer went away; the repo retries on reconnect
    socket.send(asArrayBuffer(cbor.encode(message) as Uint8Array));
  }

  receiveMessage(raw: Uint8Array, socket: WebSocket): void {
    let message: Message & Partial<JoinMessage>;
    try {
      message = cbor.decode(raw) as Message & Partial<JoinMessage>;
    } catch {
      try {
        socket.close();
      } catch {
        // ignore
      }
      return;
    }
    const { type, senderId } = message;
    const myPeerId = this.peerId;
    assertValue(myPeerId, "No peerId set for the websocket server adapter");
    if (type === "join") {
      const join = message as JoinMessage;
      const existing = this.sockets[senderId];
      if (existing && existing !== socket) {
        try {
          existing.close();
        } catch {
          // ignore
        }
        this.emit("peer-disconnected", { peerId: senderId });
      }
      this.emit("peer-candidate", {
        peerId: senderId,
        peerMetadata: join.peerMetadata ?? {},
      });
      this.sockets[senderId] = socket;
      const versions = join.supportedProtocolVersions;
      if (versions !== undefined && !versions.includes(ProtocolV1)) {
        this.send({
          type: "error",
          senderId: myPeerId,
          message: "unsupported protocol version",
          targetId: senderId,
        } as unknown as Message);
        try {
          socket.close();
        } catch {
          // ignore
        }
        delete this.sockets[senderId];
      } else {
        this.send({
          type: "peer",
          senderId: myPeerId,
          peerMetadata: this.peerMetadata ?? {},
          selectedProtocolVersion: ProtocolV1,
          targetId: senderId,
        } as unknown as Message);
      }
    } else {
      if (this.sockets[senderId] !== socket) return;
      this.emit("message", message as Message);
    }
  }

  disconnect(): void {
    for (const socket of Object.values(this.sockets)) {
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
    this.sockets = {};
  }

  #removeSocket(socket: WebSocket): void {
    const peerId = Object.keys(this.sockets).find(
      (id) => this.sockets[id] === socket,
    );
    if (!peerId) return;
    this.emit("peer-disconnected", { peerId: peerId as PeerId });
    delete this.sockets[peerId];
  }
}

/**
 * Answer a WebSocket upgrade with `Deno.upgradeWebSocket` and hand the live
 * socket to `onSocket`. Returns 426 for non-upgrade requests.
 */
export function upgradeSyncSocket(
  req: Request,
  onSocket: (socket: WebSocket) => void,
): Response {
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("expected websocket upgrade", { status: 426 });
  }
  const { socket, response } = Deno.upgradeWebSocket(req);
  onSocket(socket);
  return response;
}
