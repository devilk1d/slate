import type {
  ClientSignalMessage,
  ControlMessage,
  PeerConnectionState,
  PeerDescriptor,
  ServerSignalMessage,
} from "@/core/protocol";
import { getEffectiveIceServers } from "@/lib/iceConfig";
import { formatRoomCode, normalizeRoomCode } from "@/lib/generateRoomCode";

const HIGH_WATER_MARK = 1024 * 1024;
const LOW_WATER_THRESHOLD = 256 * 1024;
const HEARTBEAT_INTERVAL_MS = 20_000;

export interface PeerSessionCallbacks {
  onStateChange: (state: PeerConnectionState) => void;
  onRoomChange: (roomCode: string | null) => void;
  onRemotePeerChange: (peer: PeerDescriptor | null) => void;
  onControlMessage: (message: ControlMessage) => void;
  onBinaryMessage: (data: ArrayBuffer) => void;
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
  private pc: RTCPeerConnection | null = null;
  private controlChannel: RTCDataChannel | null = null;
  private fileChannel: RTCDataChannel | null = null;

  private roomCode: string | null = null;
  private remotePeer: PeerDescriptor | null = null;
  private state: PeerConnectionState = "idle";
  private manualDisconnect = false;
  private destroyed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private iceRestartTimer: ReturnType<typeof setTimeout> | null = null;

  // Buffers remote ICE candidates until SDP remoteDescription is applied.
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private makingOffer = false;

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
    this.clearTimers();
    this.teardownPeerConnection();
    this.remotePeer = null;
    this.callbacks.onRemotePeerChange(null);

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
    this.clearTimers();
    this.teardownPeerConnection();
    this.remotePeer = null;
    this.callbacks.onRemotePeerChange(null);
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
    this.sendControl({ type: "peer:hello", label });
  }

  public refreshIceConfig(): void {
    if (this.remotePeer && this.roomCode) {
      this.startPeerConnection(this.remotePeer.peerId);
    }
  }

  public disconnect(): void {
    this.manualDisconnect = true;
    this.clearTimers();
    this.teardownPeerConnection();
    this.closeSocket("User disconnected");
    this.roomCode = null;
    this.remotePeer = null;
    this.callbacks.onRoomChange(null);
    this.callbacks.onRemotePeerChange(null);
    this.setState("disconnected");
  }

  public destroy(): void {
    this.destroyed = true;
    this.manualDisconnect = true;
    this.clearTimers();
    this.teardownPeerConnection();
    this.closeSocket();
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

  public sendControl(message: ControlMessage): boolean {
    if (!this.controlChannel || this.controlChannel.readyState !== "open") {
      return false;
    }
    this.controlChannel.send(JSON.stringify(message));
    return true;
  }

  public async sendBinaryChunk(buffer: ArrayBuffer): Promise<void> {
    const channel = this.fileChannel;
    if (!channel || channel.readyState !== "open") {
      throw new Error("File stream DataChannel is not open.");
    }

    // Backpressure guard keeps SCTP send buffer bounded so large files do not exhaust memory.
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

  private setState(next: PeerConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    this.callbacks.onStateChange(next);
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
    if (this.state !== "connected") {
      this.setState("reconnecting");
    }

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

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.iceRestartTimer) {
      clearTimeout(this.iceRestartTimer);
      this.iceRestartTimer = null;
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
          this.setState("idle");
        }
        break;
      case "room-ready": {
        this.roomCode = message.roomCode;
        this.callbacks.onRoomChange(formatRoomCode(message.roomCode));
        const other = message.peers[0] ?? null;
        this.remotePeer = other;
        this.callbacks.onRemotePeerChange(other);
        if (other) {
          this.setState("connecting");
          this.startPeerConnection(other.peerId);
        } else {
          this.setState("waiting-for-peer");
        }
        break;
      }
      case "peer-joined": {
        const nextPeer: PeerDescriptor = { peerId: message.peerId, label: message.label };
        this.remotePeer = nextPeer;
        this.callbacks.onRemotePeerChange(nextPeer);
        this.setState("connecting");
        this.startPeerConnection(nextPeer.peerId);
        break;
      }
      case "peer-updated": {
        if (this.remotePeer && this.remotePeer.peerId === message.peerId) {
          this.remotePeer = { ...this.remotePeer, label: message.label };
          this.callbacks.onRemotePeerChange(this.remotePeer);
        }
        break;
      }
      case "peer-left": {
        if (this.remotePeer?.peerId === message.peerId) {
          this.remotePeer = null;
          this.callbacks.onRemotePeerChange(null);
          this.teardownPeerConnection();
          this.setState("waiting-for-peer");
        }
        break;
      }
      case "offer":
        void this.handleOffer(message.fromPeerId, message.payload);
        break;
      case "answer":
        void this.handleAnswer(message.payload);
        break;
      case "ice-candidate":
        void this.handleRemoteIceCandidate(message.payload);
        break;
    }
  }

  private isInitiator(remotePeerId: string): boolean {
    // Deterministic tie-breaker guarantees one initiator and prevents SDP glare.
    return this.peerId > remotePeerId;
  }

  private startPeerConnection(remotePeerId: string): void {
    this.teardownPeerConnection();

    const pc = new RTCPeerConnection({ iceServers: getEffectiveIceServers() });
    this.pc = pc;
    this.pendingIceCandidates = [];

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: "ice-candidate",
          targetPeerId: remotePeerId,
          payload: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      switch (pc.connectionState) {
        case "connected":
          if (this.iceRestartTimer) {
            clearTimeout(this.iceRestartTimer);
            this.iceRestartTimer = null;
          }
          this.evaluateConnectedState();
          break;
        case "connecting":
          this.setState("connecting");
          break;
        case "disconnected":
          this.setState("reconnecting");
          if (!this.iceRestartTimer && this.isInitiator(remotePeerId)) {
            this.iceRestartTimer = setTimeout(() => {
              this.iceRestartTimer = null;
              void this.triggerIceRestart(remotePeerId);
            }, 2500);
          }
          break;
        case "failed":
          this.setState("reconnecting");
          if (this.isInitiator(remotePeerId)) {
            void this.triggerIceRestart(remotePeerId);
          }
          break;
        case "closed":
          if (!this.manualDisconnect && this.remotePeer) {
            this.setState("reconnecting");
          }
          break;
      }
    };

    if (this.isInitiator(remotePeerId)) {
      const control = pc.createDataChannel("control", { ordered: true });
      const fileStream = pc.createDataChannel("file-stream", { ordered: true });
      this.attachControlChannel(control);
      this.attachFileChannel(fileStream);
      void this.createAndSendOffer(pc, remotePeerId, false);
    } else {
      pc.ondatachannel = (event) => {
        if (event.channel.label === "control") {
          this.attachControlChannel(event.channel);
        } else if (event.channel.label === "file-stream") {
          this.attachFileChannel(event.channel);
        }
      };
    }
  }

  private async createAndSendOffer(
    pc: RTCPeerConnection,
    remotePeerId: string,
    iceRestart: boolean
  ): Promise<void> {
    try {
      this.makingOffer = true;
      const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      if (this.pc !== pc) return;
      await pc.setLocalDescription(offer);
      if (pc.localDescription) {
        this.sendSignal({
          type: "offer",
          targetPeerId: remotePeerId,
          payload: pc.localDescription.toJSON(),
        });
      }
    } catch {
      this.callbacks.onError("Failed to negotiate WebRTC offer.");
    } finally {
      this.makingOffer = false;
    }
  }

  private async triggerIceRestart(remotePeerId: string): Promise<void> {
    if (!this.pc || this.pc.signalingState === "closed") return;
    await this.createAndSendOffer(this.pc, remotePeerId, true);
  }

  private async handleOffer(fromPeerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) {
      this.startPeerConnection(fromPeerId);
    }
    const pc = this.pc;
    if (!pc) return;

    const polite = !this.isInitiator(fromPeerId);
    const offerCollision = this.makingOffer || pc.signalingState !== "stable";
    if (offerCollision && !polite) return;

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await this.flushPendingIceCandidates(pc);
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
      this.callbacks.onError("Failed to accept WebRTC offer.");
    }
  }

  private async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.pc;
    if (!pc || pc.signalingState === "stable") return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      await this.flushPendingIceCandidates(pc);
    } catch {
      this.callbacks.onError("Failed to apply WebRTC answer.");
    }
  }

  private async handleRemoteIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.pc;
    if (!pc) return;

    if (!pc.remoteDescription) {
      this.pendingIceCandidates.push(candidate);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Ignore late or stale ICE candidates after connection is established.
    }
  }

  private async flushPendingIceCandidates(pc: RTCPeerConnection): Promise<void> {
    const queued = this.pendingIceCandidates;
    this.pendingIceCandidates = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Ignore stale candidates.
      }
    }
  }

  private attachControlChannel(channel: RTCDataChannel): void {
    this.controlChannel = channel;
    channel.onopen = () => {
      this.sendControl({ type: "peer:hello", label: this.label });
      this.evaluateConnectedState();
    };
    channel.onclose = () => {
      if (!this.manualDisconnect && this.remotePeer) {
        this.setState("reconnecting");
      }
    };
    channel.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        const parsed = JSON.parse(event.data) as ControlMessage;
        if (parsed.type === "peer:hello" && this.remotePeer) {
          this.remotePeer = { ...this.remotePeer, label: parsed.label };
          this.callbacks.onRemotePeerChange(this.remotePeer);
        }
        this.callbacks.onControlMessage(parsed);
      } catch {
        // Drop malformed control frames.
      }
    };
  }

  private attachFileChannel(channel: RTCDataChannel): void {
    this.fileChannel = channel;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = LOW_WATER_THRESHOLD;

    channel.onopen = () => {
      this.evaluateConnectedState();
    };
    channel.onclose = () => {
      if (!this.manualDisconnect && this.remotePeer) {
        this.setState("reconnecting");
      }
    };
    channel.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.callbacks.onBinaryMessage(event.data);
      } else if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then((buf) => this.callbacks.onBinaryMessage(buf));
      }
    };
  }

  private evaluateConnectedState(): void {
    if (
      this.controlChannel?.readyState === "open" &&
      this.fileChannel?.readyState === "open"
    ) {
      this.setState("connected");
    }
  }

  private teardownPeerConnection(): void {
    if (this.controlChannel) {
      this.controlChannel.onopen = null;
      this.controlChannel.onclose = null;
      this.controlChannel.onmessage = null;
      this.controlChannel.close();
      this.controlChannel = null;
    }
    if (this.fileChannel) {
      this.fileChannel.onopen = null;
      this.fileChannel.onclose = null;
      this.fileChannel.onmessage = null;
      this.fileChannel.close();
      this.fileChannel = null;
    }
    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      this.pc.ondatachannel = null;
      this.pc.close();
      this.pc = null;
    }
    this.pendingIceCandidates = [];
  }
}
