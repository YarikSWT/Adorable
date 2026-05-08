"use client";

import Link from "next/link";
import { useMe } from "./me-context";
import { OrgSwitcher } from "./org-switcher";
import { UserMenu } from "./user-menu";

// Doc 3 §4.1 — global header for all authenticated pages.
// Logo (left) → OrgSwitcher (only ≥2 orgs) → spacer → UserMenu (right).
//
// While /api/me is still loading we render a skeleton with the same height
// so the page below doesn't reflow on hydration. Anonymous (me === null)
// renders nothing — those pages are either auth-flow pages (handled by
// their own layout) or pre-login marketing surfaces.

export function Header() {
  const { me } = useMe();
  if (me === null) return null;

  return (
    <header
      data-testid="adorable-shell-header"
      className="flex h-12 w-full items-center gap-3 border-b border-border/40 bg-card px-4"
    >
      <Link
        href="/"
        className="text-base font-semibold tracking-tight text-foreground"
      >
        Adorable
      </Link>
      {me === undefined ? (
        <div className="h-6 w-24 animate-pulse rounded bg-muted" />
      ) : (
        <OrgSwitcher organizations={me.organizations} />
      )}
      <div className="flex-1" />
      {me === undefined ? (
        <div className="size-8 animate-pulse rounded-full bg-muted" />
      ) : (
        <UserMenu me={me} />
      )}
    </header>
  );
}
