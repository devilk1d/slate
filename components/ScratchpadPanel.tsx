"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Eraser, Send, Terminal } from "lucide-react";
import type { PeerConnectionState } from "@/core/protocol";
import type { ScratchpadEntry } from "@/core/scratchpad";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";

export interface ScratchpadPanelProps {
  connectionState: PeerConnectionState;
  entries: ScratchpadEntry[];
  lastClearedBy: string | null;
  onSendEntry: (text: string) => boolean;
  onClearSession: () => void;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function ScratchpadPanel({
  connectionState,
  entries,
  lastClearedBy,
  onSendEntry,
  onClearSession,
}: ScratchpadPanelProps) {
  const [draft, setDraft] = useState("");
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [entries.length]);

  const submitDraft = (): void => {
    if (onSendEntry(draft)) {
      setDraft("");
    }
  };

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    submitDraft();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      submitDraft();
    }
  };

  return (
    <section className="flex flex-col border border-[#E5E5E5] rounded-sm bg-white min-h-[24rem]">
      <div className="flex items-center justify-between gap-2 border-b border-[#E5E5E5] px-4 py-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-[#0A0A0A]" aria-hidden="true" />
          <h2 className="text-sm font-semibold tracking-tight text-[#0A0A0A]">
            Live Scratchpad
          </h2>
          <span className="font-mono text-xs tabular-nums text-[#525252]">
            ({entries.length})
          </span>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={onClearSession}
          disabled={entries.length === 0}
        >
          <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
          Clear Session
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 max-h-80 min-h-48 bg-[#FAFAFA]">
        {entries.length === 0 ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center text-center px-4">
            <p className="text-xs font-medium text-[#0A0A0A]">
              {lastClearedBy
                ? `Scratchpad cleared across peers by ${lastClearedBy}`
                : "Ephemeral session feed is empty"}
            </p>
            <p className="mt-1 text-xs text-[#525252] max-w-xs">
              {connectionState === "connected"
                ? "Send links, shell commands, or code snippets directly over WebRTC."
                : "Entries added here sync automatically as soon as a peer connects."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className={cn(
                  "rounded-sm border p-3 bg-white",
                  entry.isLocal ? "border-[#262626]" : "border-[#E5E5E5]"
                )}
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate font-mono text-xs font-semibold text-[#0A0A0A]">
                      {entry.senderLabel}
                    </span>
                    {entry.isLocal && (
                      <span className="rounded-sm bg-[#F5F5F5] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#525252]">
                        You
                      </span>
                    )}
                    <time
                      dateTime={new Date(entry.timestamp).toISOString()}
                      className="font-mono text-[11px] tabular-nums text-[#525252]"
                    >
                      {formatTimestamp(entry.timestamp)}
                    </time>
                  </div>
                  <CopyButton
                    text={entry.text}
                    ariaLabel={`Copy snippet from ${entry.senderLabel}`}
                  />
                </div>
                <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[#0A0A0A] select-text">
                  {entry.text}
                </pre>
              </li>
            ))}
            <div ref={listEndRef} />
          </ul>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-[#E5E5E5] bg-white p-3 space-y-2"
      >
        <label htmlFor="scratchpad-composer" className="sr-only">
          Message or code snippet
        </label>
        <textarea
          id="scratchpad-composer"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste a link, terminal command, or note... (Ctrl+Enter to send)"
          className="w-full resize-y rounded-sm border border-[#E5E5E5] bg-white px-3 py-2 font-mono text-xs leading-relaxed text-[#0A0A0A] placeholder:text-[#737373] focus:border-[#0A0A0A]"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-[#525252]">
            {connectionState === "connected"
              ? "Synced live over ordered control DataChannel"
              : "Queued locally until peer connects"}
          </span>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={draft.trim().length === 0}
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            Send
          </Button>
        </div>
      </form>
    </section>
  );
}
