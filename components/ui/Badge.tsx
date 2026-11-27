import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "solid" | "active" | "warning" | "danger";

export interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-[#FAFAFA] text-[#0A0A0A] border-[#E5E5E5]",
  solid: "bg-[#0A0A0A] text-white border-[#0A0A0A]",
  active: "bg-white text-[#0A0A0A] border-[#262626]",
  warning: "bg-[#FAFAFA] text-[#78350F] border-[#D4D4D4]",
  danger: "bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]",
};

const DOT_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-[#737373]",
  solid: "bg-white",
  active: "bg-[#0A0A0A]",
  warning: "bg-[#92400E]",
  danger: "bg-[#991B1B]",
};

export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs font-medium tracking-tight whitespace-nowrap",
        TONE_CLASSES[tone],
        className
      )}
    >
      {dot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full shrink-0", DOT_CLASSES[tone])}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
