const DEVICE_LABEL_KEY = "slate.deviceLabel";
const PEER_ID_KEY = "slate.peerId";

let cachedPeerId: string | null = null;
let cachedDeviceLabel: string | null = null;
const labelListeners = new Set<() => void>();

export function getOrCreatePeerId(): string {
  if (typeof window === "undefined") return "";
  if (cachedPeerId) return cachedPeerId;

  try {
    const existing = window.sessionStorage.getItem(PEER_ID_KEY);
    if (existing) {
      cachedPeerId = existing;
      return existing;
    }
    const generated = crypto.randomUUID();
    window.sessionStorage.setItem(PEER_ID_KEY, generated);
    cachedPeerId = generated;
    return generated;
  } catch {
    cachedPeerId = crypto.randomUUID();
    return cachedPeerId;
  }
}

export function loadDeviceLabel(): string {
  if (typeof window === "undefined") return "Slate-Node";
  if (cachedDeviceLabel) return cachedDeviceLabel;

  try {
    const stored = window.localStorage.getItem(DEVICE_LABEL_KEY);
    if (stored && stored.trim().length > 0) {
      cachedDeviceLabel = stored.trim();
      return cachedDeviceLabel;
    }
  } catch {
    // Fallback below when storage is restricted.
  }

  const suffix = Math.floor(1000 + Math.random() * 9000);
  return saveDeviceLabel(`Slate-${suffix}`);
}

export function saveDeviceLabel(label: string): string {
  const cleaned = label.trim().slice(0, 32) || "Slate-Node";
  cachedDeviceLabel = cleaned;
  if (typeof window === "undefined") return cleaned;

  try {
    window.localStorage.setItem(DEVICE_LABEL_KEY, cleaned);
  } catch {
    // Ignore storage restriction errors.
  }

  for (const listener of labelListeners) {
    listener();
  }
  return cleaned;
}

export function subscribeDeviceLabel(listener: () => void): () => void {
  labelListeners.add(listener);
  return () => {
    labelListeners.delete(listener);
  };
}
