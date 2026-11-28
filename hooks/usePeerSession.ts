"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  ControlMessage,
  PeerConnectionState,
  RemotePeerInfo,
} from "@/core/protocol";
import { PeerSessionManager } from "@/core/webrtc";
import {
  getOrCreatePeerId,
  loadDeviceLabel,
  saveDeviceLabel,
  subscribeDeviceLabel,
} from "@/lib/deviceIdentity";

export type ControlListener = (fromPeerId: string, message: ControlMessage) => void;
export type BinaryListener = (fromPeerId: string, buffer: ArrayBuffer) => void;
export type PeerConnectedListener = (peerId: string) => void;

export interface UsePeerSessionResult {
  connectionState: PeerConnectionState;
  roomCode: string | null;
  localPeerId: string;
  localLabel: string;
  peers: RemotePeerInfo[];
  error: string | null;
  clearError: () => void;
  createRoom: (preferredCode?: string) => void;
  joinRoom: (roomCode: string) => void;
  disconnect: () => void;
  updateLocalLabel: (nextLabel: string) => void;
  refreshIceConfig: () => void;
  sendControlToPeer: (peerId: string, message: ControlMessage) => boolean;
  broadcastControl: (message: ControlMessage) => number;
  sendBinaryChunkToPeer: (peerId: string, buffer: ArrayBuffer) => Promise<void>;
  subscribeControl: (listener: ControlListener) => () => void;
  subscribeBinary: (listener: BinaryListener) => () => void;
  subscribePeerConnected: (listener: PeerConnectedListener) => () => void;
}

const subscribeNoop = (): (() => void) => () => {};

export function usePeerSession(): UsePeerSessionResult {
  const [connectionState, setConnectionState] =
    useState<PeerConnectionState>("idle");
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [peers, setPeers] = useState<RemotePeerInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const localPeerId = useSyncExternalStore(
    subscribeNoop,
    getOrCreatePeerId,
    () => ""
  );
  const localLabel = useSyncExternalStore(
    subscribeDeviceLabel,
    loadDeviceLabel,
    () => "Slate-Node"
  );

  const managerRef = useRef<PeerSessionManager | null>(null);
  const controlListenersRef = useRef<Set<ControlListener>>(new Set());
  const binaryListenersRef = useRef<Set<BinaryListener>>(new Set());
  const peerConnectedListenersRef = useRef<Set<PeerConnectedListener>>(new Set());

  useEffect(() => {
    const id = getOrCreatePeerId();
    const label = loadDeviceLabel();

    const manager = new PeerSessionManager(id, label, {
      onStateChange: (next) => setConnectionState(next),
      onRoomChange: (code) => setRoomCode(code),
      onPeersChange: (nextPeers) => setPeers(nextPeers),
      onPeerConnected: (peerId) => {
        for (const listener of peerConnectedListenersRef.current) {
          listener(peerId);
        }
      },
      onControlMessage: (fromPeerId, msg) => {
        for (const listener of controlListenersRef.current) {
          listener(fromPeerId, msg);
        }
      },
      onBinaryMessage: (fromPeerId, buffer) => {
        for (const listener of binaryListenersRef.current) {
          listener(fromPeerId, buffer);
        }
      },
      onError: (msg) => setError(msg),
    });

    managerRef.current = manager;
    return () => {
      manager.destroy();
      managerRef.current = null;
    };
  }, []);

  const createRoom = useCallback((preferredCode?: string) => {
    setError(null);
    managerRef.current?.createRoom(preferredCode);
  }, []);

  const joinRoom = useCallback((code: string) => {
    setError(null);
    managerRef.current?.joinRoom(code);
  }, []);

  const disconnect = useCallback(() => {
    setError(null);
    managerRef.current?.disconnect();
  }, []);

  const updateLocalLabel = useCallback((nextLabel: string) => {
    const saved = saveDeviceLabel(nextLabel);
    managerRef.current?.updateLabel(saved);
  }, []);

  const refreshIceConfig = useCallback(() => {
    managerRef.current?.refreshIceConfig();
  }, []);

  const sendControlToPeer = useCallback(
    (peerId: string, message: ControlMessage) => {
      return managerRef.current?.sendControlToPeer(peerId, message) ?? false;
    },
    []
  );

  const broadcastControl = useCallback((message: ControlMessage) => {
    return managerRef.current?.broadcastControl(message) ?? 0;
  }, []);

  const sendBinaryChunkToPeer = useCallback(
    (peerId: string, buffer: ArrayBuffer) => {
      if (!managerRef.current) {
        return Promise.reject(new Error("Peer session is not initialized."));
      }
      return managerRef.current.sendBinaryChunkToPeer(peerId, buffer);
    },
    []
  );

  const subscribeControl = useCallback((listener: ControlListener) => {
    controlListenersRef.current.add(listener);
    return () => {
      controlListenersRef.current.delete(listener);
    };
  }, []);

  const subscribeBinary = useCallback((listener: BinaryListener) => {
    binaryListenersRef.current.add(listener);
    return () => {
      binaryListenersRef.current.delete(listener);
    };
  }, []);

  const subscribePeerConnected = useCallback(
    (listener: PeerConnectedListener) => {
      peerConnectedListenersRef.current.add(listener);
      return () => {
        peerConnectedListenersRef.current.delete(listener);
      };
    },
    []
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    connectionState,
    roomCode,
    localPeerId,
    localLabel,
    peers,
    error,
    clearError,
    createRoom,
    joinRoom,
    disconnect,
    updateLocalLabel,
    refreshIceConfig,
    sendControlToPeer,
    broadcastControl,
    sendBinaryChunkToPeer,
    subscribeControl,
    subscribeBinary,
    subscribePeerConnected,
  };
}
