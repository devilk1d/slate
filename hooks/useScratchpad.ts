"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createScratchpadEntry,
  mergeScratchpadEntries,
  toWireEntry,
  type ScratchpadEntry,
} from "@/core/scratchpad";
import type { UsePeerSessionResult } from "@/hooks/usePeerSession";

export interface UseScratchpadResult {
  entries: ScratchpadEntry[];
  lastClearedBy: string | null;
  sendEntry: (text: string) => boolean;
  clearSession: () => void;
}

export function useScratchpad(session: UsePeerSessionResult): UseScratchpadResult {
  const [entries, setEntries] = useState<ScratchpadEntry[]>([]);
  const [lastClearedBy, setLastClearedBy] = useState<string | null>(null);

  const entriesRef = useRef<ScratchpadEntry[]>(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const { subscribeControl, sendControl, connectionState, localPeerId, localLabel } =
    session;

  useEffect(() => {
    return subscribeControl((message) => {
      if (message.type === "scratchpad:entry") {
        setLastClearedBy(null);
        setEntries((prev) =>
          mergeScratchpadEntries(prev, [message.entry], localPeerId)
        );
      } else if (message.type === "scratchpad:sync") {
        setEntries((prev) =>
          mergeScratchpadEntries(prev, message.entries, localPeerId)
        );
      } else if (message.type === "scratchpad:clear") {
        setEntries([]);
        setLastClearedBy(message.senderLabel);
      }
    });
  }, [subscribeControl, localPeerId]);

  useEffect(() => {
    if (connectionState === "connected" && entriesRef.current.length > 0) {
      sendControl({
        type: "scratchpad:sync",
        entries: entriesRef.current.map(toWireEntry),
      });
    }
  }, [connectionState, sendControl]);

  const sendEntry = useCallback(
    (rawText: string): boolean => {
      const trimmed = rawText.trim();
      if (!trimmed) return false;

      const entry = createScratchpadEntry(trimmed, localPeerId, localLabel);
      setLastClearedBy(null);
      setEntries((prev) => [...prev, entry]);
      sendControl({ type: "scratchpad:entry", entry: toWireEntry(entry) });
      return true;
    },
    [localPeerId, localLabel, sendControl]
  );

  const clearSession = useCallback(() => {
    setEntries([]);
    setLastClearedBy(localLabel);
    sendControl({
      type: "scratchpad:clear",
      timestamp: Date.now(),
      senderLabel: localLabel,
    });
  }, [localLabel, sendControl]);

  return {
    entries,
    lastClearedBy,
    sendEntry,
    clearSession,
  };
}
