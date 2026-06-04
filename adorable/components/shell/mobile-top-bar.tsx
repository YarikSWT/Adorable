"use client";

import Link from "next/link";
import { BellIcon, MenuIcon } from "lucide-react";
import { useMe } from "./me-context";

// Mobile-only top bar (< md). The persistent sidebar collapses into a drawer
// opened by the hamburger; logo + wordmark sit centered, with a bell and a
// workspace-initials pill on the right (the pill also opens the drawer, since
// the user menu lives inside it).

const orgInitials = (name: string | undefined): string => {
  const src = (name ?? "").trim();
  if (!src) return "·";
  return (
    src
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "·"
  );
};

export function MobileTopBar({ onMenu }: { onMenu: () => void }) {
  const { me } = useMe();
  const activeOrg =
    me?.organizations.find((o) => o.type === "team") ?? me?.organizations[0];

  return (
    <header className="grid h-12 shrink-0 grid-cols-[36px_1fr_auto] items-center gap-2 px-3 md:hidden">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open menu"
        className="flex size-9 items-center justify-center rounded-[var(--r-md)] text-ink hover:bg-cream"
      >
        <MenuIcon className="size-5" />
      </button>
      <Link href="/" className="flex items-center justify-center gap-2">
        <svg width="22" height="18" viewBox="0 0 28 22" fill="none" className="text-coral" aria-hidden>
          <line x1="6" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="4" y1="7" x2="24" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M3 21 A11 11 0 0 1 25 21 Z" fill="currentColor" />
        </svg>
        <span className="text-lg font-bold tracking-tight text-ink">
          Adorable
        </span>
      </Link>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Notifications"
          className="relative flex size-9 items-center justify-center rounded-[var(--r-md)] text-ink hover:bg-cream"
        >
          <BellIcon className="size-[18px]" />
          <span className="absolute top-2 right-2 size-1.5 rounded-full bg-coral" />
        </button>
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open menu"
          className="flex size-9 items-center justify-center rounded-[var(--r-md)] bg-cream-deep text-xs font-semibold text-olive-deep"
        >
          {orgInitials(activeOrg?.name)}
        </button>
      </div>
    </header>
  );
}
