import type {
  ClientSignalMessage,
  ControlMessage,
  PeerConnectionState,
  PeerDescriptor,
  RemotePeerInfo,
  ServerSignalMessage,
  SinglePeerState,
} from "@/core/protocol";
import { getEffectiveIceServers } from "@/lib/iceConfig";
import { formatRoomCode, normalizeRoomCode } from "@/lib/generateRoomCode";

const HIGH_WATER_MARK = 1024 * 1024;
const LOW_WATER_THRESHOLD = 256 * 1024;
const HEARTBEAT_INTERVAL_MS = 20_000;

interface PeerMeshLink {
  peerId: string;
  label: string;
  state: SinglePeerState;
  pc: RTCPeerConnection | null;
  controlChannel: RTCDataChannel | null;
  fileChannel: RTCDataChannel | null;
  pendingIceCandidates: RTCIceCandidateInit[];
  localCandidateTypes: Set<string>;
  makingOffer: boolean;
  iceRestartTimer: ReturnType<typeof setTimeout> | null;
  negotiationTimeoutTimer: ReturnType<typeof setTimeout> | null;
}

export interface PeerSessionCallbacks {
  onStateChange: (state: PeerConnectionState) => void;
  onRoomChange: (roomCode: string | null) => void;
  onPeersChange: (peers: RemotePeerInfo[]) => void;
  onPeerConnected: (peerId: string) => void;
  onControlMessage: (fromPeerId: string, message: ControlMessage) => void;
  onBinaryMessage: (fromPeerId: string, data: ArrayBuffer) => void;
  onError: (message: string) => void;
}

function resolveSignalingUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SIGNALING_URL;
  if (configured && configured.trim().length > 0) return configured.trim();
  if (typeof window === "undefined") return "ws://localhost:3001";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:3001`;
}

export class PeerSessionManager {
  private readonly peerId: string;
  private label: string;
  private readonly callbacks: PeerSessionCallbacks;

  private ws: WebSocket | null = null;
  private peers = new Map<string, PeerMeshLink>();

  private roomCode: string | null = null;
  private state: PeerConnectionState = "idle";
  private manualDisconnect = false;
  private destroyed = false;
  private signalingReconnecting = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(peerId: string, label: string, callbacks: PeerSessionCallbacks) {
    this.peerId = peerId;
    this.label = label;
    this.callbacks = callbacks;
  }

  public getState(): PeerConnectionState {
    return this.state;
  }

  public createRoom(preferredCode?: string): void {
    this.manualDisconnect = false;
    this.signalingReconnecting = false;
    this.clearSocketTimers();
    this.teardownAllPeers();

    const normalized = preferredCode ? normalizeRoomCode(preferredCode) : undefined;
    this.openSocketAndSend({
      type: "create-room",
      roomCode: normalized && normalized.length === 6 ? normalized : undefined,
      peerId: this.peerId,
      label: this.label,
    });
  }

  public joinRoom(roomCode: string, createIfMissing = false): void {
    const normalized = normalizeRoomCode(roomCode);
    if (normalized.length !== 6) {
      this.callbacks.onError("Enter a valid 6-digit room code.");
      return;
    }

    this.manualDisconnect = false;
    this.signalingReconnecting = false;
    this.clearSocketTimers();
    this.teardownAllPeers();
    this.setState("connecting");

    this.openSocketAndSend({
      type: "join-room",
      roomCode: normalized,
      peerId: this.peerId,
      label: this.label,
      createIfMissing,
    });
  }

  public updateLabel(label: string): void {
    this.label = label;
    this.sendSignal({ type: "update-label", label });
    this.broadcastControl({ type: "peer:hello", label });
  }

  public refreshIceConfig(): void {
    for (const link of this.peers.values()) {
      this.startPeerConnection(link);
    }
    this.emitPeersAndState();
  }

  public disconnect(): void {
    this.manualDisconnect = true;
    this.signalingReconnecting = false;
    this.clearSocketTimers();
    this.teardownAllPeers();
    this.closeSocket("User disconnected");
    this.roomCode = null;
    this.callbacks.onRoomChange(null);
    this.setState("disconnected");
  }

  public destroy(): void {
    this.destroyed = true;
    this.manualDisconnect = true;
    this.clearSocketTimers();
    this.teardownAllPeers();
    this.closeSocket();
  }

  public sendControlToPeer(peerId: string, message: ControlMessage): boolean {
    const channel = this.peers.get(peerId)?.controlChannel;
    if (!channel || channel.readyState !== "open") {
      return false;
    }
    channel.send(JSON.stringify(message));
    return true;
  }

  public broadcastControl(message: ControlMessage): number {
    const serialized = JSON.stringify(message);
    let sent = 0;
    for (const link of this.peers.values()) {
      if (link.controlChannel?.readyState === "open") {
        link.controlChannel.send(serialized);
        sent += 1;
      }
    }
    return sent;
  }

  public async sendBinaryChunkToPeer(
    peerId: string,
    buffer: ArrayBuffer
  ): Promise<void> {
    const channel = this.peers.get(peerId)?.fileChannel;
    if (!channel || channel.readyState !== "open") {
      throw new Error("File stream DataChannel is not open.");
    }

    // Backpressure guard keeps SCTP send buffer bounded per peer so memory stays flat.
    if (channel.bufferedAmount >= HIGH_WATER_MARK) {
      await new Promise<void>((resolve, reject) => {
        const onLow = (): void => {
          cleanup();
          resolve();
        };
        const onClose = (): void => {
          cleanup();
          reject(new Error("File stream DataChannel closed during transfer."));
        };
        const cleanup = (): void => {
          channel.removeEventListener("bufferedamountlow", onLow);
          channel.removeEventListener("close", onClose);
          channel.removeEventListener("error", onClose);
        };

        channel.addEventListener("bufferedamountlow", onLow, { once: true });
        channel.addEventListener("close", onClose, { once: true });
        channel.addEventListener("error", onClose, { once: true });

        if (channel.bufferedAmount < LOW_WATER_THRESHOLD) {
          cleanup();
          resolve();
        }
      });
    }

    if (channel.readyState !== "open") {
      throw new Error("File stream DataChannel closed before send.");
    }
    channel.send(buffer);
  }

  private closeSocket(reason?: string): void {
    if (!this.ws) return;
    this.ws.onopen = null;
    this.ws.onmessage = null;
    this.ws.onerror = null;
    this.ws.onclose = null;
    this.ws.close(1000, reason);
    this.ws = null;
  }

  private setState(next: PeerConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    this.callbacks.onStateChange(next);
  }

  private emitPeersAndState(): void {
    const list: RemotePeerInfo[] = Array.from(this.peers.values()).map((p) => ({
      peerId: p.peerId,
      label: p.label,
      state: p.state,
    }));
    this.callbacks.onPeersChange(list);

    if (this.manualDisconnect) return;
    if (!this.roomCode) {
      this.setState("idle");
      return;
    }

    if (list.some((p) => p.state === "connected")) {
      this.setState("connected");
      return;
    }
    if (this.signalingReconnecting) {
      this.setState("reconnecting");
      return;
    }
    if (list.length === 0) {
      this.setState("waiting-for-peer");
      return;
    }
    if (list.some((p) => p.state === "connecting")) {
      this.setState("connecting");
      return;
    }
    this.setState("reconnecting");
  }

  private openSocketAndSend(initialMessage: ClientSignalMessage): void {
    if (this.destroyed) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSignal(initialMessage);
      return;
    }

    this.closeSocket();

    const signalingUrl = resolveSignalingUrl();
    const socket = new WebSocket(signalingUrl);
    this.ws = socket;

    socket.onopen = () => {
      if (this.destroyed || this.ws !== socket) return;
      this.reconnectAttempts = 0;
      this.signalingReconnecting = false;
      this.startHeartbeat();
      this.sendSignal(initialMessage);
    };

    socket.onmessage = (event) => {
      if (this.destroyed || this.ws !== socket) return;
      this.handleSignalMessage(event.data);
    };

    socket.onerror = () => {
      if (this.destroyed || this.ws !== socket) return;
      if (!this.roomCode) {
        this.callbacks.onError(
          `Unable to reach signaling server (${signalingUrl}). Run "npm run dev" or "npm run dev:ws".`
        );
      }
    };

    socket.onclose = () => {
      if (this.destroyed || this.ws !== socket) return;
      this.stopHeartbeat();
      if (this.manualDisconnect) return;
      if (this.roomCode) {
        this.scheduleSignalingReconnect();
      } else {
        this.setState("disconnected");
      }
    };
  }

  private scheduleSignalingReconnect(): void {
    if (this.manualDisconnect || !this.roomCode || this.reconnectTimer) return;
    this.signalingReconnecting = true;
    this.emitPeersAndState();

    const delay = Math.min(8000, 500 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;

    const code = this.roomCode;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manualDisconnect) return;
      this.openSocketAndSend({
        type: "join-room",
        roomCode: code,
        peerId: this.peerId,
        label: this.label,
        createIfMissing: true,
      });
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendSignal({ type: "ping" });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearSocketTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private sendSignal(message: ClientSignalMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleSignalMessage(raw: unknown): void {
    if (typeof raw !== "string") return;
    let message: ServerSignalMessage;
    try {
      message = JSON.parse(raw) as ServerSignalMessage;
    } catch {
      return;
    }

    switch (message.type) {
      case "pong":
        break;
      case "error":
        this.callbacks.onError(message.message);
        if (message.code === "ROOM_NOT_FOUND" || message.code === "ROOM_FULL") {
          this.roomCode = null;
          this.callbacks.onRoomChange(null);
          this.emitPeersAndState();
        }
        break;
      case "room-ready": {
        this.roomCode = message.roomCode;
        this.callbacks.onRoomChange(formatRoomCode(message.roomCode));

        const activeIds = new Set(message.peers.map((p) => p.peerId));
        for (const existingId of this.peers.keys()) {
          if (!activeIds.has(existingId)) {
            this.removePeer(existingId);
          }
        }

        for (const descriptor of message.peers) {
          this.upsertAndConnectPeer(descriptor);
        }
        this.emitPeersAndState();
        break;
      }
      case "peer-joined": {
        this.upsertAndConnectPeer({ peerId: message.peerId, label: message.label });
        this.emitPeersAndState();
        break;
      }
      case "peer-updated": {
        const link = this.peers.get(message.peerId);
        if (link) {
          link.label = message.label;
          this.emitPeersAndState();
        }
        break;
      }
      case "peer-left": {
        this.removePeer(message.peerId);
        this.emitPeersAndState();
        break;
      }
      case "offer":
        void this.handleOffer(message.fromPeerId, message.payload);
        break;
      case "answer":
        void this.handleAnswer(message.fromPeerId, message.payload);
        break;
      case "ice-candidate":
        void this.handleRemoteIceCandidate(message.fromPeerId, message.payload);
        break;
    }
  }

  private upsertAndConnectPeer(descriptor: PeerDescriptor): PeerMeshLink {
    const existing = this.peers.get(descriptor.peerId);
    if (existing) {
      existing.label = descriptor.label;
      if (existing.state !== "connected" || !existing.pc) {
        this.startPeerConnection(existing);
      }
      return existing;
    }

    const link: PeerMeshLink = {
      peerId: descriptor.peerId,
      label: descriptor.label,
      state: "connecting",
      pc: null,
      controlChannel: null,
      fileChannel: null,
      pendingIceCandidates: [],
      localCandidateTypes: new Set(),
      makingOffer: false,
      iceRestartTimer: null,
      negotiationTimeoutTimer: null,
    };
    this.peers.set(descriptor.peerId, link);
    this.startPeerConnection(link);
    return link;
  }

  private removePeer(peerId: string): void {
    const link = this.peers.get(peerId);
    if (!link) return;
    this.teardownPeerLink(link);
    this.peers.delete(peerId);
  }

  private isInitiator(remotePeerId: string): boolean {
    // Deterministic tie-breaker guarantees one initiator per pair and prevents SDP glare.
    return this.peerId > remotePeerId;
  }

  private startPeerConnection(link: PeerMeshLink): void {
    this.teardownPeerLink(link);

    const pc = new RTCPeerConnection({ iceServers: getEffectiveIceServers() });
    link.pc = pc;
    link.state = "connecting";
    link.pendingIceCandidates = [];
    link.localCandidateTypes.clear();

    link.negotiationTimeoutTimer = setTimeout(() => {
      link.negotiationTimeoutTimer = null;
      if (link.pc === pc && link.state === "connecting") {
        const hasRelay = link.localCandidateTypes.has("relay");
        const hasSrflx = link.localCandidateTypes.has("srflx");
        const detail =
          !hasSrflx && !hasRelay
            ? "No public STUN/TURN route found (UDP may be blocked or VPN/Private Relay is active)."
            : !hasRelay
              ? "Direct NAT traversal timed out. If this peer is on cellular data (4G/5G) or symmetric NAT, add a TURN relay in ICE Settings."
              : "ICE/DTLS handshake timed out across relay.";
        this.callbacks.onError(`Connection to ${link.label} timed out: ${detail}`);
      }
    }, 12_000);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        if (event.candidate.type) {
          link.localCandidateTypes.add(event.candidate.type);
        }
        this.sendSignal({
          type: "ice-candidate",
          targetPeerId: link.peerId,
          payload: event.candidate.toJSON(),
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (link.pc !== pc) return;
      if (pc.iceConnectionState === "failed") {
        link.state = "reconnecting";
        this.emitPeersAndState();
        if (this.isInitiator(link.peerId)) {
          void this.triggerIceRestart(link);
        } else {
          this.callbacks.onError(
            `ICE connection to ${link.label} failed. Both peers may be behind strict NAT/cellular firewalls requiring a TURN server.`
          );
        }
      } else if (
        pc.iceConnectionState === "connected" ||
        pc.iceConnectionState === "completed"
      ) {
        this.evaluateLinkConnected(link);
      }
    };

    pc.onconnectionstatechange = () => {
      if (link.pc !== pc) return;
      switch (pc.connectionState) {
        case "connected":
          if (link.iceRestartTimer) {
            clearTimeout(link.iceRestartTimer);
            link.iceRestartTimer = null;
          }
          this.evaluateLinkConnected(link);
          break;
        case "connecting":
          link.state = "connecting";
          this.emitPeersAndState();
          break;
        case "disconnected":
          link.state = "reconnecting";
          this.emitPeersAndState();
          if (!link.iceRestartTimer && this.isInitiator(link.peerId)) {
            link.iceRestartTimer = setTimeout(() => {
              link.iceRestartTimer = null;
              void this.triggerIceRestart(link);
            }, 2500);
          }
          break;
        case "failed":
          link.state = "reconnecting";
          this.emitPeersAndState();
          if (this.isInitiator(link.peerId)) {
            void this.triggerIceRestart(link);
          }
          break;
        case "closed":
          if (!this.manualDisconnect && this.peers.has(link.peerId)) {
            link.state = "reconnecting";
            this.emitPeersAndState();
          }
          break;
      }
    };

    if (this.isInitiator(link.peerId)) {
      const control = pc.createDataChannel("control", { ordered: true });
      const fileStream = pc.createDataChannel("file-stream", { ordered: true });
      this.attachControlChannel(link, control);
      this.attachFileChannel(link, fileStream);
      void this.createAndSendOffer(link, pc, false);
    } else {
      pc.ondatachannel = (event) => {
        if (event.channel.label === "control") {
          this.attachControlChannel(link, event.channel);
        } else if (event.channel.label === "file-stream") {
          this.attachFileChannel(link, event.channel);
        }
      };
    }
  }

  private async createAndSendOffer(
    link: PeerMeshLink,
    pc: RTCPeerConnection,
    iceRestart: boolean
  ): Promise<void> {
    try {
      link.makingOffer = true;
      const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      if (link.pc !== pc) return;
      await pc.setLocalDescription(offer);
      if (pc.localDescription) {
        this.sendSignal({
          type: "offer",
          targetPeerId: link.peerId,
          payload: pc.localDescription.toJSON(),
        });
      }
    } catch {
      this.callbacks.onError(`Failed to negotiate WebRTC offer with ${link.label}.`);
    } finally {
      link.makingOffer = false;
    }
  }

  private async triggerIceRestart(link: PeerMeshLink): Promise<void> {
    if (!link.pc || link.pc.signalingState === "closed") return;
    await this.createAndSendOffer(link, link.pc, true);
  }

  private async handleOffer(
    fromPeerId: string,
    offer: RTCSessionDescriptionInit
  ): Promise<void> {
    let link = this.peers.get(fromPeerId);
    if (!link) {
      link = this.upsertAndConnectPeer({ peerId: fromPeerId, label: "Slate-Peer" });
      this.emitPeersAndState();
    }
    const pc = link.pc;
    if (!pc) return;

    const polite = !this.isInitiator(fromPeerId);
    const offerCollision = link.makingOffer || pc.signalingState !== "stable";
    if (offerCollision && !polite) return;

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await this.flushPendingIceCandidates(link, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (pc.localDescription) {
        this.sendSignal({
          type: "answer",
          targetPeerId: fromPeerId,
          payload: pc.localDescription.toJSON(),
        });
      }
    } catch {
      this.callbacks.onError(`Failed to accept WebRTC offer from ${link.label}.`);
    }
  }

  private async handleAnswer(
    fromPeerId: string,
    answer: RTCSessionDescriptionInit
  ): Promise<void> {
    const link = this.peers.get(fromPeerId);
    const pc = link?.pc;
    if (!link || !pc || pc.signalingState === "stable") return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      await this.flushPendingIceCandidates(link, pc);
    } catch {
      this.callbacks.onError(`Failed to apply WebRTC answer from ${link.label}.`);
    }
  }

  private async handleRemoteIceCandidate(
    fromPeerId: string,
    candidate: RTCIceCandidateInit
  ): Promise<void> {
    const link = this.peers.get(fromPeerId);
    const pc = link?.pc;
    if (!link || !pc) return;

    if (!pc.remoteDescription) {
      link.pendingIceCandidates.push(candidate);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Ignore late or stale ICE candidates.
    }
  }

  private async flushPendingIceCandidates(
    link: PeerMeshLink,
    pc: RTCPeerConnection
  ): Promise<void> {
    const queued = link.pendingIceCandidates;
    link.pendingIceCandidates = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Ignore stale candidates.
      }
    }
  }

  private attachControlChannel(
    link: PeerMeshLink,
    channel: RTCDataChannel
  ): void {
    link.controlChannel = channel;
    channel.onopen = () => {
      this.sendControlToPeer(link.peerId, { type: "peer:hello", label: this.label });
      this.evaluateLinkConnected(link);
    };
    channel.onclose = () => {
      if (!this.manualDisconnect && this.peers.has(link.peerId)) {
        link.state = "reconnecting";
        this.emitPeersAndState();
      }
    };
    channel.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        const parsed = JSON.parse(event.data) as ControlMessage;
        if (parsed.type === "peer:hello") {
          link.label = parsed.label;
          this.emitPeersAndState();
        }
        this.callbacks.onControlMessage(link.peerId, parsed);
      } catch {
        // Drop malformed control frames.
      }
    };
  }

  private attachFileChannel(link: PeerMeshLink, channel: RTCDataChannel): void {
    link.fileChannel = channel;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = LOW_WATER_THRESHOLD;

    channel.onopen = () => {
      this.evaluateLinkConnected(link);
    };
    channel.onclose = () => {
      if (!this.manualDisconnect && this.peers.has(link.peerId)) {
        link.state = "reconnecting";
        this.emitPeersAndState();
      }
    };
    channel.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.callbacks.onBinaryMessage(link.peerId, event.data);
      } else if (event.data instanceof Blob) {
        void event.data
          .arrayBuffer()
          .then((buf) => this.callbacks.onBinaryMessage(link.peerId, buf));
      }
    };
  }

  private evaluateLinkConnected(link: PeerMeshLink): void {
    if (
      link.controlChannel?.readyState === "open" &&
      link.fileChannel?.readyState === "open"
    ) {
      if (link.negotiationTimeoutTimer) {
        clearTimeout(link.negotiationTimeoutTimer);
        link.negotiationTimeoutTimer = null;
      }
      const newlyConnected = link.state !== "connected";
      link.state = "connected";
      this.emitPeersAndState();
      if (newlyConnected) {
        this.callbacks.onPeerConnected(link.peerId);
      }
    }
  }

  private teardownPeerLink(link: PeerMeshLink): void {
    if (link.iceRestartTimer) {
      clearTimeout(link.iceRestartTimer);
      link.iceRestartTimer = null;
    }
    if (link.negotiationTimeoutTimer) {
      clearTimeout(link.negotiationTimeoutTimer);
      link.negotiationTimeoutTimer = null;
    }
    if (link.controlChannel) {
      link.controlChannel.onopen = null;
      link.controlChannel.onclose = null;
      link.controlChannel.onmessage = null;
      link.controlChannel.close();
      link.controlChannel = null;
    }
    if (link.fileChannel) {
      link.fileChannel.onopen = null;
      link.fileChannel.onclose = null;
      link.fileChannel.onmessage = null;
      link.fileChannel.close();
      link.fileChannel = null;
    }
    if (link.pc) {
      link.pc.onicecandidate = null;
      link.pc.oniceconnectionstatechange = null;
      link.pc.onconnectionstatechange = null;
      link.pc.ondatachannel = null;
      link.pc.close();
      link.pc = null;
    }
    link.pendingIceCandidates = [];
    link.localCandidateTypes.clear();
  }

  private teardownAllPeers(): void {
    for (const link of this.peers.values()) {
      this.teardownPeerLink(link);
    }
    this.peers.clear();
    this.callbacks.onPeersChange([]);
  }
}
