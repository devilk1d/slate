"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHUNK_SIZE,
  calculateTotalChunks,
  decodeChunkFrame,
  encodeChunkFrame,
  type QueuedInputFile,
} from "@/core/chunker";
import { fileStorage, type StorageBackendKind } from "@/lib/fileStorage";
import type { UsePeerSessionResult } from "@/hooks/usePeerSession";

export type TransferDirection = "outgoing" | "incoming";
export type TransferStatus =
  | "queued"
  | "transferring"
  | "paused"
  | "completed"
  | "cancelled"
  | "error";

export interface TransferItem {
  fileId: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType: string;
  direction: TransferDirection;
  status: TransferStatus;
  totalChunks: number;
  completedChunks: number;
  transferredBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  storageBackend: StorageBackendKind;
  errorMessage?: string;
}

interface OutgoingContext {
  file: File;
  meta: TransferItem;
  receivedChunks: Set<number>;
  sending: boolean;
  paused: boolean;
  cancelled: boolean;
}

interface IncomingContext {
  meta: TransferItem;
  receivedChunks: Set<number>;
  paused: boolean;
  cancelled: boolean;
  finalized: boolean;
  readyBlob?: Blob;
}

export interface UseFileTransferResult {
  transfers: TransferItem[];
  activeCount: number;
  storageBackend: StorageBackendKind;
  enqueueFiles: (inputs: QueuedInputFile[]) => void;
  pauseTransfer: (fileId: string) => void;
  resumeTransfer: (fileId: string) => void;
  cancelTransfer: (fileId: string) => void;
  downloadTransfer: (fileId: string) => void;
  downloadTransfers: (fileIds: string[]) => Promise<void>;
  clearFinished: () => void;
}

export function useFileTransfer(
  session: UsePeerSessionResult
): UseFileTransferResult {
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [storageBackend, setStorageBackend] =
    useState<StorageBackendKind>("OPFS");

  const outgoingRef = useRef<Map<string, OutgoingContext>>(new Map());
  const incomingRef = useRef<Map<string, IncomingContext>>(new Map());
  const rateTrackerRef = useRef<
    Map<
      string,
      {
        startTime: number;
        startBytes: number;
        lastTime: number;
        lastBytes: number;
        emaSpeed: number;
      }
    >
  >(new Map());

  const {
    connectionState,
    sendControl,
    sendBinaryChunk,
    subscribeControl,
    subscribeBinary,
  } = session;

  useEffect(() => {
    void fileStorage.getBackendKind().then(setStorageBackend);
  }, []);

  const syncStateList = useCallback(() => {
    const all: TransferItem[] = [
      ...Array.from(outgoingRef.current.values()).map((c) => ({ ...c.meta })),
      ...Array.from(incomingRef.current.values()).map((c) => ({ ...c.meta })),
    ];
    setTransfers(all);
  }, []);

  const resetRateTracker = useCallback((fileId: string, baselineBytes: number) => {
    const now = performance.now();
    rateTrackerRef.current.set(fileId, {
      startTime: now,
      startBytes: baselineBytes,
      lastTime: now,
      lastBytes: baselineBytes,
      emaSpeed: 0,
    });
  }, []);

  const updateThroughput = useCallback((fileId: string, bytesNow: number, totalSize: number) => {
    const now = performance.now();
    let tracker = rateTrackerRef.current.get(fileId);

    if (!tracker) {
      tracker = {
        startTime: now,
        startBytes: 0,
        lastTime: now,
        lastBytes: 0,
        emaSpeed: 0,
      };
      rateTrackerRef.current.set(fileId, tracker);
    }

    const windowSec = (now - tracker.lastTime) / 1000;
    const totalSec = Math.max(0.01, (now - tracker.startTime) / 1000);

    if (windowSec >= 0.2) {
      const deltaBytes = Math.max(0, bytesNow - tracker.lastBytes);
      const instant = deltaBytes / windowSec;
      const ema =
        tracker.emaSpeed === 0 ? instant : tracker.emaSpeed * 0.65 + instant * 0.35;
      tracker = {
        ...tracker,
        lastTime: now,
        lastBytes: bytesNow,
        emaSpeed: ema,
      };
      rateTrackerRef.current.set(fileId, tracker);
    }

    // Use cumulative speed before the first 200ms EMA window completes so fast transfers show ETA immediately.
    const effectiveSpeed =
      tracker.emaSpeed > 0
        ? tracker.emaSpeed
        : Math.max(0, bytesNow - tracker.startBytes) / totalSec;
    const remaining = Math.max(0, totalSize - bytesNow);
    const eta = effectiveSpeed > 0 ? remaining / effectiveSpeed : -1;

    return { speed: effectiveSpeed, eta };
  }, []);

  const streamOutgoingChunks = useCallback(
    async (fileId: string): Promise<void> => {
      const ctx = outgoingRef.current.get(fileId);
      if (!ctx || ctx.sending || ctx.paused || ctx.cancelled) return;

      ctx.sending = true;
      ctx.meta.status = "transferring";
      resetRateTracker(fileId, ctx.receivedChunks.size * CHUNK_SIZE);
      syncStateList();

      try {
        const total = ctx.meta.totalChunks;

        if (total === 0) {
          sendControl({ type: "file:complete", fileId });
          ctx.meta.status = "completed";
          ctx.meta.speedBytesPerSec = 0;
          ctx.meta.etaSeconds = 0;
          syncStateList();
          return;
        }

        for (let idx = 0; idx < total; idx++) {
          if (ctx.paused || ctx.cancelled) return;
          if (ctx.receivedChunks.has(idx)) continue;

          const start = idx * CHUNK_SIZE;
          const end = Math.min(ctx.file.size, start + CHUNK_SIZE);
          const sliceBuffer = await ctx.file.slice(start, end).arrayBuffer();
          const frame = encodeChunkFrame(fileId, idx, sliceBuffer);

          await sendBinaryChunk(frame);
          ctx.receivedChunks.add(idx);

          const bytesSent = Math.min(
            ctx.file.size,
            ctx.receivedChunks.size * CHUNK_SIZE
          );
          const metrics = updateThroughput(fileId, bytesSent, ctx.file.size);
          ctx.meta.completedChunks = ctx.receivedChunks.size;
          ctx.meta.transferredBytes = bytesSent;
          ctx.meta.speedBytesPerSec = metrics.speed;
          ctx.meta.etaSeconds = metrics.eta;

          if (idx === 0 || idx % 4 === 0 || idx === total - 1) {
            syncStateList();
          }
        }

        if (!ctx.paused && !ctx.cancelled) {
          sendControl({ type: "file:complete", fileId });
          ctx.meta.status = "completed";
          ctx.meta.completedChunks = total;
          ctx.meta.transferredBytes = ctx.file.size;
          ctx.meta.speedBytesPerSec = 0;
          ctx.meta.etaSeconds = 0;
          syncStateList();
        }
      } catch (err) {
        if (!ctx.paused && !ctx.cancelled) {
          // Keep status queued when transport drops mid-stream so reconnect auto-resumes.
          ctx.meta.status = "queued";
          ctx.meta.speedBytesPerSec = 0;
          ctx.meta.errorMessage =
            err instanceof Error ? err.message : "Waiting for connection recovery.";
          syncStateList();
        }
      } finally {
        ctx.sending = false;
      }
    },
    [resetRateTracker, sendBinaryChunk, sendControl, syncStateList, updateThroughput]
  );

  const finalizeIncoming = useCallback(
    async (ctx: IncomingContext): Promise<void> => {
      if (ctx.finalized || ctx.cancelled) return;
      ctx.finalized = true;

      try {
        const readyBlob = await fileStorage.finalizeIncomingFile(
          ctx.meta.fileId,
          ctx.meta.totalChunks,
          ctx.meta.mimeType
        );
        ctx.readyBlob = readyBlob;
        ctx.meta.status = "completed";
        ctx.meta.completedChunks = ctx.meta.totalChunks;
        ctx.meta.transferredBytes = ctx.meta.size;
        ctx.meta.speedBytesPerSec = 0;
        ctx.meta.etaSeconds = 0;
      } catch (err) {
        ctx.finalized = false;
        ctx.meta.status = "error";
        ctx.meta.errorMessage =
          err instanceof Error ? err.message : "Failed to prepare received file.";
      }
      syncStateList();
    },
    [syncStateList]
  );

  useEffect(() => {
    return subscribeControl((message) => {
      switch (message.type) {
        case "file:offer": {
          void (async () => {
            const backend = await fileStorage.initIncoming(message.fileId);
            const persisted = await fileStorage.getReceivedChunks(message.fileId);
            const receivedSet = new Set(persisted);
            const existing = incomingRef.current.get(message.fileId);

            if (existing) {
              for (const c of existing.receivedChunks) receivedSet.add(c);
            }

            const bytesReceived = Math.min(
              message.size,
              receivedSet.size * message.chunkSize
            );

            const ctx: IncomingContext = {
              meta: {
                fileId: message.fileId,
                name: message.name,
                relativePath: message.relativePath,
                size: message.size,
                mimeType: message.mimeType,
                direction: "incoming",
                status: "transferring",
                totalChunks: message.totalChunks,
                completedChunks: receivedSet.size,
                transferredBytes: bytesReceived,
                speedBytesPerSec: 0,
                etaSeconds: -1,
                storageBackend: backend,
              },
              receivedChunks: receivedSet,
              paused: false,
              cancelled: false,
              finalized: false,
            };

            incomingRef.current.set(message.fileId, ctx);
            resetRateTracker(message.fileId, bytesReceived);
            syncStateList();
            sendControl({
              type: "file:accept",
              fileId: message.fileId,
              receivedChunks: Array.from(receivedSet),
            });
          })();
          break;
        }
        case "file:accept": {
          const ctx = outgoingRef.current.get(message.fileId);
          if (!ctx) break;
          ctx.receivedChunks = new Set(message.receivedChunks);
          ctx.meta.completedChunks = ctx.receivedChunks.size;
          ctx.meta.transferredBytes = Math.min(
            ctx.file.size,
            ctx.receivedChunks.size * CHUNK_SIZE
          );
          if (!ctx.paused && !ctx.cancelled) {
            void streamOutgoingChunks(message.fileId);
          }
          break;
        }
        case "file:complete": {
          const ctx = incomingRef.current.get(message.fileId);
          if (!ctx) break;
          if (ctx.receivedChunks.size >= ctx.meta.totalChunks) {
            void finalizeIncoming(ctx);
          }
          break;
        }
        case "file:pause": {
          const outCtx = outgoingRef.current.get(message.fileId);
          if (outCtx) {
            outCtx.paused = true;
            outCtx.meta.status = "paused";
            outCtx.meta.speedBytesPerSec = 0;
          }
          const inCtx = incomingRef.current.get(message.fileId);
          if (inCtx) {
            inCtx.paused = true;
            inCtx.meta.status = "paused";
            inCtx.meta.speedBytesPerSec = 0;
            void fileStorage.flushMeta(message.fileId);
          }
          syncStateList();
          break;
        }
        case "file:resume": {
          const outCtx = outgoingRef.current.get(message.fileId);
          if (outCtx) {
            outCtx.paused = false;
            outCtx.receivedChunks = new Set(message.receivedChunks);
            outCtx.meta.errorMessage = undefined;
            void streamOutgoingChunks(message.fileId);
          }
          const inCtx = incomingRef.current.get(message.fileId);
          if (inCtx) {
            inCtx.paused = false;
            inCtx.meta.status = "transferring";
            inCtx.meta.errorMessage = undefined;
          }
          syncStateList();
          break;
        }
        case "file:cancel": {
          const outCtx = outgoingRef.current.get(message.fileId);
          if (outCtx) {
            outCtx.cancelled = true;
            outCtx.meta.status = "cancelled";
            outCtx.meta.speedBytesPerSec = 0;
          }
          const inCtx = incomingRef.current.get(message.fileId);
          if (inCtx) {
            inCtx.cancelled = true;
            inCtx.meta.status = "cancelled";
            inCtx.meta.speedBytesPerSec = 0;
            void fileStorage.purgeTransfer(message.fileId, inCtx.meta.totalChunks);
          }
          syncStateList();
          break;
        }
        case "transfer:sync": {
          for (const item of message.incoming) {
            const outCtx = outgoingRef.current.get(item.fileId);
            if (outCtx && !outCtx.cancelled && outCtx.meta.status !== "completed") {
              outCtx.receivedChunks = new Set(item.receivedChunks);
              outCtx.meta.completedChunks = outCtx.receivedChunks.size;
              outCtx.meta.transferredBytes = Math.min(
                outCtx.file.size,
                outCtx.receivedChunks.size * CHUNK_SIZE
              );
              if (!outCtx.paused) {
                outCtx.meta.errorMessage = undefined;
                void streamOutgoingChunks(item.fileId);
              }
            }
          }
          syncStateList();
          break;
        }
      }
    });
  }, [
    finalizeIncoming,
    resetRateTracker,
    sendControl,
    streamOutgoingChunks,
    subscribeControl,
    syncStateList,
  ]);

  useEffect(() => {
    return subscribeBinary((buffer) => {
      const frame = decodeChunkFrame(buffer);
      if (!frame) return;

      const ctx = incomingRef.current.get(frame.fileId);
      if (!ctx || ctx.cancelled) return;

      const byteOffset = frame.chunkIndex * CHUNK_SIZE;
      void fileStorage
        .writeChunk(frame.fileId, frame.chunkIndex, byteOffset, frame.payload)
        .then(() => {
          if (ctx.cancelled) return;
          ctx.receivedChunks.add(frame.chunkIndex);
          const bytesNow = Math.min(
            ctx.meta.size,
            ctx.receivedChunks.size * CHUNK_SIZE
          );
          const metrics = updateThroughput(frame.fileId, bytesNow, ctx.meta.size);
          ctx.meta.completedChunks = ctx.receivedChunks.size;
          ctx.meta.transferredBytes = bytesNow;
          ctx.meta.speedBytesPerSec = metrics.speed;
          ctx.meta.etaSeconds = metrics.eta;

          if (ctx.receivedChunks.size >= ctx.meta.totalChunks) {
            void finalizeIncoming(ctx);
          } else if (ctx.receivedChunks.size === 1 || frame.chunkIndex % 4 === 0) {
            syncStateList();
          }
        })
        .catch((err) => {
          ctx.meta.status = "error";
          ctx.meta.errorMessage =
            err instanceof Error ? err.message : "Failed writing chunk to storage.";
          syncStateList();
        });
    });
  }, [finalizeIncoming, subscribeBinary, syncStateList, updateThroughput]);

  useEffect(() => {
    if (connectionState !== "connected") return;

    const incompleteIncoming = Array.from(incomingRef.current.values())
      .filter((c) => !c.cancelled && c.meta.status !== "completed")
      .map((c) => ({
        fileId: c.meta.fileId,
        receivedChunks: Array.from(c.receivedChunks),
      }));

    if (incompleteIncoming.length > 0) {
      sendControl({ type: "transfer:sync", incoming: incompleteIncoming });
    }

    for (const ctx of outgoingRef.current.values()) {
      if (
        !ctx.paused &&
        !ctx.cancelled &&
        !ctx.sending &&
        ctx.meta.status !== "completed"
      ) {
        sendControl({
          type: "file:offer",
          fileId: ctx.meta.fileId,
          name: ctx.meta.name,
          relativePath: ctx.meta.relativePath,
          size: ctx.meta.size,
          mimeType: ctx.meta.mimeType,
          chunkSize: CHUNK_SIZE,
          totalChunks: ctx.meta.totalChunks,
        });
      }
    }
  }, [connectionState, sendControl]);

  const enqueueFiles = useCallback(
    (inputs: QueuedInputFile[]) => {
      for (const { file, relativePath } of inputs) {
        const fileId = crypto.randomUUID();
        const totalChunks = calculateTotalChunks(file.size, CHUNK_SIZE);
        const meta: TransferItem = {
          fileId,
          name: file.name,
          relativePath,
          size: file.size,
          mimeType: file.type || "application/octet-stream",
          direction: "outgoing",
          status: connectionState === "connected" ? "queued" : "queued",
          totalChunks,
          completedChunks: 0,
          transferredBytes: 0,
          speedBytesPerSec: 0,
          etaSeconds: -1,
          storageBackend,
        };

        outgoingRef.current.set(fileId, {
          file,
          meta,
          receivedChunks: new Set(),
          sending: false,
          paused: false,
          cancelled: false,
        });

        if (connectionState === "connected") {
          sendControl({
            type: "file:offer",
            fileId,
            name: meta.name,
            relativePath: meta.relativePath,
            size: meta.size,
            mimeType: meta.mimeType,
            chunkSize: CHUNK_SIZE,
            totalChunks,
          });
        }
      }
      syncStateList();
    },
    [connectionState, sendControl, storageBackend, syncStateList]
  );

  const pauseTransfer = useCallback(
    (fileId: string) => {
      const outCtx = outgoingRef.current.get(fileId);
      if (outCtx && !outCtx.cancelled && outCtx.meta.status !== "completed") {
        outCtx.paused = true;
        outCtx.meta.status = "paused";
        outCtx.meta.speedBytesPerSec = 0;
        sendControl({ type: "file:pause", fileId });
      }
      const inCtx = incomingRef.current.get(fileId);
      if (inCtx && !inCtx.cancelled && inCtx.meta.status !== "completed") {
        inCtx.paused = true;
        inCtx.meta.status = "paused";
        inCtx.meta.speedBytesPerSec = 0;
        void fileStorage.flushMeta(fileId);
        sendControl({ type: "file:pause", fileId });
      }
      syncStateList();
    },
    [sendControl, syncStateList]
  );

  const resumeTransfer = useCallback(
    (fileId: string) => {
      const outCtx = outgoingRef.current.get(fileId);
      if (outCtx && !outCtx.cancelled && outCtx.meta.status !== "completed") {
        outCtx.paused = false;
        outCtx.meta.errorMessage = undefined;
        sendControl({
          type: "file:resume",
          fileId,
          receivedChunks: Array.from(outCtx.receivedChunks),
        });
        void streamOutgoingChunks(fileId);
      }
      const inCtx = incomingRef.current.get(fileId);
      if (inCtx && !inCtx.cancelled && inCtx.meta.status !== "completed") {
        inCtx.paused = false;
        inCtx.meta.status = "transferring";
        inCtx.meta.errorMessage = undefined;
        sendControl({
          type: "file:resume",
          fileId,
          receivedChunks: Array.from(inCtx.receivedChunks),
        });
      }
      syncStateList();
    },
    [sendControl, streamOutgoingChunks, syncStateList]
  );

  const cancelTransfer = useCallback(
    (fileId: string) => {
      const outCtx = outgoingRef.current.get(fileId);
      if (outCtx) {
        outCtx.cancelled = true;
        outCtx.meta.status = "cancelled";
        outCtx.meta.speedBytesPerSec = 0;
        sendControl({ type: "file:cancel", fileId });
      }
      const inCtx = incomingRef.current.get(fileId);
      if (inCtx) {
        inCtx.cancelled = true;
        inCtx.meta.status = "cancelled";
        inCtx.meta.speedBytesPerSec = 0;
        void fileStorage.purgeTransfer(fileId, inCtx.meta.totalChunks);
        sendControl({ type: "file:cancel", fileId });
      }
      syncStateList();
    },
    [sendControl, syncStateList]
  );

  const downloadTransfer = useCallback((fileId: string) => {
    const ctx = incomingRef.current.get(fileId);
    if (!ctx?.readyBlob) return;
    fileStorage.triggerBrowserDownload(ctx.readyBlob, ctx.meta.name);
  }, []);

  const downloadTransfers = useCallback(async (fileIds: string[]) => {
    for (let i = 0; i < fileIds.length; i++) {
      const ctx = incomingRef.current.get(fileIds[i]);
      if (!ctx?.readyBlob) continue;
      fileStorage.triggerBrowserDownload(ctx.readyBlob, ctx.meta.name);
      if (i < fileIds.length - 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 160));
      }
    }
  }, []);

  const clearFinished = useCallback(() => {
    for (const [id, ctx] of outgoingRef.current.entries()) {
      if (ctx.meta.status === "completed" || ctx.meta.status === "cancelled") {
        outgoingRef.current.delete(id);
        rateTrackerRef.current.delete(id);
      }
    }
    for (const [id, ctx] of incomingRef.current.entries()) {
      if (ctx.meta.status === "completed" || ctx.meta.status === "cancelled") {
        void fileStorage.purgeTransfer(id, ctx.meta.totalChunks);
        incomingRef.current.delete(id);
        rateTrackerRef.current.delete(id);
      }
    }
    syncStateList();
  }, [syncStateList]);

  const activeCount = transfers.filter(
    (t) => t.status === "transferring" || t.status === "queued"
  ).length;

  return {
    transfers,
    activeCount,
    storageBackend,
    enqueueFiles,
    pauseTransfer,
    resumeTransfer,
    cancelTransfer,
    downloadTransfer,
    downloadTransfers,
    clearFinished,
  };
}
