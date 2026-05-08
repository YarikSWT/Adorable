"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "./me-context";
import { Button } from "@/components/ui/button";

const DISMISS_KEY_PREFIX = "adorable.shell.quota-banner-dismissed-at:";
const DISMISS_RETURN_MS = 24 * 60 * 60 * 1000;
const WARN_THRESHOLD = 0.8;

const isDismissed = (orgId: string): boolean => {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(DISMISS_KEY_PREFIX + orgId);
  if (!raw) return false;
  const then = Number(raw);
  if (!Number.isFinite(then)) return false;
  return Date.now() - then < DISMISS_RETURN_MS;
};

type Usage = {
  limits: Record<string, number>;
  used: Record<string, number>;
};

const findHotResource = (
  usage: Usage,
): { kind: string; pct: number } | null => {
  let worst: { kind: string; pct: number } | null = null;
  for (const [k, limit] of Object.entries(usage.limits ?? {})) {
    if (typeof limit !== "number" || limit <= 0) continue;
    const used = usage.used?.[k] ?? 0;
    const pct = used / limit;
    if (pct >= WARN_THRESHOLD && (!worst || pct > worst.pct)) {
      worst = { kind: k, pct };
    }
  }
  return worst;
};

// Doc 3 §8.2: only render the banner on home/workspace surfaces. We treat
// "home or workspace pages" = anything that doesn't already have a
// dedicated billing/settings view. Listing the exclusions is more
// maintainable than enumerating positives.
const SUPPRESS_PREFIXES = [
  "/orgs/",
  "/settings/",
  "/admin",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/auth/",
  "/projects/", // settings sub-pages already surface limits inline
];

export function QuotaBanner() {
  const pathname = usePathname();
  const { me } = useMe();
  const [hot, setHot] = useState<{
    kind: string;
    pct: number;
    orgId: string;
    orgSlug: string;
  } | null>(null);

  useEffect(() => {
    if (!me) {
      setHot(null);
      return;
    }
    const personal = me.organizations.find((o) => o.type === "personal");
    if (!personal) {
      setHot(null);
      return;
    }
    if (isDismissed(personal.id)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/orgs/${personal.id}/usage`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as Usage;
        const w = findHotResource(data);
        if (!cancelled && w) {
          setHot({ ...w, orgId: personal.id, orgSlug: personal.slug });
        }
      } catch {
        // Stay silent on errors — failing closed (no banner) is preferable
        // to a broken-banner UX.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me]);

  if (!hot) return null;
  if (SUPPRESS_PREFIXES.some((p) => pathname?.startsWith(p))) return null;

  const handleDismiss = () => {
    window.localStorage.setItem(
      DISMISS_KEY_PREFIX + hot.orgId,
      String(Date.now()),
    );
    setHot(null);
  };

  return (
    <div
      role="status"
      className="flex w-full flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-100"
    >
      <span>
        Вы используете {Math.round(hot.pct * 100)}% лимита{" "}
        <code className="font-mono text-xs">{hot.kind}</code> на этот месяц.
      </span>
      <div className="flex items-center gap-2">
        <Link
          href={`/orgs/${hot.orgSlug}/billing`}
          className="text-xs underline"
        >
          Подробнее
        </Link>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label="Скрыть на сутки"
          onClick={handleDismiss}
        >
          ✕
        </Button>
      </div>
    </div>
  );
}
