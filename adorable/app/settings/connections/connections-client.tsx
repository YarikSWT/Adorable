"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const PROVIDERS = [
  { id: "google", label: "Google", endpoint: "/api/auth/sign-in/social", body: { provider: "google", callbackURL: "/settings/connections" } },
  { id: "yandex", label: "Yandex", endpoint: "/api/auth/sign-in/oauth2", body: { providerId: "yandex", callbackURL: "/settings/connections" } },
  { id: "vk",     label: "VK",     endpoint: "/api/auth/sign-in/oauth2", body: { providerId: "vk", callbackURL: "/settings/connections" } },
] as const;

export function ConnectionsClient({
  linkedProviders,
  hasPassword,
}: {
  linkedProviders: string[];
  hasPassword: boolean;
}) {
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const linked = new Set(linkedProviders);
  // Count "auth methods" the user has — a provider unlink should be blocked
  // if it would leave the user without any way to sign back in.
  const oauthMethods = linkedProviders.filter((p) => p !== "credential");
  const totalMethods = oauthMethods.length + (hasPassword ? 1 : 0);

  const startLink = async (
    cfg: (typeof PROVIDERS)[number],
  ): Promise<void> => {
    setBusyProvider(cfg.id);
    setError(null);
    try {
      const res = await fetch(cfg.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cfg.body),
      });
      const location = res.headers.get("location");
      if (location) {
        window.location.href = location;
        return;
      }
      const data = (await res.json().catch(() => null)) as
        | { url?: string; error?: { message?: string } | string }
        | null;
      if (data && typeof data.url === "string") {
        window.location.href = data.url;
        return;
      }
      const errMsg =
        typeof data?.error === "string"
          ? data.error
          : data?.error?.message ?? "OAuth-провайдер недоступен";
      setError(errMsg);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyProvider(null);
    }
  };

  const unlink = async (providerId: string): Promise<void> => {
    if (totalMethods <= 1) return;
    if (!window.confirm(`Отвязать ${providerId}?`)) return;
    setBusyProvider(providerId);
    setError(null);
    try {
      const res = await fetch("/api/auth/unlink-account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: { message?: string } | string }
          | null;
        const msg =
          typeof data?.error === "string"
            ? data.error
            : data?.error?.message ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyProvider(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {PROVIDERS.map((p) => {
        const isLinked = linked.has(p.id);
        const lastMethod = isLinked && totalMethods <= 1;
        return (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-md border border-border/40 px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className={
                  "inline-block size-2.5 rounded-full " +
                  (isLinked ? "bg-emerald-500" : "bg-muted-foreground/40")
                }
              />
              <div>
                <div className="text-sm font-medium">{p.label}</div>
                <div className="text-xs text-muted-foreground">
                  {isLinked ? "Привязан" : "Не привязан"}
                </div>
              </div>
            </div>
            {isLinked ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busyProvider === p.id || lastMethod}
                title={
                  lastMethod
                    ? "Это единственный способ войти в аккаунт — задайте пароль или привяжите другого провайдера сначала."
                    : undefined
                }
                onClick={() => unlink(p.id)}
              >
                {lastMethod ? "Нельзя отвязать" : "Отвязать"}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={busyProvider === p.id}
                onClick={() => startLink(p)}
              >
                {busyProvider === p.id ? "..." : "Привязать"}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
