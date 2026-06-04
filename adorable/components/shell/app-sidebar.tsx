"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BellIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  GemIcon,
  HomeIcon,
  LayoutTemplateIcon,
  PanelLeftIcon,
  PlugIcon,
  SearchIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMe, type Me, type MeOrganization } from "./me-context";

// ---------------------------------------------------------------------------
// Sunbaked sidebar (Phase 1). Re-homes the fork's real navigation — previously
// in the top Header — into a base44-style left rail: logo, workspace switcher
// (org), nav, live Recents (projects), upgrade card, user strip. base44-only
// destinations (Templates / Integrations / Community) that the fork has no
// route for are shown as disabled "Soon" items for visual parity.
// ---------------------------------------------------------------------------

const initials = (name: string | null | undefined, fallback = "·"): string => {
  const src = (name ?? "").trim();
  if (!src) return fallback;
  return (
    src
      .split(/\s+|@/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || fallback
  );
};

const pickActiveOrg = (
  orgs: MeOrganization[],
): MeOrganization | undefined => {
  const team = orgs.find((o) => o.type === "team");
  return team ?? orgs[0];
};

const personalOrgSlug = (me: Me): string | null =>
  me.organizations.find((o) => o.type === "personal")?.slug ?? null;

// Close a popover when clicking anywhere outside the given ref.
function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  onOutside: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [ref, onOutside, active]);
}

// === Logo mark — generic sunset motif (not a base44 copy), tinted coral. =====
function LogoMark() {
  return (
    <svg
      width="28"
      height="22"
      viewBox="0 0 28 22"
      fill="none"
      className="text-coral"
      aria-hidden
    >
      <line
        x1="6"
        y1="3"
        x2="22"
        y2="3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="4"
        y1="7"
        x2="24"
        y2="7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M3 21 A11 11 0 0 1 25 21 Z" fill="currentColor" />
    </svg>
  );
}

// === Workspace switcher (org) ================================================
function WorkspaceSwitcher({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);

  const active = pickActiveOrg(me.organizations);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-full items-center gap-2 rounded-[var(--r-lg)] border border-cream-deep bg-paper px-2.5 transition-colors hover:bg-cream"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-cream-deep text-[11px] font-semibold text-olive-deep">
          {initials(active?.name)}
        </span>
        <span className="flex-1 truncate text-left text-sm font-medium text-ink">
          {active?.name ?? "Workspace"}
        </span>
        <ChevronsUpDownIcon className="size-3.5 shrink-0 text-n-400" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-50 mt-1 max-h-80 w-full overflow-auto rounded-[var(--r-md)] border border-cream-deep bg-paper p-1 shadow-[var(--sh-lg)]"
        >
          {me.organizations.map((org) => (
            <Link
              key={org.id}
              href={
                org.type === "personal"
                  ? `/orgs/${org.slug}/billing`
                  : `/orgs/${org.slug}`
              }
              role="menuitem"
              onClick={() => setOpen(false)}
              className={cn(
                "flex flex-col gap-0.5 rounded-md px-2 py-1.5 hover:bg-cream",
                active?.id === org.id && "bg-cream",
              )}
            >
              <span className="text-sm font-medium text-ink">{org.name}</span>
              <span className="text-xs text-n-400">
                {org.slug} · {org.role}
              </span>
            </Link>
          ))}
          <div className="my-1 h-px bg-cream-deep" />
          <Link
            href="/orgs/new"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded-md px-2 py-1.5 text-sm text-ink hover:bg-cream"
          >
            + Создать организацию
          </Link>
        </div>
      )}
    </div>
  );
}

// === Nav ====================================================================
function NavItem({
  href,
  icon: Icon,
  label,
  active,
  trailingChevron,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  trailingChevron?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex items-center gap-3 rounded-[var(--r-md)] px-3 py-2 text-sm text-ink transition-colors hover:bg-cream",
        active && "bg-cream font-medium",
      )}
    >
      {active && (
        <span className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-full bg-coral" />
      )}
      <Icon className="size-4 shrink-0" />
      <span className="flex-1">{label}</span>
      {trailingChevron && <ChevronRightIcon className="size-3.5 text-n-400" />}
    </Link>
  );
}

function NavItemDisabled({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <span
      aria-disabled
      title="Coming soon"
      className="flex cursor-not-allowed items-center gap-3 rounded-[var(--r-md)] px-3 py-2 text-sm text-n-400"
    >
      <Icon className="size-4 shrink-0" />
      <span className="flex-1">{label}</span>
      <span className="rounded-full bg-cream px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-n-400 uppercase">
        Soon
      </span>
    </span>
  );
}

// === Recents (live projects) ================================================
type RecentRepo = { id: string; name: string; firstConvId: string | null };

function useRecentRepos(enabled: boolean) {
  const [repos, setRepos] = useState<RecentRepo[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/repos", { cache: "no-store" });
      if (!res.ok) {
        // Resolve to empty rather than leaving the skeletons up forever.
        setRepos([]);
        return;
      }
      const data = await res.json();
      const list: RecentRepo[] = Array.isArray(data.repositories)
        ? data.repositories.map(
            (r: {
              id: string;
              name?: string;
              metadata?: {
                conversations?: { id: string; updatedAt?: string }[];
              };
            }) => ({
              id: r.id,
              name: r.name ?? "Untitled",
              firstConvId: r.metadata?.conversations?.[0]?.id ?? null,
            }),
          )
        : [];
      setRepos(list);
    } catch {
      // best-effort — sidebar Recents is non-critical chrome
      setRepos([]);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
    const onUpdate = () => void load();
    window.addEventListener("adorable:repos-updated", onUpdate);
    return () => window.removeEventListener("adorable:repos-updated", onUpdate);
  }, [enabled, load]);

  return repos;
}

function SidebarSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 pt-3 pb-1.5 text-xs font-medium text-n-500"
      >
        {title}
        <ChevronDownIcon
          className={cn(
            "ml-auto size-3.5 text-n-400 transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>
      {open && children}
    </div>
  );
}

function Recents({ repos }: { repos: RecentRepo[] | null }) {
  if (repos !== null && repos.length === 0) return null;
  return (
    <SidebarSection title="Recents">
      <div className="flex flex-col gap-0.5 px-1.5">
        {repos === null
          ? [0, 1, 2].map((i) => (
              <div
                key={i}
                className="mx-1.5 my-1 h-3.5 animate-pulse rounded bg-cream"
                style={{ width: `${70 - i * 12}%` }}
              />
            ))
          : repos.slice(0, 4).map((r) => (
              <Link
                key={r.id}
                href={
                  r.firstConvId
                    ? `/${encodeURIComponent(r.id)}/${encodeURIComponent(r.firstConvId)}`
                    : `/${encodeURIComponent(r.id)}`
                }
                className="truncate rounded px-2 py-1.5 text-sm text-ink hover:bg-cream"
              >
                {r.name}
              </Link>
            ))}
        <Link
          href="/"
          className="px-2 pt-1 text-[13px] text-n-500 underline underline-offset-[3px] hover:text-ink"
        >
          View all
        </Link>
      </div>
    </SidebarSection>
  );
}

// === User strip (bottom) =====================================================
async function signOut() {
  try {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  } finally {
    window.location.href = "/login";
  }
}

function UserStrip({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  const personalSlug = personalOrgSlug(me);

  const menuItem =
    "block rounded-md px-2 py-1.5 text-sm text-ink hover:bg-cream";
  const divider = "my-1 h-px bg-cream-deep";

  return (
    <div className="flex items-center gap-1 px-0.5 py-1">
      <div ref={ref} className="relative mr-auto">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Меню пользователя"
          className="flex size-8 items-center justify-center overflow-hidden rounded-full bg-cream-deep text-xs font-semibold text-olive-deep transition-colors hover:bg-cream"
        >
          {me.user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={me.user.avatarUrl}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            initials(me.user.name ?? me.user.email)
          )}
        </button>
        {open && (
          <div
            role="menu"
            className="absolute bottom-full left-0 z-50 mb-1 w-60 rounded-[var(--r-md)] border border-cream-deep bg-paper p-1 shadow-[var(--sh-lg)]"
          >
            <div className="px-2 py-1.5">
              <div className="truncate text-sm font-medium text-ink">
                {me.user.name ?? me.user.email.split("@")[0]}
              </div>
              <div className="truncate text-xs text-n-400">
                {me.user.email}
              </div>
            </div>
            <div className={divider} />
            <Link href="/settings/profile" className={menuItem} onClick={() => setOpen(false)}>
              Профиль
            </Link>
            <Link href="/settings/security" className={menuItem} onClick={() => setOpen(false)}>
              Безопасность
            </Link>
            <Link href="/settings/connections" className={menuItem} onClick={() => setOpen(false)}>
              Подключения
            </Link>
            {personalSlug && (
              <>
                <div className={divider} />
                <Link
                  href={`/orgs/${personalSlug}/billing`}
                  className={menuItem}
                  onClick={() => setOpen(false)}
                >
                  Биллинг
                </Link>
              </>
            )}
            {me.user.isAdmin && (
              <>
                <div className={divider} />
                <Link href="/admin" className={menuItem} onClick={() => setOpen(false)}>
                  Админка
                </Link>
              </>
            )}
            <div className={divider} />
            <button
              type="button"
              className={cn(menuItem, "w-full text-left")}
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
            >
              Выйти
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        title="Notifications"
        className="relative flex size-[30px] items-center justify-center rounded-[var(--r-md)] text-n-500 transition-colors hover:bg-cream"
      >
        <BellIcon className="size-4" />
        <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-coral" />
      </button>
    </div>
  );
}

// === Full sidebar ===========================================================
export function AppSidebar({
  className,
  onNavigate,
}: {
  className?: string;
  /** Called on any nav click — used by the mobile drawer to close itself. */
  onNavigate?: () => void;
}) {
  const { me } = useMe();
  const pathname = usePathname();
  const repos = useRecentRepos(me != null);

  const isHome = pathname === "/";
  const isSettings = pathname.startsWith("/settings");

  return (
    <aside
      className={cn(
        "flex h-full w-[250px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-cream-deep bg-n-100 p-3",
        className,
      )}
      onClick={(e) => {
        // close the mobile drawer when a link inside is followed
        if (onNavigate && (e.target as HTMLElement).closest("a")) onNavigate();
      }}
    >
      {/* Header: logo + utility icons */}
      <div className="flex items-center px-2 pt-1 pb-1">
        <Link href="/" className="mr-auto flex items-center" aria-label="Home">
          <LogoMark />
        </Link>
        <button
          type="button"
          title="Search"
          className="flex size-8 items-center justify-center rounded-[var(--r-md)] text-ink hover:bg-cream"
        >
          <SearchIcon className="size-[18px]" />
        </button>
        <button
          type="button"
          title="Toggle sidebar"
          className="flex size-8 items-center justify-center rounded-[var(--r-md)] text-ink hover:bg-cream"
        >
          <PanelLeftIcon className="size-[18px]" />
        </button>
      </div>

      {/* Workspace switcher */}
      {me ? (
        <WorkspaceSwitcher me={me} />
      ) : (
        <div className="h-11 w-full animate-pulse rounded-[var(--r-lg)] bg-cream" />
      )}

      {/* Primary nav */}
      <nav className="flex flex-col gap-0.5">
        <NavItem href="/" icon={HomeIcon} label="Home" active={isHome} />
        <NavItemDisabled icon={LayoutTemplateIcon} label="Templates" />
        <NavItemDisabled icon={PlugIcon} label="Integrations" />
        <NavItemDisabled icon={UsersIcon} label="Community" />
        <NavItem
          href="/settings/profile"
          icon={SettingsIcon}
          label="Settings"
          active={isSettings}
        />
      </nav>

      {/* Recents */}
      <Recents repos={repos} />

      {/* Upgrade card — pinned to bottom */}
      <Link
        href={me ? `/orgs/${personalOrgSlug(me) ?? ""}/billing` : "/"}
        className="mt-auto flex items-center gap-2.5 rounded-[var(--r-md)] border border-cream-deep bg-cream p-3 transition-colors hover:bg-cream-deep"
      >
        <div className="flex-1">
          <div className="text-[13px] leading-tight font-semibold text-ink">
            Upgrade your plan
          </div>
          <div className="mt-0.5 text-[11px] text-n-400">
            Get more out of your apps
          </div>
        </div>
        <GemIcon className="size-4 shrink-0 text-coral" />
      </Link>

      {/* User strip */}
      {me ? (
        <UserStrip me={me} />
      ) : (
        <div className="flex items-center px-0.5 py-1">
          <div className="size-8 animate-pulse rounded-full bg-cream" />
        </div>
      )}
    </aside>
  );
}
