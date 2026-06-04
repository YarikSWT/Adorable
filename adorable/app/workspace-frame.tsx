"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { RepoWorkspaceShell } from "./[repoId]/repo-workspace-shell";
import { ApiKeySettingsDialog } from "@/components/api-key-gate";
import { MeProvider } from "@/components/shell/me-context";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { MobileTopBar } from "@/components/shell/mobile-top-bar";
import { EmailVerifyBanner } from "@/components/shell/email-verify-banner";
import { QuotaBanner } from "@/components/shell/quota-banner";

type ActiveConversationDetail = {
  repoId: string;
  conversationId: string;
};

// Auth pages get their own minimal layout (login/signup/verify-email/etc.) and
// must NOT inherit the workspace shell. Path is the only signal we have here
// because layouts in route groups still wrap their parent.
const AUTH_PREFIXES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/auth/account-conflict",
  "/auth/oauth-error",
];
const isAuthPath = (path: string): boolean =>
  AUTH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

export function WorkspaceFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isAuthPath(pathname)) {
    return <>{children}</>;
  }
  // usePathname() в Next 13+ возвращает path с сохранёнными percent-encoded
  // сегментами ("%2F" не декодится). Когда мы кладём repoId с slash через
  // encodeURIComponent в URL, split('/') оставляет сегмент с "%2F"; чтобы
  // сравнение с repos.find(r => r.id === repoId) работало (id у repo уже
  // decoded), декодируем каждый сегмент здесь.
  const pathParts = useMemo(
    () =>
      pathname
        .split("/")
        .filter(Boolean)
        .map((segment) => {
          try {
            return decodeURIComponent(segment);
          } catch {
            return segment;
          }
        }),
    [pathname],
  );

  const routeRepoId = pathParts[0] ?? null;
  const routeConversationId = pathParts[1] ?? null;

  const [activeRepoId, setActiveRepoId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const previousPathnameRef = useRef(pathname);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (routeRepoId) {
      setActiveRepoId(routeRepoId);
      setActiveConversationId(routeConversationId);
    }
  }, [routeConversationId, routeRepoId]);

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    if (pathname === "/" && previousPathname !== "/") {
      setActiveRepoId(null);
      setActiveConversationId(null);
    }
    previousPathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const handleActiveConversation = (event: Event) => {
      const customEvent = event as CustomEvent<ActiveConversationDetail>;
      const detail = customEvent.detail;
      if (!detail?.repoId || !detail?.conversationId) {
        return;
      }

      setActiveRepoId(detail.repoId);
      setActiveConversationId(detail.conversationId);
    };

    window.addEventListener(
      "adorable:active-conversation",
      handleActiveConversation as EventListener,
    );

    return () => {
      window.removeEventListener(
        "adorable:active-conversation",
        handleActiveConversation as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    const handleGoHome = () => {
      setActiveRepoId(null);
      setActiveConversationId(null);
    };

    window.addEventListener("adorable:go-home", handleGoHome);
    return () => {
      window.removeEventListener("adorable:go-home", handleGoHome);
    };
  }, []);

  useEffect(() => {
    const handleGoToRepo = (event: Event) => {
      const customEvent = event as CustomEvent<{ repoId: string }>;
      const detail = customEvent.detail;
      if (!detail?.repoId) return;
      setActiveRepoId(detail.repoId);
      setActiveConversationId(null);
    };

    window.addEventListener(
      "adorable:go-to-repo",
      handleGoToRepo as EventListener,
    );
    return () => {
      window.removeEventListener(
        "adorable:go-to-repo",
        handleGoToRepo as EventListener,
      );
    };
  }, []);

  const effectiveRepoId = routeRepoId ?? activeRepoId;
  const effectiveConversationId = routeConversationId ?? activeConversationId;

  // Phase 15 — global shell. MeProvider fetches /api/me once and shares it
  // with Header (logo + org switcher + user menu) and EmailVerifyBanner.
  // Both render to nothing for anonymous users so the existing flows (e.g.
  // first-load API-key gate before sign-in) keep working.
  return (
    <MeProvider>
      <div className="flex h-full overflow-hidden">
        {/* Desktop sidebar (replaces the former top Header) */}
        <div className="hidden h-full shrink-0 md:block">
          <AppSidebar />
        </div>

        {/* Mobile drawer */}
        {mobileDrawerOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              aria-label="Close menu"
              className="absolute inset-0 bg-ink/40"
              onClick={() => setMobileDrawerOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 shadow-[var(--sh-lg)]">
              <AppSidebar onNavigate={() => setMobileDrawerOpen(false)} />
            </div>
          </div>
        )}

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <MobileTopBar onMenu={() => setMobileDrawerOpen(true)} />
          <EmailVerifyBanner />
          <QuotaBanner />
          <div className="min-h-0 flex-1 overflow-hidden">
            <RepoWorkspaceShell
              repoId={effectiveRepoId}
              selectedConversationIdOverride={effectiveConversationId}
            >
              {children}
              {/* Settings button */}
              <div className="fixed bottom-3 left-3 z-50 md:right-3 md:left-auto">
                <ApiKeySettingsDialog />
              </div>
            </RepoWorkspaceShell>
          </div>
        </div>
      </div>
    </MeProvider>
  );
}
