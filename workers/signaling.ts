import { DurableObject } from "cloudflare:workers";

interface Env {
  ROOMS: DurableObjectNamespace<SignalingRoom>;
}

interface SocketAttachment {
  roomCode: string | null;
  peerId: string | null;
  label: string;
}

type ClientMessage =
  | { type: "create-room"; roomCode?: string; peerId: string; label: string }
  | {
      type: "join-room";
      roomCode: string;
      peerId: string;
      label: string;
      createIfMissing?: boolean;
    }
  | { type: "update-label"; label: string }
  | { type: "offer" | "answer" | "ice-candidate"; targetPeerId: string; payload: unknown }
  | { type: "ping" };

const MAX_ROOM_PEERS = 6;

function normalizeCode(raw?: string): string {
  return (raw ?? "").replace(/\D/g, "").slice(0, 6);
}

function sendJson(ws: WebSocket, payload: unknown): void {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // Ignore closed socket writes.
  }
}

export class SignalingRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      const sockets = this.ctx.getWebSockets();
      const activeRooms = new Set<string>();
      for (const sock of sockets) {
        const meta = sock.deserializeAttachment() as SocketAttachment | null;
        if (meta?.roomCode) activeRooms.add(meta.roomCode);
      }
      return Response.json({ status: "ok", rooms: activeRooms.size });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket signaling endpoint", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    const initial: SocketAttachment = {
      roomCode: null,
      peerId: null,
      label: "Slate-Node",
    };
    server.serializeAttachment(initial);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;

    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(raw) as ClientMessage;
    } catch {
      sendJson(ws, { type: "error", code: "BAD_JSON", message: "Invalid JSON payload." });
      return;
    }

    if (parsed.type === "ping") {
      sendJson(ws, { type: "pong" });
      return;
    }

    if (parsed.type === "create-room") {
      const requested = normalizeCode(parsed.roomCode);
      const code =
        /^\d{6}$/.test(requested) && this.getRoomSockets(requested).length === 0
          ? requested
          : this.generateSixDigitRoom();
      this.enterRoom(ws, code, parsed.peerId, parsed.label, true);
      return;
    }

    if (parsed.type === "join-room") {
      const code = normalizeCode(parsed.roomCode);
      if (!/^\d{6}$/.test(code)) {
        sendJson(ws, {
          type: "error",
          code: "INVALID_CODE",
          message: "Enter a valid 6-digit room code.",
        });
        return;
      }
      this.enterRoom(ws, code, parsed.peerId, parsed.label, Boolean(parsed.createIfMissing));
      return;
    }

    const meta = ws.deserializeAttachment() as SocketAttachment | null;
    if (!meta?.roomCode || !meta.peerId) return;

    const roomSockets = this.getRoomSockets(meta.roomCode);

    if (parsed.type === "update-label") {
      const nextLabel = parsed.label.trim().slice(0, 32) || "Slate-Node";
      ws.serializeAttachment({ ...meta, label: nextLabel });
      for (const peer of roomSockets) {
        if (peer.meta.peerId !== meta.peerId) {
          sendJson(peer.ws, {
            type: "peer-updated",
            peerId: meta.peerId,
            label: nextLabel,
          });
        }
      }
      return;
    }

    if (parsed.type === "offer" || parsed.type === "answer" || parsed.type === "ice-candidate") {
      const target = roomSockets.find((p) => p.meta.peerId === parsed.targetPeerId);
      if (!target) return;
      sendJson(target.ws, {
        type: parsed.type,
        fromPeerId: meta.peerId,
        payload: parsed.payload,
      });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.leaveCurrentRoom(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.leaveCurrentRoom(ws);
  }

  private getRoomSockets(roomCode: string): Array<{ ws: WebSocket; meta: SocketAttachment }> {
    const matches: Array<{ ws: WebSocket; meta: SocketAttachment }> = [];
    for (const sock of this.ctx.getWebSockets()) {
      const meta = sock.deserializeAttachment() as SocketAttachment | null;
      if (meta?.roomCode === roomCode && meta.peerId) {
        matches.push({ ws: sock, meta });
      }
    }
    return matches;
  }

  private generateSixDigitRoom(): string {
    for (let i = 0; i < 32; i++) {
      const code = String(Math.floor(100_000 + Math.random() * 900_000));
      if (this.getRoomSockets(code).length === 0) return code;
    }
    return String(Date.now()).slice(-6);
  }

  private leaveCurrentRoom(ws: WebSocket): void {
    const meta = ws.deserializeAttachment() as SocketAttachment | null;
    if (!meta?.roomCode || !meta.peerId) return;

    const { roomCode, peerId } = meta;
    ws.serializeAttachment({ ...meta, roomCode: null, peerId: null });

    for (const peer of this.getRoomSockets(roomCode)) {
      if (peer.meta.peerId !== peerId) {
        sendJson(peer.ws, { type: "peer-left", peerId });
      }
    }
  }

  private enterRoom(
    ws: WebSocket,
    roomCode: string,
    peerId: string,
    label: string,
    createIfMissing: boolean
  ): void {
    this.leaveCurrentRoom(ws);

    const existing = this.getRoomSockets(roomCode);
    if (existing.length === 0 && !createIfMissing) {
      sendJson(ws, {
        type: "error",
        code: "ROOM_NOT_FOUND",
        message: "Room code not found or expired.",
      });
      return;
    }

    const duplicate = existing.find((p) => p.meta.peerId === peerId);
    if (!duplicate && existing.length >= MAX_ROOM_PEERS) {
      sendJson(ws, {
        type: "error",
        code: "ROOM_FULL",
        message: "Room already has the maximum of 6 connected peers.",
      });
      return;
    }

    if (duplicate && duplicate.ws !== ws) {
      duplicate.ws.serializeAttachment({ ...duplicate.meta, roomCode: null, peerId: null });
      duplicate.ws.close(1000, "Replaced by newer connection");
    }

    const cleanLabel = label.trim().slice(0, 32) || "Slate-Node";
    const activePeers = existing
      .filter((p) => p.meta.peerId !== peerId)
      .map((p) => ({ peerId: p.meta.peerId as string, label: p.meta.label }));

    ws.serializeAttachment({ roomCode, peerId, label: cleanLabel });

    sendJson(ws, {
      type: "room-ready",
      roomCode,
      peerId,
      peers: activePeers,
    });

    for (const peer of existing) {
      if (peer.meta.peerId !== peerId) {
        sendJson(peer.ws, {
          type: "peer-joined",
          peerId,
          label: cleanLabel,
        });
      }
    }
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.ROOMS.idFromName("global-signaling");
    const stub = env.ROOMS.get(id);
    return stub.fetch(request);
  },
};

export default worker;
