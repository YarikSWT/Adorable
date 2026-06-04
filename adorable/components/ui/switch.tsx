"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

// Lightweight controlled switch (no Radix dependency). Coral when on.

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-coral/30 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-coral" : "bg-n-200",
        className,
      )}
    >
      <span
        className={cn(
          "pointer-events-none absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-[var(--sh-sm)] transition-transform",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}
