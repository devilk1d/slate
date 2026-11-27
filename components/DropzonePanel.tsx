"use client";

import { useRef, useState, type DragEvent } from "react";
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
import type { PeerConnectionState } from "@/core/protocol";
import type { StorageBackendKind } from "@/lib/fileStorage";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export interface DropzonePanelProps {
  connectionState: PeerConnectionState;
  storageBackend: StorageBackendKind;
  wakeLockActive: boolean;
  onFilesSelected: (files: QueuedInputFile[]) => void;
  onOpenPairing: () => void;
}

export function DropzonePanel({
  connectionState,
  storageBackend,
  wakeLockActive,
  onFilesSelected,
  onOpenPairing,
}: DropzonePanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const isConnected = connectionState === "connected";

  const handleDragEnter = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
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

    void extractFilesFromDataTransfer(event.dataTransfer).then((items) => {
      if (items.length > 0) {
        onFilesSelected(items);
      }
    });
  };

  return (
    <section className="flex flex-col border border-[#E5E5E5] rounded-sm bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-[#E5E5E5] px-4 py-3">
        <div className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-[#0A0A0A]" aria-hidden="true" />
          <h2 className="text-sm font-semibold tracking-tight text-[#0A0A0A]">
            File & Folder Stream
          </h2>
        </div>

        <div className="flex items-center gap-1.5">
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

      <div className="flex-1 p-4 flex flex-col">
        <div
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "flex-1 min-h-48 sm:min-h-64 flex flex-col items-center justify-center gap-4 rounded-sm border border-dashed px-4 sm:px-6 py-6 sm:py-8 text-center transition-colors duration-150",
            isDragging
              ? "border-[#0A0A0A] bg-[#F5F5F5]"
              : "border-[#D4D4D4] bg-[#FAFAFA]"
          )}
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-[#E5E5E5] bg-white">
            <FileUp className="h-5 w-5 text-[#0A0A0A]" aria-hidden="true" />
          </div>

          <div className="space-y-1 max-w-sm">
            <p className="text-sm font-medium text-[#0A0A0A]">
              {isDragging
                ? "Release to queue files and directories"
                : "Drop files or entire folders here"}
            </p>
            <p className="text-xs leading-relaxed text-[#525252]">
              {isConnected
                ? "64 KB DTLS-encrypted chunks stream directly to peer disk storage with auto-resume."
                : "Stage files now or pair a peer device to begin direct WebRTC streaming."}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <Button
              variant="primary"
              size="md"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp className="h-4 w-4" aria-hidden="true" />
              Select Files
            </Button>

            <Button
              variant="secondary"
              size="md"
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
              if (items.length > 0) onFilesSelected(items);
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
              if (items.length > 0) onFilesSelected(items);
              e.target.value = "";
            }}
          />
        </div>
      </div>
    </section>
  );
}
