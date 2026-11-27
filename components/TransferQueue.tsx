"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckSquare,
  Download,
  Pause,
  Play,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { TransferItem, TransferStatus } from "@/hooks/useFileTransfer";
import { formatBytes, formatEta, formatSpeed } from "@/lib/formatBytes";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";

export interface TransferQueueProps {
  transfers: TransferItem[];
  onPause: (fileId: string) => void;
  onResume: (fileId: string) => void;
  onCancel: (fileId: string) => void;
  onDownload: (fileId: string) => void;
  onDownloadSelected: (fileIds: string[]) => Promise<void>;
  onClearFinished: () => void;
}

const STATUS_META: Record<
  TransferStatus,
  { label: string; tone: BadgeTone }
> = {
  queued: { label: "Queued", tone: "neutral" },
  transferring: { label: "Streaming", tone: "active" },
  paused: { label: "Paused", tone: "warning" },
  completed: { label: "Completed", tone: "solid" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  error: { label: "Error", tone: "danger" },
};

export function TransferQueue({
  transfers,
  onPause,
  onResume,
  onCancel,
  onDownload,
  onDownloadSelected,
  onClearFinished,
}: TransferQueueProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);

  const downloadableIds = useMemo(
    () =>
      transfers
        .filter((t) => t.direction === "incoming" && t.status === "completed")
        .map((t) => t.fileId),
    [transfers]
  );

  const downloadableSet = useMemo(
    () => new Set(downloadableIds),
    [downloadableIds]
  );

  const activeSelectedIds = useMemo(
    () => selectedIds.filter((id) => downloadableSet.has(id)),
    [downloadableSet, selectedIds]
  );

  const allSelected =
    downloadableIds.length > 0 &&
    activeSelectedIds.length === downloadableIds.length;

  const hasFinished = transfers.some(
    (t) => t.status === "completed" || t.status === "cancelled"
  );

  const toggleItem = (fileId: string): void => {
    setSelectedIds((prev) =>
      prev.includes(fileId)
        ? prev.filter((id) => id !== fileId)
        : [...prev, fileId]
    );
  };

  const toggleSelectAll = (): void => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(downloadableIds);
    }
  };

  const handleBulkDownload = async (): Promise<void> => {
    if (activeSelectedIds.length === 0 || isBulkDownloading) return;
    setIsBulkDownloading(true);
    try {
      await onDownloadSelected(activeSelectedIds);
    } finally {
      setIsBulkDownloading(false);
    }
  };

  return (
    <section className="border border-[#E5E5E5] rounded-sm bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E5E5] px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight text-[#0A0A0A] whitespace-nowrap">
            Transfer Ledger
          </h2>
          <span className="font-mono text-xs tabular-nums text-[#525252]">
            ({transfers.length})
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {downloadableIds.length > 0 && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={toggleSelectAll}
                className="whitespace-nowrap"
              >
                {allSelected ? (
                  <CheckSquare className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Square className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {allSelected ? "Deselect All" : `Select All (${downloadableIds.length})`}
              </Button>

              <Button
                variant="primary"
                size="sm"
                disabled={activeSelectedIds.length === 0 || isBulkDownloading}
                onClick={() => void handleBulkDownload()}
                className="whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                {isBulkDownloading ? (
                  "Downloading..."
                ) : (
                  <span>
                    Download<span className="hidden sm:inline"> Selected</span> ({activeSelectedIds.length})
                  </span>
                )}
              </Button>
            </>
          )}

          {hasFinished && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Clear finished transfers"
              onClick={() => {
                setSelectedIds([]);
                onClearFinished();
              }}
              className="whitespace-nowrap"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                Clear<span className="hidden sm:inline"> Finished</span>
              </span>
            </Button>
          )}
        </div>
      </div>

      {transfers.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-[#525252]">
          No active or recent transfers. Drop files or folders above to stream directly to a connected peer.
        </div>
      ) : (
        <ul className="divide-y divide-[#E5E5E5]">
          {transfers.map((item) => {
            const pct =
              item.size === 0
                ? item.status === "completed"
                  ? 100
                  : 0
                : Math.min(
                    100,
                    Math.round((item.transferredBytes / item.size) * 100)
                  );
            const meta = STATUS_META[item.status];
            const isActive =
              item.status === "transferring" || item.status === "queued";
            const isPaused = item.status === "paused";
            const canControl = isActive || isPaused;
            const isDownloadable =
              item.direction === "incoming" && item.status === "completed";
            const isSelected = activeSelectedIds.includes(item.fileId);

            return (
              <li key={item.fileId} className="px-4 py-3 space-y-2.5">
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {isDownloadable && (
                      <label className="inline-flex min-h-7 min-w-7 shrink-0 items-center justify-center rounded-sm hover:bg-[#F5F5F5] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleItem(item.fileId)}
                          aria-label={`Select ${item.relativePath} for download`}
                          className="h-4 w-4 accent-[#0A0A0A] cursor-pointer"
                        />
                      </label>
                    )}

                    <span
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-[#E5E5E5] bg-[#FAFAFA]"
                      aria-hidden="true"
                    >
                      {item.direction === "outgoing" ? (
                        <ArrowUpRight className="h-3.5 w-3.5 text-[#0A0A0A]" />
                      ) : (
                        <ArrowDownLeft className="h-3.5 w-3.5 text-[#0A0A0A]" />
                      )}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs font-medium text-[#0A0A0A]">
                        {item.relativePath}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-mono tabular-nums text-[#525252]">
                        <span>
                          {formatBytes(item.transferredBytes)} / {formatBytes(item.size)}
                        </span>
                        {item.status === "transferring" && (
                          <>
                            <span>{formatSpeed(item.speedBytesPerSec)}</span>
                            <span>ETA {formatEta(item.etaSeconds)}</span>
                          </>
                        )}
                        {item.direction === "incoming" && (
                          <span>{item.storageBackend}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end shrink-0">
                    <div className="flex items-center gap-2">
                      <Badge tone={meta.tone} dot>
                        {meta.label}
                      </Badge>
                      <span className="w-10 text-right font-mono text-xs tabular-nums text-[#0A0A0A]">
                        {pct}%
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {isDownloadable && (
                        <Button
                          variant="primary"
                          size="sm"
                          aria-label={`Download ${item.name}`}
                          onClick={() => onDownload(item.fileId)}
                          className="whitespace-nowrap"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                          Download
                        </Button>
                      )}

                      {canControl && (
                        <>
                          {isPaused ? (
                            <Button
                              variant="secondary"
                              size="icon"
                              aria-label={`Resume ${item.name}`}
                              onClick={() => onResume(item.fileId)}
                            >
                              <Play className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              size="icon"
                              aria-label={`Pause ${item.name}`}
                              onClick={() => onPause(item.fileId)}
                            >
                              <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          )}
                          <Button
                            variant="danger"
                            size="icon"
                            aria-label={`Cancel ${item.name}`}
                            onClick={() => onCancel(item.fileId)}
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <ProgressBar
                  value={pct}
                  label={`${item.relativePath} transfer progress`}
                />

                {item.errorMessage && (
                  <p className="text-xs text-[#991B1B]">{item.errorMessage}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
