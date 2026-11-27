"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";

export interface CopyButtonProps {
  text: string;
  ariaLabel: string;
  label?: string;
  variant?: "default" | "ghost";
  className?: string;
  size?: "sm" | "md";
}

function legacyCopyText(value: string): boolean {
  const previousFocus = document.activeElement as HTMLElement | null;
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;inset-block-start:0;opacity:0";
  document.body.append(field);
  field.select();
  try {
    return document.execCommand("copy");
  } finally {
    field.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}

let lastAnnouncedMessage = "";

export function CopyButton({
  text,
  ariaLabel,
  label,
  variant = "default",
  className,
  size = "sm",
}: CopyButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [liveMessage, setLiveMessage] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const announce = useCallback((ok: boolean) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus(ok ? "copied" : "failed");

    let nextMsg = ok ? "Copied" : "Copy failed";
    if (nextMsg === lastAnnouncedMessage) {
      nextMsg += "\u00A0";
    }
    lastAnnouncedMessage = nextMsg;
    setLiveMessage(nextMsg);

    timerRef.current = setTimeout(() => {
      setStatus("idle");
      setLiveMessage("");
    }, 2000);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        announce(true);
        return;
      }
      announce(legacyCopyText(text));
    } catch {
      announce(legacyCopyText(text));
    }
  }, [announce, text]);

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => void handleCopy()}
        aria-label={label ? undefined : ariaLabel}
        data-copied={status === "copied" ? "" : undefined}
        data-failed={status === "failed" ? "" : undefined}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-sm transition-colors duration-150 cursor-pointer select-none",
          size === "sm" ? "min-h-7 min-w-7 px-2 text-xs" : "min-h-8 min-w-8 px-2.5 text-xs",
          status === "copied"
            ? "border border-[#0A0A0A] bg-[#0A0A0A] text-white hover:border-[#0A0A0A] hover:bg-[#262626]"
            : status === "failed"
              ? "border border-[#991B1B] bg-white text-[#991B1B] hover:bg-[#FEF2F2]"
              : variant === "ghost"
                ? "border border-transparent bg-transparent text-[#0A0A0A] hover:bg-white"
                : "border border-[#E5E5E5] bg-white text-[#0A0A0A] hover:border-[#0A0A0A] hover:bg-[#FAFAFA]",
          className
        )}
      >
        {status === "copied" ? (
          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : status === "failed" ? (
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        {label && (
          <span>
            {status === "copied" ? "Copied" : status === "failed" ? "Failed" : label}
          </span>
        )}
      </button>
      <span
        role="status"
        className="sr-only"
      >
        {liveMessage}
      </span>
    </span>
  );
}
