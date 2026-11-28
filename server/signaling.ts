import { createServer } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { ClientSignalMessage, ServerSignalMessage } from "../core/protocol.ts";

interface RoomPeer {
  id: string;
  label: string;
  ws: WebSocket;
}

const PORT = Number(process.env.SIGNALING_PORT ?? process.env.PORT ?? 3001);
const MAX_ROOM_PEERS = 6;
const rooms = new Map<string, Map<string, RoomPeer>>();
const socketMeta = new WeakMap<WebSocket, { roomCode: string; peerId: string }>();

function send(ws: WebSocket, message: ServerSignalMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function generateSixDigitRoom(): string {
  for (let i = 0; i < 32; i++) {
    const code = String(Math.floor(100_000 + Math.random() * 900_000));
    if (!rooms.has(code)) return code;
  }
  return String(Date.now()).slice(-6);
}

function normalizeCode(raw?: string): string {
  return (raw ?? "").replace(/\D/g, "").slice(0, 6);
}

function leaveCurrentRoom(ws: WebSocket): void {
  const meta = socketMeta.get(ws);
  if (!meta) return;
  socketMeta.delete(ws);

  const room = rooms.get(meta.roomCode);
  if (!room) return;

  const existing = room.get(meta.peerId);
  if (existing && existing.ws !== ws) return;

  room.delete(meta.peerId);
  if (room.size === 0) {
    rooms.delete(meta.roomCode);
    return;
  }

  for (const peer of room.values()) {
    send(peer.ws, { type: "peer-left", peerId: meta.peerId });
  }
}

function enterRoom(
  ws: WebSocket,
  roomCode: string,
  peerId: string,
  label: string,
  createIfMissing: boolean
): void {
  leaveCurrentRoom(ws);

  let room = rooms.get(roomCode);
  if (!room) {
    if (!createIfMissing) {
      send(ws, { type: "error", code: "ROOM_NOT_FOUND", message: "Room code not found or expired." });
      return;
    }
    room = new Map();
    rooms.set(roomCode, room);
  }

  const isReconnect = room.has(peerId);
  if (!isReconnect && room.size >= MAX_ROOM_PEERS) {
    send(ws, { type: "error", code: "ROOM_FULL", message: "Room already has the maximum of 6 connected peers." });
    return;
  }

  if (isReconnect) {
    const previous = room.get(peerId);
    if (previous && previous.ws !== ws) {
      socketMeta.delete(previous.ws);
      previous.ws.close(1000, "Replaced by newer connection");
    }
  }

  const cleanLabel = label.trim().slice(0, 32) || "Slate-Node";
  const existingPeers = Array.from(room.values()).map((p) => ({
    peerId: p.id,
    label: p.label,
  }));

  room.set(peerId, { id: peerId, label: cleanLabel, ws });
  socketMeta.set(ws, { roomCode, peerId });

  send(ws, { type: "room-ready", roomCode, peerId, peers: existingPeers });

  for (const peer of room.values()) {
    if (peer.id !== peerId) {
      send(peer.ws, { type: "peer-joined", peerId, label: cleanLabel });
    }
  }
}

function relayToPeer(ws: WebSocket, message: ClientSignalMessage): void {
  const meta = socketMeta.get(ws);
  if (!meta) return;
  const room = rooms.get(meta.roomCode);
  if (!room) return;

  if (message.type === "update-label") {
    const self = room.get(meta.peerId);
    if (!self) return;
    self.label = message.label.trim().slice(0, 32) || "Slate-Node";
    for (const peer of room.values()) {
      if (peer.id !== meta.peerId) {
        send(peer.ws, { type: "peer-updated", peerId: meta.peerId, label: self.label });
      }
    }
    return;
  }

  if (message.type === "offer" || message.type === "answer" || message.type === "ice-candidate") {
    const target = room.get(message.targetPeerId);
    if (!target) return;
    send(target.ws, {
      type: message.type,
      fromPeerId: meta.peerId,
      payload: message.payload,
    } as ServerSignalMessage);
  }
}

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", rooms: rooms.size }));
    return;
  }
  res.writeHead(426, { "Content-Type": "text/plain" });
  res.end("WebSocket signaling endpoint");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws: WebSocket) => {
  ws.on("message", (raw: RawData) => {
    let parsed: ClientSignalMessage;
    try {
      parsed = JSON.parse(raw.toString()) as ClientSignalMessage;
    } catch {
      send(ws, { type: "error", code: "BAD_JSON", message: "Invalid JSON payload." });
      return;
    }

    if (parsed.type === "ping") {
      send(ws, { type: "pong" });
      return;
    }

    if (parsed.type === "create-room") {
      const requested = normalizeCode(parsed.roomCode);
      const code = /^\d{6}$/.test(requested) && !rooms.has(requested)
        ? requested
        : generateSixDigitRoom();
      enterRoom(ws, code, parsed.peerId, parsed.label, true);
      return;
    }

    if (parsed.type === "join-room") {
      const code = normalizeCode(parsed.roomCode);
      if (!/^\d{6}$/.test(code)) {
        send(ws, { type: "error", code: "INVALID_CODE", message: "Enter a valid 6-digit room code." });
        return;
      }
      enterRoom(ws, code, parsed.peerId, parsed.label, Boolean(parsed.createIfMissing));
      return;
    }

    relayToPeer(ws, parsed);
  });

  ws.on("close", () => leaveCurrentRoom(ws));
  ws.on("error", () => leaveCurrentRoom(ws));
});

server.listen(PORT, () => {
  console.log(`[slate-signaling] listening on ws://0.0.0.0:${PORT}`);
});
