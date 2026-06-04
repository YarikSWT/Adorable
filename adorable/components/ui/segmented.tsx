"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

// Segmented pill toggle (components/buttons-inputs.md). Controlled: pass
// `value` + `onValueChange`. The active segment lifts onto a paper chip.

export type SegmentedOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
};

export function Segmented<T extends string>({
  options,
  value,
  onValueChange,
  className,
  "aria-label": ariaLabel,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex rounded-[var(--r-sm)] bg-cream p-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onValueChange(opt.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-[calc(var(--r-sm)-2px)] px-3 py-1.5 text-[13px] font-medium transition-colors",
              active
                ? "border border-cream-deep bg-paper text-ink shadow-[var(--sh-sm)]"
                : "border border-transparent text-n-500 hover:text-ink",
            )}
          >
            {Icon && <Icon className="size-3.5" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
