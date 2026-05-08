"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const KNOWN_KINDS = [
  "llm.tokens.monthly",
  "image.generations.monthly",
  "stt.minutes.monthly",
  "tts.chars.monthly",
  "projects.max",
  "members_per_project.max",
];

export function OverrideForm({ orgId }: { orgId: string }) {
  const [kind, setKind] = useState(KNOWN_KINDS[0]);
  const [limit, setLimit] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="rounded-md border border-border/40 p-3">
      <h3 className="mb-2 text-sm font-medium">Добавить override</h3>
      <form
        className="flex flex-col gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          setFeedback(null);
          try {
            const numericLimit = Number(limit);
            if (!Number.isFinite(numericLimit) || numericLimit < 0) {
              throw new Error("Лимит должен быть >= 0");
            }
            const res = await fetch(
              `/api/admin/orgs/${orgId}/plan-overrides`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  limits: { [kind]: numericLimit },
                  reason: reason.trim() || undefined,
                  expiresAt: expiresAt || null,
                }),
              },
            );
            if (!res.ok) {
              const err = (await res.json().catch(() => null)) as
                | { error?: { message?: string } }
                | null;
              throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
            }
            setFeedback("Override создан — обновите страницу");
            setLimit("");
            setReason("");
            setExpiresAt("");
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Ресурс</span>
          <select
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {KNOWN_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Новый лимит</span>
          <Input
            type="number"
            min={0}
            required
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Причина</span>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Поддержка / промо / прочее"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Истекает</span>
          <Input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {feedback ? (
          <p role="status" className="text-sm text-emerald-500">
            {feedback}
          </p>
        ) : null}
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? "..." : "Создать override"}
          </Button>
        </div>
      </form>
    </section>
  );
}
