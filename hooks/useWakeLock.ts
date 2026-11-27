"use client";

import { useEffect, useRef, useState } from "react";

export function useWakeLock(isActive: boolean): boolean {
  const [locked, setLocked] = useState(false);
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    let cancelled = false;

    const releaseLock = async (): Promise<void> => {
      const current = sentinelRef.current;
      sentinelRef.current = null;
      if (current && !current.released) {
        try {
          await current.release();
        } catch {
          // Ignore release failures when tab is closing or hidden.
        }
      }
      if (!cancelled) setLocked(false);
    };

    const requestLock = async (): Promise<void> => {
      if (
        !isActive ||
        typeof navigator === "undefined" ||
        !("wakeLock" in navigator) ||
        document.visibilityState !== "visible"
      ) {
        return;
      }

      if (sentinelRef.current && !sentinelRef.current.released) return;

      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        setLocked(true);
        sentinel.addEventListener("release", () => {
          if (!cancelled) setLocked(false);
        });
      } catch {
        if (!cancelled) setLocked(false);
      }
    };

    const handleVisibility = (): void => {
      if (document.visibilityState === "visible" && isActive) {
        void requestLock();
      }
    };

    if (isActive) {
      void requestLock();
      document.addEventListener("visibilitychange", handleVisibility);
    } else {
      void releaseLock();
    }

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      void releaseLock();
    };
  }, [isActive]);

  return locked;
}
