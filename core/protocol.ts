export type PeerConnectionState =
  | "idle"
  | "waiting-for-peer"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface PeerDescriptor {
  peerId: string;
  label: string;
}

export type ClientSignalMessage =
  | { type: "create-room"; roomCode?: string; peerId: string; label: string }
  | {
      type: "join-room";
      roomCode: string;
      peerId: string;
      label: string;
      createIfMissing?: boolean;
    }
  | { type: "update-label"; label: string }
  | {
      type: "offer";
      targetPeerId: string;
      payload: RTCSessionDescriptionInit;
    }
  | {
      type: "answer";
      targetPeerId: string;
      payload: RTCSessionDescriptionInit;
    }
  | {
      type: "ice-candidate";
      targetPeerId: string;
      payload: RTCIceCandidateInit;
    }
  | { type: "ping" };

export type ServerSignalMessage =
  | {
      type: "room-ready";
      roomCode: string;
      peerId: string;
      peers: PeerDescriptor[];
    }
  | {
      type: "peer-joined";
      peerId: string;
      label: string;
    }
  | { type: "peer-left"; peerId: string }
  | { type: "peer-updated"; peerId: string; label: string }
  | {
      type: "offer";
      fromPeerId: string;
      payload: RTCSessionDescriptionInit;
    }
  | {
      type: "answer";
      fromPeerId: string;
      payload: RTCSessionDescriptionInit;
    }
  | {
      type: "ice-candidate";
      fromPeerId: string;
      payload: RTCIceCandidateInit;
    }
  | { type: "pong" }
  | { type: "error"; code: string; message: string };

export interface ScratchpadWireEntry {
  id: string;
  text: string;
  senderId: string;
  senderLabel: string;
  timestamp: number;
}

export interface FileOfferPayload {
  fileId: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType: string;
  chunkSize: number;
  totalChunks: number;
}

export type ControlMessage =
  | { type: "peer:hello"; label: string }
  | { type: "scratchpad:entry"; entry: ScratchpadWireEntry }
  | { type: "scratchpad:clear"; timestamp: number; senderLabel: string }
  | { type: "scratchpad:sync"; entries: ScratchpadWireEntry[] }
  | ({ type: "file:offer" } & FileOfferPayload)
  | { type: "file:accept"; fileId: string; receivedChunks: number[] }
  | { type: "file:complete"; fileId: string }
  | { type: "file:pause"; fileId: string }
  | { type: "file:resume"; fileId: string; receivedChunks: number[] }
  | { type: "file:cancel"; fileId: string }
  | {
      type: "transfer:sync";
      incoming: Array<{ fileId: string; receivedChunks: number[] }>;
    };
