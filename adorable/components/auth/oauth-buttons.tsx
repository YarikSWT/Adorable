"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// Three OAuth buttons rendered full-width in a column. Click triggers a POST
// against the matching Better Auth endpoint and follows the URL it returns
// (Better Auth ships the auth-URL in the body or in `Location`, see Phase 5).
//
// Failure mode: the API returns 422 PROVIDER_NOT_FOUND when the upstream env
// vars aren't set. We render the buttons regardless so the layout is stable;
// clicking just surfaces an inline error from the response.

type ProviderId = "google" | "yandex" | "vk";

type ProviderConfig = {
  id: ProviderId;
  label: string;
  endpoint: string;
  body: () => Record<string, unknown>;
};

const PROVIDERS: readonly ProviderConfig[] = [
  {
    id: "google",
    label: "Войти через Google",
    endpoint: "/api/auth/sign-in/social",
    body: () => ({ provider: "google", callbackURL: "/" }),
  },
  {
    id: "yandex",
    label: "Войти через Yandex",
    endpoint: "/api/auth/sign-in/oauth2",
    body: () => ({ providerId: "yandex", callbackURL: "/" }),
  },
  {
    id: "vk",
    label: "Войти через VK",
    endpoint: "/api/auth/sign-in/oauth2",
    body: () => ({ providerId: "vk", callbackURL: "/" }),
  },
];

const startOAuth = async (
  cfg: ProviderConfig,
): Promise<string | { error: string }> => {
  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cfg.body()),
  });
  // Better Auth's social handler sends a Location header (307/200), the
  // generic-oauth handler returns the URL in the body. Try both.
  const location = res.headers.get("location");
  if (location) return location;
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    return { error: "Не удалось обработать ответ провайдера" };
  }
  const obj = parsed as {
    url?: string;
    redirect?: boolean;
    error?: { code?: string; message?: string } | string;
    message?: string;
    code?: string;
  };
  if (typeof obj?.url === "string") return obj.url;
  if (typeof obj?.error === "string") return { error: obj.error };
  if (obj?.error?.message) return { error: obj.error.message };
  if (typeof obj?.message === "string") return { error: obj.message };
  return { error: "OAuth-провайдер недоступен" };
};

export function OAuthButtons() {
  const [busyId, setBusyId] = useState<ProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      {PROVIDERS.map((p) => (
        <Button
          key={p.id}
          type="button"
          variant="outline"
          className="w-full"
          disabled={busyId !== null}
          onClick={async () => {
            setBusyId(p.id);
            setError(null);
            const result = await startOAuth(p);
            if (typeof result === "string") {
              window.location.href = result;
              return; // navigation handles the rest
            }
            setError(result.error);
            setBusyId(null);
          }}
        >
          {busyId === p.id ? "Перенаправляем..." : p.label}
        </Button>
      ))}
      {error ? (
        <p
          role="alert"
          className="text-center text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function OAuthSeparator() {
  return (
    <div className="my-4 flex items-center gap-3 text-xs uppercase text-muted-foreground">
      <div className="h-px flex-1 bg-border" />
      <span>или</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
