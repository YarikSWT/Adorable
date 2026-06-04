"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { GridIcon, ListIcon, PlusIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/chip";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useRepos } from "@/lib/repos-context";
import type { RepoItem } from "@/lib/repo-types";

function statusOf(repo: RepoItem): "live" | "deploying" | "idle" {
  if (repo.deployments.some((d) => d.state === "live")) return "live";
  if (repo.deployments.some((d) => d.state === "deploying")) return "deploying";
  return "idle";
}

function StatusChip({ status }: { status: "live" | "deploying" | "idle" }) {
  if (status === "live")
    return (
      <Chip variant="success" size="sm" dot>
        Live
      </Chip>
    );
  if (status === "deploying")
    return (
      <Chip variant="warning" size="sm" dot>
        Deploying
      </Chip>
    );
  return (
    <Chip size="sm" dot>
      Idle
    </Chip>
  );
}

// Deterministic warm letter-logo (base44 apps-list uses coloured logo squares).
const LOGO_COLORS = [
  "bg-coral",
  "bg-olive",
  "bg-ink-2",
  "bg-coral-deep",
  "bg-olive-deep",
  "bg-warning",
  "bg-info",
];

function LetterLogo({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const color = LOGO_COLORS[h % LOGO_COLORS.length];
  return (
    <div
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-[var(--r-sm)] text-base font-semibold text-white",
        color,
        className,
      )}
    >
      {name.trim()[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

export default function AppsPage() {
  const { repos, isLoading, onSelectProject } = useRepos();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => r.name.toLowerCase().includes(q));
  }, [repos, query]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-6 py-8 md:px-10">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink [font-variation-settings:'opsz'_144]">
            My <em className="text-coral-deep italic">apps</em>
          </h1>
          <Button asChild>
            <Link href="/">
              <PlusIcon />
              Create new app
            </Link>
          </Button>
        </div>

        {/* Filter row */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="relative max-w-xs flex-1">
            <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-n-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search apps…"
              className="pl-9"
            />
          </div>
          <Segmented
            aria-label="View"
            value={view}
            onValueChange={setView}
            options={[
              { value: "grid", label: "Grid", icon: GridIcon },
              { value: "list", label: "List", icon: ListIcon },
            ]}
          />
        </div>

        {/* Content */}
        <div className="mt-6">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="overflow-hidden rounded-[var(--r-lg)] border border-cream-deep bg-paper"
                >
                  <Skeleton className="aspect-16/9 w-full bg-cream" />
                  <div className="p-4">
                    <Skeleton className="mb-2 h-4 w-2/3 rounded bg-cream" />
                    <Skeleton className="h-3 w-1/3 rounded bg-cream" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState hasQuery={query.trim().length > 0} />
          ) : view === "grid" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((repo) => (
                <button
                  key={repo.id}
                  type="button"
                  onClick={() => onSelectProject(repo.id)}
                  className="group flex flex-col gap-4 rounded-[var(--r-lg)] border border-cream-deep bg-paper p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--sh-md)]"
                >
                  <div className="flex items-start gap-3">
                    <LetterLogo name={repo.name} />
                    <h3 className="flex-1 truncate pt-0.5 text-base font-semibold text-ink">
                      {repo.name}
                    </h3>
                    <StatusChip status={statusOf(repo)} />
                  </div>
                  <div className="flex items-center justify-between font-mono text-[11px] tracking-wide text-n-400 uppercase">
                    <span>By you</span>
                    <span>
                      {repo.deployments.length} deploy
                      {repo.deployments.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col overflow-hidden rounded-[var(--r-lg)] border border-cream-deep bg-paper">
              {filtered.map((repo, i) => (
                <button
                  key={repo.id}
                  type="button"
                  onClick={() => onSelectProject(repo.id)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-cream",
                    i > 0 && "border-t border-cream-deep",
                  )}
                >
                  <LetterLogo name={repo.name} className="size-9 text-sm" />
                  <span className="flex-1 truncate text-sm font-medium text-ink">
                    {repo.name}
                  </span>
                  <span className="font-mono text-[11px] tracking-wide text-n-400 uppercase">
                    {repo.deployments.length} deploy
                    {repo.deployments.length !== 1 ? "s" : ""}
                  </span>
                  <StatusChip status={statusOf(repo)} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--r-lg)] border border-dashed border-cream-deep bg-paper px-6 py-20 text-center">
      <h2 className="font-display text-xl font-medium text-ink">
        {hasQuery ? "No matching apps" : "No apps yet"}
      </h2>
      <p className="mt-1 max-w-sm text-sm text-n-500">
        {hasQuery
          ? "Try a different search."
          : "Describe what you want to build and Adorable will create your first app."}
      </p>
      {!hasQuery && (
        <Button asChild variant="brand" className="mt-5">
          <Link href="/">
            <PlusIcon />
            Create your first app
          </Link>
        </Button>
      )}
    </div>
  );
}
