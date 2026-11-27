import type { ScratchpadWireEntry } from "@/core/protocol";

export interface ScratchpadEntry extends ScratchpadWireEntry {
  isLocal: boolean;
}

export function createScratchpadEntry(
  text: string,
  senderId: string,
  senderLabel: string
): ScratchpadEntry {
  return {
    id: crypto.randomUUID(),
    text,
    senderId,
    senderLabel,
    timestamp: Date.now(),
    isLocal: true,
  };
}

export function toWireEntry(entry: ScratchpadEntry): ScratchpadWireEntry {
  return {
    id: entry.id,
    text: entry.text,
    senderId: entry.senderId,
    senderLabel: entry.senderLabel,
    timestamp: entry.timestamp,
  };
}

export function mergeScratchpadEntries(
  current: ScratchpadEntry[],
  incoming: ScratchpadWireEntry[],
  localPeerId: string
): ScratchpadEntry[] {
  const byId = new Map<string, ScratchpadEntry>();
  for (const item of current) {
    byId.set(item.id, item);
  }
  for (const raw of incoming) {
    if (!byId.has(raw.id)) {
      byId.set(raw.id, {
        ...raw,
        isLocal: raw.senderId === localPeerId,
      });
    }
  }
  return Array.from(byId.values()).toSorted((a, b) => a.timestamp - b.timestamp);
}
