"use client";

import { useMemo, useRef, useState, type DragEvent } from "react";
import {
  FileUp,
  FolderUp,
  HardDrive,
  Lock,
  Upload,
} from "lucide-react";
import {
  extractFilesFromDataTransfer,
  extractFilesFromFileList,
  type QueuedInputFile,
} from "@/core/chunker";
import type { PeerConnectionState, RemotePeerInfo } from "@/core/protocol";
import type { StorageBackendKind } from "@/lib/fileStorage";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export interface DropzonePanelProps {
  connectionState: PeerConnectionState;
  peers: RemotePeerInfo[];
  storageBackend: StorageBackendKind;
  wakeLockActive: boolean;
  onFilesSelected: (files: QueuedInputFile[], targetPeerIds: string[]) => void;
  onOpenPairing: () => void;
}

export function DropzonePanel({
  connectionState,
  peers,
  storageBackend,
  wakeLockActive,
  onFilesSelected,
  onOpenPairing,
}: DropzonePanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [excludedPeerIds, setExcludedPeerIds] = useState<Set<string>>(new Set());
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const selectedTargetIds = useMemo(
    () =>
      peers
        .filter((peer) => !excludedPeerIds.has(peer.peerId))
        .map((peer) => peer.peerId),
    [excludedPeerIds, peers]
  );

  const isConnected = connectionState === "connected";
  const hasPeers = peers.length > 0;
  const noTargetSelected = hasPeers && selectedTargetIds.length === 0;

  const toggleTargetPeer = (peerId: string): void => {
    setExcludedPeerIds((prev) => {
      const next = new Set(prev);
      if (next.has(peerId)) {
        next.delete(peerId);
      } else {
        next.add(peerId);
      }
      return next;
    });
  };

  const selectAllTargets = (): void => {
    setExcludedPeerIds(new Set());
  };

  const clearAllTargets = (): void => {
    setExcludedPeerIds(new Set(peers.map((p) => p.peerId)));
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = noTargetSelected ? "none" : "copy";
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    if (noTargetSelected) return;

    void extractFilesFromDataTransfer(event.dataTransfer).then((items) => {
      if (items.length > 0) {
        onFilesSelected(items, selectedTargetIds);
      }
    });
  };

  return (
    <section className="flex flex-col border border-[#E5E5E5] rounded-sm bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-[#E5E5E5] px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Upload className="h-4 w-4 shrink-0 text-[#0A0A0A]" aria-hidden="true" />
          <h2 className="truncate text-sm font-semibold tracking-tight text-[#0A0A0A]">
            File & Folder Stream
          </h2>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Badge tone="neutral">
            <HardDrive className="h-3 w-3" aria-hidden="true" />
            {storageBackend}
          </Badge>
          {wakeLockActive && (
            <Badge tone="solid">
              <Lock className="h-3 w-3" aria-hidden="true" />
              Wake Lock
            </Badge>
          )}
        </div>
      </div>

      {hasPeers && (
        <div className="border-b border-[#E5E5E5] bg-[#FAFAFA] px-4 py-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[#525252]">
              Target Devices ({selectedTargetIds.length}/{peers.length})
            </span>
            {peers.length > 1 && (
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={selectAllTargets}
                  className="font-medium text-[#0A0A0A] hover:underline cursor-pointer"
                >
                  All
                </button>
                <span className="text-[#D4D4D4]" aria-hidden="true">
                  /
                </span>
                <button
                  type="button"
                  onClick={clearAllTargets}
                  className="font-medium text-[#525252] hover:text-[#0A0A0A] hover:underline cursor-pointer"
                >
                  None
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {peers.map((peer) => {
              const checked = !excludedPeerIds.has(peer.peerId);
              return (
                <label
                  key={peer.peerId}
                  className={cn(
                    "inline-flex min-h-7 items-center gap-1.5 rounded-sm border px-2 py-1 text-xs cursor-pointer transition-colors duration-150 select-none",
                    checked
                      ? "border-[#0A0A0A] bg-white text-[#0A0A0A]"
                      : "border-[#E5E5E5] bg-[#F5F5F5] text-[#525252]"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTargetPeer(peer.peerId)}
                    className="h-3.5 w-3.5 accent-[#0A0A0A] cursor-pointer"
                  />
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      peer.state === "connected" ? "bg-[#0A0A0A]" : "bg-[#92400E]"
                    )}
                    aria-hidden="true"
                  />
                  <span className="font-mono max-w-[140px] truncate">{peer.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 p-4 flex flex-col">
        <div
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "flex-1 min-h-48 sm:min-h-64 flex flex-col items-center justify-center gap-4 rounded-sm border border-dashed px-4 sm:px-6 py-6 sm:py-8 text-center transition-colors duration-150",
            isDragging && !noTargetSelected
              ? "border-[#0A0A0A] bg-[#F5F5F5]"
              : "border-[#D4D4D4] bg-[#FAFAFA]"
          )}
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-[#E5E5E5] bg-white">
            <FileUp className="h-5 w-5 text-[#0A0A0A]" aria-hidden="true" />
          </div>

          <div className="space-y-1 max-w-sm">
            <p className="text-sm font-medium text-[#0A0A0A]">
              {noTargetSelected
                ? "Select at least one target device above"
                : isDragging
                  ? "Release to queue files and directories"
                  : "Drop files or entire folders here"}
            </p>
            <p className="text-xs leading-relaxed text-[#525252]">
              {noTargetSelected
                ? "Only checked devices will receive file streams, saving upload bandwidth."
                : isConnected
                  ? `64 KB DTLS-encrypted chunks stream directly to ${selectedTargetIds.length} selected ${selectedTargetIds.length === 1 ? "peer" : "peers"}.`
                  : "Stage files now or pair peer devices to begin direct WebRTC streaming."}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <Button
              variant="primary"
              size="md"
              disabled={noTargetSelected}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp className="h-4 w-4" aria-hidden="true" />
              Select Files
            </Button>

            <Button
              variant="secondary"
              size="md"
              disabled={noTargetSelected}
              onClick={() => folderInputRef.current?.click()}
            >
              <FolderUp className="h-4 w-4" aria-hidden="true" />
              Select Folder
            </Button>

            {!isConnected && (
              <Button variant="ghost" size="md" onClick={onOpenPairing}>
                Pair Device
              </Button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="sr-only"
            aria-label="Choose files to send"
            onChange={(e) => {
              const items = extractFilesFromFileList(e.target.files);
              if (items.length > 0 && !noTargetSelected) {
                onFilesSelected(items, selectedTargetIds);
              }
              e.target.value = "";
            }}
          />

          <input
            ref={folderInputRef}
            type="file"
            multiple
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            className="sr-only"
            aria-label="Choose folder to send"
            onChange={(e) => {
              const items = extractFilesFromFileList(e.target.files);
              if (items.length > 0 && !noTargetSelected) {
                onFilesSelected(items, selectedTargetIds);
              }
              e.target.value = "";
            }}
          />
        </div>
      </div>
    </section>
  );
}
