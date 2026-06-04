import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Sunbaked chips/badges (components/chips-alerts.md). Mono, pill-shaped,
// warm-tinted. Use `dot` for a leading status dot.

const chipVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border font-mono text-[11px] tracking-wide whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-cream-deep bg-cream text-coral-deep",
        olive: "border-transparent bg-olive text-white",
        ink: "border-transparent bg-ink text-cream",
        success:
          "border-success/30 bg-success/10 text-success",
        warning:
          "border-warning/30 bg-warning/10 text-warning",
        danger: "border-danger/30 bg-danger/10 text-danger",
      },
      size: {
        default: "px-2.5 py-1",
        sm: "px-2 py-0.5 text-[10px]",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Chip({
  className,
  variant,
  size,
  dot = false,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof chipVariants> & { dot?: boolean }) {
  return (
    <span
      data-slot="chip"
      className={cn(chipVariants({ variant, size }), className)}
      {...props}
    >
      {dot && (
        <span className="size-1.5 shrink-0 rounded-full bg-current" />
      )}
      {children}
    </span>
  );
}

// Small numeric / dot badge.
function Badge({
  className,
  asDot = false,
  ...props
}: React.ComponentProps<"span"> & { asDot?: boolean }) {
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-coral font-mono text-[10px] font-semibold text-white",
        asDot ? "size-2" : "h-[18px] min-w-[18px] px-1.5",
        className,
      )}
      {...props}
    />
  );
}

export { Chip, Badge, chipVariants };
