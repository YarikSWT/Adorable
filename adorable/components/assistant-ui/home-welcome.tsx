"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useRepos } from "@/lib/repos-context";
import type { RepoItem } from "@/lib/repo-types";
import { type FC, useState } from "react";
import { useComposerRuntime } from "@assistant-ui/react";
import { GithubIcon } from "lucide-react";

function getPreviewUrl(repo: RepoItem): string | null {
  // prefer production domain
  if (repo.productionDomain) {
    return `https://${repo.productionDomain}`;
  }
  // fall back to live deployment url
  const live = repo.deployments.find((d) => d.state === "live");
  if (live?.url) return live.url;
  // fall back to vm preview
  if (repo.vm?.previewUrl) return repo.vm.previewUrl;
  return null;
}

// Category starters — clicking seeds the composer (base44-style suggestion row).
const SUGGESTIONS = [
  "Tasks & Workflows",
  "CRM & Sales",
  "Content & Sites",
  "Finance",
  "Booking",
];

export const HomeWelcome: FC = () => {
  const { repos, isLoading, onSelectProject } = useRepos();
  const composer = useComposerRuntime();
  const [githubDialogOpen, setGithubDialogOpen] = useState(false);
  const [githubRepoInput, setGithubRepoInput] = useState("");
  const [githubRepoError, setGithubRepoError] = useState<string | null>(null);

  const handleUseGithubRepo = () => {
    const githubRepoName = githubRepoInput.trim();
    if (!githubRepoName.includes("/")) {
      setGithubRepoError("Repository must be in owner/repo format");
      return;
    }

    setGithubRepoError(null);
    window.dispatchEvent(
      new CustomEvent("adorable:create-from-github", {
        detail: { githubRepoName },
      }),
    );
    setGithubDialogOpen(false);
    setGithubRepoInput("");
  };

  const seedComposer = (label: string) => {
    try {
      composer.setText(`Build a ${label.toLowerCase()} app: `);
    } catch {
      // composer runtime unavailable — suggestion is a no-op rather than a crash
    }
  };

  const hasProjects = repos.length > 0;
  const showProjects = isLoading || hasProjects;

  return (
    <div className="aui-thread-welcome-root mx-auto flex w-full max-w-(--thread-max-width) grow flex-col items-center justify-center">
      <div className="flex w-full flex-col items-center gap-7 px-2 pt-10">
        {/* Hero */}
        <h1 className="animate-in text-center font-display text-4xl font-medium tracking-tight text-ink duration-500 fill-mode-both fade-in md:text-5xl [font-variation-settings:'opsz'_144]">
          What will you{" "}
          <em className="text-coral-deep italic">build</em>{" "}
          <span className="text-olive italic">next?</span>
        </h1>

        {/* Suggestion pills */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {SUGGESTIONS.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => seedComposer(label)}
              className="rounded-[var(--r-md)] border border-cream-deep bg-paper px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-cream"
            >
              {label}
            </button>
          ))}
        </div>

        {/* Recent apps grid */}
        {showProjects && (
          <div className="mt-2 flex w-full flex-col gap-4">
            <div className="flex items-baseline justify-between">
              <h2 className="font-mono text-xs tracking-wide text-n-500 uppercase">
                Recent apps
              </h2>
            </div>
            {isLoading ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="overflow-hidden rounded-[var(--r-lg)] border border-cream-deep bg-paper"
                  >
                    <Skeleton className="aspect-16/10 w-full bg-cream" />
                    <div className="px-3 py-2.5">
                      <Skeleton className="mb-1.5 h-3.5 w-3/4 rounded bg-cream" />
                      <Skeleton className="h-2.5 w-1/2 rounded bg-cream" />
                    </div>
                  </div>
                ))}
              </div>
            ) : hasProjects ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {repos.map((repo, index) => {
                    const previewUrl = getPreviewUrl(repo);
                    const isLive = repo.deployments.some(
                      (d) => d.state === "live",
                    );
                    const isDeploying = repo.deployments.some(
                      (d) => d.state === "deploying",
                    );
                    return (
                      <button
                        key={repo.id}
                        type="button"
                        onClick={() => onSelectProject(repo.id)}
                        className="group animate-in overflow-hidden rounded-[var(--r-lg)] border border-cream-deep bg-paper text-left transition-all duration-200 fill-mode-both fade-in hover:-translate-y-0.5 hover:shadow-[var(--sh-md)]"
                        style={
                          {
                            "--tw-animation-delay": `${index * 75}ms`,
                            "--tw-animation-duration": "400ms",
                          } as React.CSSProperties
                        }
                      >
                        {/* Preview thumbnail */}
                        <div className="relative aspect-16/10 w-full overflow-hidden bg-gradient-to-br from-cream to-cream-deep">
                          {previewUrl ? (
                            <iframe
                              src={previewUrl}
                              title={`${repo.name} preview`}
                              className="pointer-events-none absolute inset-0 h-[200%] w-[200%] origin-top-left scale-50 border-0"
                              tabIndex={-1}
                              loading="lazy"
                              sandbox="allow-scripts allow-same-origin"
                            />
                          ) : null}
                          {/* Status dot */}
                          <div className="absolute top-2 right-2">
                            <div
                              className={cn(
                                "size-2 rounded-full ring-2 ring-paper/80",
                                isLive
                                  ? "bg-success"
                                  : isDeploying
                                    ? "bg-warning"
                                    : "bg-n-300",
                              )}
                            />
                          </div>
                        </div>
                        {/* Info */}
                        <div className="px-3 py-2.5">
                          <p className="truncate text-sm font-medium text-ink">
                            {repo.name}
                          </p>
                          {repo.deployments.length > 0 ? (
                            <p className="mt-0.5 font-mono text-[11px] tracking-wide text-n-400 uppercase">
                              {repo.deployments.length} deploy
                              {repo.deployments.length !== 1 ? "s" : ""}
                            </p>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {/* Import from GitHub — subtle link below the grid */}
                <button
                  type="button"
                  onClick={() => setGithubDialogOpen(true)}
                  className="mx-auto flex animate-in items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-n-400 transition-colors fill-mode-both fade-in hover:text-ink"
                  style={
                    {
                      "--tw-animation-delay": `${repos.length * 75}ms`,
                      "--tw-animation-duration": "400ms",
                    } as React.CSSProperties
                  }
                >
                  <GithubIcon className="size-3" />
                  Import from GitHub
                </button>
              </>
            ) : null}
          </div>
        )}
      </div>

      <Dialog open={githubDialogOpen} onOpenChange={setGithubDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Use GitHub Repo</DialogTitle>
            <DialogDescription>
              Enter a repository in owner/repo format. If you haven't installed
              the GitHub App yet, install it first.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={githubRepoInput}
              onChange={(event) => {
                setGithubRepoInput(event.target.value);
                setGithubRepoError(null);
              }}
              placeholder="owner/repository"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleUseGithubRepo();
                }
              }}
            />
            {githubRepoError && (
              <p className="text-[13px] text-destructive">{githubRepoError}</p>
            )}
            <a
              href="https://dash.freestyle.sh/"
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Install GitHub App (Dashboard → Git → Sync)
            </a>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setGithubDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleUseGithubRepo}>
              Create Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
