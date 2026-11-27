"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-[#0A0A0A] text-white border border-[#0A0A0A] hover:bg-[#262626] active:bg-[#0A0A0A]",
  secondary:
    "bg-white text-[#0A0A0A] border border-[#E5E5E5] hover:border-[#0A0A0A] hover:bg-[#FAFAFA]",
  ghost:
    "bg-transparent text-[#0A0A0A] border border-transparent hover:bg-[#F5F5F5]",
  danger:
    "bg-white text-[#991B1B] border border-[#E5E5E5] hover:border-[#991B1B] hover:bg-[#FEF2F2]",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "min-h-8 px-2.5 py-1 text-xs gap-1.5",
  md: "min-h-9 px-3.5 py-1.5 text-sm gap-2",
  icon: "min-h-8 min-w-8 p-1.5",
};

export function Button({
  variant = "secondary",
  size = "md",
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-sm font-medium tracking-tight transition-colors duration-150 cursor-pointer disabled:opacity-45 disabled:pointer-events-none select-none",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
