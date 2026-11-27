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
  PeerDescriptor,
} from "@/core/protocol";
import { PeerSessionManager } from "@/core/webrtc";
import {
  getOrCreatePeerId,
  loadDeviceLabel,
  saveDeviceLabel,
  subscribeDeviceLabel,
} from "@/lib/deviceIdentity";

export type ControlListener = (message: ControlMessage) => void;
export type BinaryListener = (buffer: ArrayBuffer) => void;

export interface UsePeerSessionResult {
  connectionState: PeerConnectionState;
  roomCode: string | null;
  localPeerId: string;
  localLabel: string;
  remotePeer: PeerDescriptor | null;
  error: string | null;
  clearError: () => void;
  createRoom: (preferredCode?: string) => void;
  joinRoom: (roomCode: string) => void;
  disconnect: () => void;
  updateLocalLabel: (nextLabel: string) => void;
  refreshIceConfig: () => void;
  sendControl: (message: ControlMessage) => boolean;
  sendBinaryChunk: (buffer: ArrayBuffer) => Promise<void>;
  subscribeControl: (listener: ControlListener) => () => void;
  subscribeBinary: (listener: BinaryListener) => () => void;
}

const subscribeNoop = (): (() => void) => () => {};

export function usePeerSession(): UsePeerSessionResult {
  const [connectionState, setConnectionState] =
    useState<PeerConnectionState>("idle");
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [remotePeer, setRemotePeer] = useState<PeerDescriptor | null>(null);
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

  useEffect(() => {
    const id = getOrCreatePeerId();
    const label = loadDeviceLabel();

    const manager = new PeerSessionManager(id, label, {
      onStateChange: (next) => setConnectionState(next),
      onRoomChange: (code) => setRoomCode(code),
      onRemotePeerChange: (peer) => setRemotePeer(peer),
      onControlMessage: (msg) => {
        for (const listener of controlListenersRef.current) {
          listener(msg);
        }
      },
      onBinaryMessage: (buffer) => {
        for (const listener of binaryListenersRef.current) {
          listener(buffer);
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

  const sendControl = useCallback((message: ControlMessage) => {
    return managerRef.current?.sendControl(message) ?? false;
  }, []);

  const sendBinaryChunk = useCallback((buffer: ArrayBuffer) => {
    if (!managerRef.current) {
      return Promise.reject(new Error("Peer session is not initialized."));
    }
    return managerRef.current.sendBinaryChunk(buffer);
  }, []);

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

  const clearError = useCallback(() => setError(null), []);

  return {
    connectionState,
    roomCode,
    localPeerId,
    localLabel,
    remotePeer,
    error,
    clearError,
    createRoom,
    joinRoom,
    disconnect,
    updateLocalLabel,
    refreshIceConfig,
    sendControl,
    sendBinaryChunk,
    subscribeControl,
    subscribeBinary,
  };
}
