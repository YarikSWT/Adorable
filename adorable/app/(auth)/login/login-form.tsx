"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Sign-in form. Talks straight to Better Auth's /api/auth/sign-in/email — we
// don't go through our own protectedRoute wrapper because the wrapper requires
// an existing session and this is the entry point to *getting* one.
//
// Error mapping per Doc 3 §3.2: invalid creds, suspended, rate-limited get
// short Russian messages without leaking which field was wrong.

type LoginErrorReason =
  | "invalid"
  | "suspended"
  | "rate_limit"
  | "unknown";

const ERRORS: Record<LoginErrorReason, string> = {
  invalid: "Неверный email или пароль",
  suspended: "Аккаунт временно недоступен. Свяжитесь с поддержкой",
  rate_limit: "Слишком много попыток входа. Попробуйте через минуту",
  unknown: "Не удалось войти. Попробуйте ещё раз",
};

const classifyError = (status: number): LoginErrorReason => {
  if (status === 401 || status === 400 || status === 403) return "invalid";
  if (status === 423) return "suspended";
  if (status === 429) return "rate_limit";
  return "unknown";
};

export function LoginForm({
  from,
  prefilledEmail,
}: {
  from: string;
  prefilledEmail?: string;
}) {
  const [email, setEmail] = useState(prefilledEmail ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<LoginErrorReason | null>(null);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const res = await fetch("/api/auth/sign-in/email", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, password }),
          });
          if (!res.ok) {
            setError(classifyError(res.status));
            setPassword("");
            return;
          }
          window.location.href = from;
        } catch {
          setError("unknown");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Email</span>
        <Input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Пароль</span>
        <Input
          type="password"
          required
          minLength={8}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Link
          href="/forgot-password"
          className="self-end text-xs text-muted-foreground hover:text-foreground"
        >
          Забыли пароль?
        </Link>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {ERRORS[error]}
        </p>
      ) : null}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Входим..." : "Войти"}
      </Button>
    </form>
  );
}
