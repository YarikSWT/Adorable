"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ResetError = "mismatch" | "weak" | "invalid_token" | "rate_limit" | "generic";

const ERRORS: Record<ResetError, string> = {
  mismatch: "Пароли не совпадают",
  weak: "Пароль слишком короткий — минимум 8 символов",
  invalid_token:
    "Ссылка не действительна или уже использована. Запросите новую.",
  rate_limit: "Слишком много попыток. Попробуйте через час.",
  generic: "Не удалось обновить пароль. Попробуйте снова.",
};

export function ResetPasswordForm({ token }: { token: string }) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ResetError | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p>Пароль обновлён. Все активные сессии завершены.</p>
        <Link
          href="/login"
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90"
        >
          К входу
        </Link>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pw1 !== pw2) {
          setError("mismatch");
          return;
        }
        if (pw1.length < 8) {
          setError("weak");
          return;
        }
        setBusy(true);
        setError(null);
        try {
          const res = await fetch("/api/auth/reset-password", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token, newPassword: pw1 }),
          });
          if (res.ok) {
            setDone(true);
            return;
          }
          if (res.status === 400 || res.status === 410)
            setError("invalid_token");
          else if (res.status === 422) setError("weak");
          else if (res.status === 429) setError("rate_limit");
          else setError("generic");
        } catch {
          setError("generic");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Новый пароль</span>
        <Input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={pw1}
          onChange={(e) => setPw1(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Повторите пароль</span>
        <Input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {ERRORS[error]}
        </p>
      ) : null}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Сохраняем..." : "Сохранить"}
      </Button>
    </form>
  );
}
