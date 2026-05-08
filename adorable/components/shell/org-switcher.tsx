"use client";

import { useState } from "react";
import Link from "next/link";
import type { MeOrganization } from "./me-context";

// Tiny popover that picks an active org. Doc 3 §4.2 says hide the switcher
// for single-org users entirely. We treat the persona-org as a default
// if it's the only one and hide; otherwise the most-recent team-org wins.

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "·";

const pickActive = (orgs: MeOrganization[]): MeOrganization | undefined => {
  const team = orgs.find((o) => o.type === "team");
  return team ?? orgs[0];
};

export function OrgSwitcher({
  organizations,
}: {
  organizations: MeOrganization[];
}) {
  const [open, setOpen] = useState(false);
  // Hide entirely when there's a single org — Doc 3 §4.2.
  if (organizations.length < 2) return null;
  const active = pickActive(organizations);

  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-2 rounded-md border border-border/40 bg-card px-2 py-1 text-sm hover:bg-accent"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex size-6 items-center justify-center rounded bg-muted text-xs font-semibold">
          {active ? initials(active.name) : "?"}
        </span>
        <span className="font-medium">{active?.name ?? "—"}</span>
        <span aria-hidden className="text-muted-foreground">
          ▾
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 w-72 max-h-80 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {organizations.map((org) => (
            <Link
              key={org.id}
              href={
                org.type === "personal"
                  ? `/orgs/${org.slug}/billing`
                  : `/orgs/${org.slug}`
              }
              role="menuitem"
              className={`flex flex-col gap-0.5 rounded px-2 py-1.5 hover:bg-accent ${
                active?.id === org.id ? "bg-accent/60" : ""
              }`}
              onClick={() => setOpen(false)}
            >
              <span className="text-sm font-medium">{org.name}</span>
              <span className="text-xs text-muted-foreground">
                {org.slug} · {org.role}
              </span>
            </Link>
          ))}
          <div className="my-1 h-px bg-border" />
          <Link
            href="/orgs/new"
            role="menuitem"
            className="block rounded px-2 py-1.5 text-sm hover:bg-accent"
            onClick={() => setOpen(false)}
          >
            + Создать организацию
          </Link>
        </div>
      ) : null}
    </div>
  );
}
