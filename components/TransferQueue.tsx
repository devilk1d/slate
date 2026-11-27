"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Pause,
  Play,
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
  onClearFinished,
}: TransferQueueProps) {
  const hasFinished = transfers.some(
    (t) => t.status === "completed" || t.status === "cancelled"
  );

  return (
    <section className="border border-[#E5E5E5] rounded-sm bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-[#E5E5E5] px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight text-[#0A0A0A]">
            Transfer Ledger
          </h2>
          <span className="font-mono text-xs tabular-nums text-[#525252]">
            ({transfers.length})
          </span>
        </div>

        {hasFinished && (
          <Button variant="ghost" size="sm" onClick={onClearFinished}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Clear Finished
          </Button>
        )}
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
                : Math.min(100, Math.round((item.transferredBytes / item.size) * 100));
            const meta = STATUS_META[item.status];
            const isActive = item.status === "transferring" || item.status === "queued";
            const isPaused = item.status === "paused";
            const canControl = isActive || isPaused;

            return (
              <li key={item.fileId} className="px-4 py-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
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
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs font-medium text-[#0A0A0A]">
                        {item.relativePath}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums text-[#525252]">
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

                  <div className="flex items-center gap-2">
                    <Badge tone={meta.tone} dot>
                      {meta.label}
                    </Badge>
                    <span className="w-10 text-right font-mono text-xs tabular-nums text-[#0A0A0A]">
                      {pct}%
                    </span>

                    {canControl && (
                      <div className="flex items-center gap-1">
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
                      </div>
                    )}
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
