import { cn } from "@/lib/cn";

export interface ProgressBarProps {
  value?: number;
  max?: number;
  label: string;
  className?: string;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  className,
}: ProgressBarProps) {
  const clamped =
    typeof value === "number"
      ? Math.max(0, Math.min(max, value))
      : undefined;

  return (
    <progress
      value={clamped}
      max={max}
      aria-label={label}
      className={cn("slate-progress block h-1.5 w-full", className)}
    />
  );
}
