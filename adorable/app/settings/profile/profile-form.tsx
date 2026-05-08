"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initials = (raw: string): string =>
  raw
    .trim()
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "·";

export function ProfileForm({
  initialName,
  email,
}: {
  initialName: string;
  email: string;
}) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const dirty = name !== initialName;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setFeedback(null);
        try {
          const res = await fetch("/api/me", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name }),
          });
          if (res.ok) {
            setFeedback("Сохранено");
          } else {
            const err = (await res.json().catch(() => null)) as
              | { error?: { message?: string } }
              | null;
            setFeedback(err?.error?.message ?? "Не удалось сохранить");
          }
        } catch {
          setFeedback("Сетевая ошибка");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex items-center gap-3">
        <div className="flex size-14 items-center justify-center rounded-full bg-muted text-lg font-semibold">
          {initials(name || email)}
        </div>
        <div className="text-xs text-muted-foreground">
          В этой версии аватар отображается инициалами.
        </div>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Имя</span>
        <Input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Email</span>
        <Input value={email} disabled readOnly />
        <span className="text-xs text-muted-foreground">
          Email можно изменить только через поддержку.
        </span>
      </label>
      {feedback ? (
        <p
          role="status"
          className={
            "text-sm " +
            (feedback === "Сохранено"
              ? "text-emerald-500"
              : "text-destructive")
          }
        >
          {feedback}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={!dirty || busy}>
          {busy ? "Сохраняем..." : "Сохранить"}
        </Button>
      </div>
    </form>
  );
}
