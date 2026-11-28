export interface CustomIceServerEntry {
  id: string;
  urls: string;
  username?: string;
  credential?: string;
}

const ICE_STORAGE_KEY = "slate.iceServers";

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

export function loadCustomIceServers(): CustomIceServerEntry[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(ICE_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (item): item is CustomIceServerEntry =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as CustomIceServerEntry).id === "string" &&
        typeof (item as CustomIceServerEntry).urls === "string" &&
        (item as CustomIceServerEntry).urls.trim().length > 0
    );
  } catch {
    return [];
  }
}

export function saveCustomIceServers(entries: CustomIceServerEntry[]): void {
  if (typeof window === "undefined") return;

  try {
    if (entries.length === 0) {
      window.localStorage.removeItem(ICE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(ICE_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore storage quota or private browsing write failures.
  }
}

export function getEffectiveIceServers(): RTCIceServer[] {
  const custom = loadCustomIceServers().map((entry): RTCIceServer => {
    const server: RTCIceServer = { urls: entry.urls.trim() };
    if (entry.username?.trim()) server.username = entry.username.trim();
    if (entry.credential?.trim()) server.credential = entry.credential.trim();
    return server;
  });

  return [...DEFAULT_ICE_SERVERS, ...custom];
}

export function isValidIceUrl(url: string): boolean {
  return /^(stun|stuns|turn|turns):[^\s]+$/i.test(url.trim());
}
