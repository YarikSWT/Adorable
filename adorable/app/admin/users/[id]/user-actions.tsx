"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AdminUserActions({
  userId,
  currentEmail,
  currentStatus,
}: {
  userId: string;
  currentEmail: string;
  currentStatus: string;
}) {
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const callJson = async (
    url: string,
    method: "PATCH" | "POST" | "DELETE",
    body?: Record<string, unknown>,
  ): Promise<unknown> => {
    const res = await fetch(url, {
      method,
      headers: body
        ? { "content-type": "application/json" }
        : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
    }
    return res.json().catch(() => ({}));
  };

  const wrap = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setFeedback(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold">Действия</h2>

      <div className="rounded-md border border-border/40 p-3">
        <h3 className="text-sm font-medium">Сменить email</h3>
        <p className="mb-2 text-xs text-muted-foreground">
          Email нормализуется на сервере. Сессии текущего юзера будут
          инвалидированы, email_verified сбросится в false.
        </p>
        <div className="flex items-center gap-2">
          <Input
            type="email"
            placeholder={currentEmail}
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="max-w-sm"
          />
          <Button
            type="button"
            disabled={busy !== null || !newEmail.trim()}
            onClick={() =>
              wrap("email", async () => {
                await callJson(`/api/admin/users/${userId}`, "PATCH", {
                  email: newEmail.trim(),
                });
                setFeedback("Email обновлён");
                setNewEmail("");
              })
            }
          >
            {busy === "email" ? "..." : "Сменить"}
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-border/40 p-3">
        <h3 className="text-sm font-medium">Suspend / Unsuspend</h3>
        <p className="mb-2 text-xs text-muted-foreground">
          Текущий статус: <code>{currentStatus}</code>. Suspended юзеры
          теряют все активные сессии.
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy !== null || currentStatus === "suspended"}
            onClick={() =>
              wrap("suspend", async () => {
                await callJson(
                  `/api/admin/users/${userId}/suspend`,
                  "POST",
                  {},
                );
                setFeedback("Юзер заморожен");
              })
            }
          >
            {busy === "suspend" ? "..." : "Suspend"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy !== null || currentStatus === "active"}
            onClick={() =>
              wrap("unsuspend", async () => {
                await callJson(
                  `/api/admin/users/${userId}/unsuspend`,
                  "POST",
                  {},
                );
                setFeedback("Юзер активирован");
              })
            }
          >
            {busy === "unsuspend" ? "..." : "Unsuspend"}
          </Button>
        </div>
      </div>

      {feedback ? (
        <p role="status" className="text-sm text-emerald-500">
          {feedback}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
