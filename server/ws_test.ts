// WebSocket transport tests: adapter readiness/errors plus the live upgrade
// path over real TCP (Deno's WebSocket client cannot set headers, so the
// handshake here is hand-rolled to prove header auth + Origin policy).

import { assert, assertEquals } from "@std/assert";
import { cbor, type PeerId } from "@automerge/automerge-repo";
import { checkWsUpgrade } from "./auth.ts";
import { DenoWebSocketServerAdapter, upgradeSyncSocket } from "./ws.ts";

Deno.test("server adapter becomes ready and drops unknown peers", async () => {
  const adapter = new DenoWebSocketServerAdapter();
  let closed = false;
  const fake = {
    readyState: 1,
    send(_data: unknown) {},
    close() {
      closed = true;
    },
  } as unknown as WebSocket;
  adapter.connect("server-peer" as PeerId);
  await adapter.whenReady();
  assert(adapter.isReady());
  // Send to an unknown peer is a silent no-op, not a throw.
  adapter.send({ targetId: "gone", senderId: "server-peer" } as never);
  // Garbage bytes close the socket.
  adapter.addSocket(fake);
  adapter.receiveMessage(new Uint8Array([0xff, 0xff]), fake);
  assert(closed);
  adapter.disconnect();
});

interface RawUpgrade {
  conn: Deno.Conn;
  status: number;
}

async function readHttpHead(
  conn: Deno.Conn,
): Promise<{ status: number; raw: string }> {
  const buf = new Uint8Array(8192);
  let text = "";
  while (!text.includes("\r\n\r\n")) {
    const n = await conn.read(buf);
    if (n === null) break;
    text += new TextDecoder().decode(buf.subarray(0, n));
  }
  const statusLine = text.split("\r\n")[0] ?? "";
  const status = Number(statusLine.split(" ")[1]);
  return { status, raw: text };
}

async function rawUpgrade(
  port: number,
  headers: Record<string, string>,
): Promise<RawUpgrade> {
  const conn = await Deno.connect({ hostname: "127.0.0.1", port });
  const key = "dGhlIHNhbXBsZSBub25jZQ==";
  const lines = [
    "GET /sync HTTP/1.1",
    "Host: 127.0.0.1",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
    "\r\n",
  ];
  await conn.write(new TextEncoder().encode(lines.join("\r\n")));
  const { status } = await readHttpHead(conn);
  return { conn, status };
}

/** One masked client-to-server binary frame. */
function encodeFrame(payload: Uint8Array): Uint8Array {
  const mask = new Uint8Array([1, 2, 3, 4]);
  const header = [0x82];
  if (payload.length < 126) {
    header.push(0x80 | payload.length);
  } else {
    header.push(
      0x80 | 126,
      (payload.length >> 8) & 0xff,
      payload.length & 0xff,
    );
  }
  const out = new Uint8Array(header.length + 4 + payload.length);
  out.set(header, 0);
  out.set(mask, header.length);
  for (let i = 0; i < payload.length; i++) {
    out[header.length + 4 + i] = payload[i] ^ mask[i % 4];
  }
  return out;
}

async function readBytes(
  conn: Deno.Conn,
  n: number,
): Promise<Uint8Array> {
  const out = new Uint8Array(n);
  let filled = 0;
  while (filled < n) {
    const got = await conn.read(out.subarray(filled));
    if (got === null) throw new Error("connection closed mid-frame");
    filled += got;
  }
  return out;
}

/** Read one server-to-client frame payload. */
async function readFrame(conn: Deno.Conn): Promise<Uint8Array> {
  const head = await readBytes(conn, 2);
  let len = head[1] & 0x7f;
  if (len === 126) {
    const ext = await readBytes(conn, 2);
    len = (ext[0] << 8) | ext[1];
  } else if (len === 127) {
    const ext = await readBytes(conn, 8);
    len = Number(
      (BigInt(ext[0]) << 56n) | (BigInt(ext[1]) << 48n) |
        (BigInt(ext[2]) << 40n) | (BigInt(ext[3]) << 32n) |
        (BigInt(ext[4]) << 24n) | (BigInt(ext[5]) << 16n) |
        (BigInt(ext[6]) << 8n) | BigInt(ext[7]),
    );
  }
  return await readBytes(conn, len);
}

function testServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const adapter = new DenoWebSocketServerAdapter();
  adapter.connect("qala-test-server" as PeerId);
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0 }, (req) => {
    try {
      checkWsUpgrade(req);
    } catch {
      return Response.json({ error: "missing Tailscale identity" }, {
        status: 401,
      });
    }
    return upgradeSyncSocket(req, (socket) => adapter.addSocket(socket));
  });
  return Promise.resolve({
    port: (server.addr as Deno.NetAddr).port,
    close: () => server.shutdown(),
  });
}

Deno.test("live upgrade rejects without the identity header", async () => {
  const { port, close } = await testServer();
  try {
    const { conn, status } = await rawUpgrade(port, {
      Origin: "https://localhost",
    });
    conn.close();
    assertEquals(status, 401);
  } finally {
    await close();
  }
});

Deno.test("live upgrade accepts Origin https://localhost with header and answers join", async () => {
  const { port, close } = await testServer();
  let conn: Deno.Conn | null = null;
  try {
    const up = await rawUpgrade(port, {
      Origin: "https://localhost",
      "Tailscale-User-Login": "berkley",
    });
    conn = up.conn;
    assertEquals(up.status, 101);
    const join = cbor.encode({
      type: "join",
      senderId: "test-client",
      peerMetadata: {},
      supportedProtocolVersions: ["1"],
    }) as Uint8Array;
    await conn.write(encodeFrame(join));
    const reply = cbor.decode(await readFrame(conn)) as {
      type: string;
      targetId: string;
      selectedProtocolVersion: string;
    };
    assertEquals(reply.type, "peer");
    assertEquals(reply.targetId, "test-client");
    assertEquals(reply.selectedProtocolVersion, "1");
  } finally {
    conn?.close();
    await close();
  }
});

Deno.test("non-upgrade requests to the socket route get 426", () => {
  const res = upgradeSyncSocket(
    new Request("http://127.0.0.1:8500/sync"),
    () => {},
  );
  assertEquals(res.status, 426);
});
