"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Sign-up form. Per Doc 3 §3.3 we collapse 409-conflict into the same generic
// message as other failures so a probe of "is this email registered" leaks
// nothing. No referral-code field — Doc 2 правка 4.

type SignupErrorReason =
  | "weak"
  | "rate_limit"
  | "tos_required"
  | "generic";

const ERRORS: Record<SignupErrorReason, string> = {
  weak: "Пароль слишком короткий — минимум 8 символов",
  rate_limit: "Слишком много попыток. Попробуйте через час",
  tos_required: "Подтвердите согласие с условиями",
  generic:
    "Не удалось зарегистрироваться. Возможно, у вас уже есть аккаунт — попробуйте войти",
};

const passwordStrength = (
  pw: string,
): "short" | "ok" | "strong" | "" => {
  if (pw.length === 0) return "";
  if (pw.length < 8) return "short";
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(pw),
  ).length;
  return classes >= 3 && pw.length >= 12 ? "strong" : "ok";
};

export function SignupForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SignupErrorReason | null>(null);
  const strength = passwordStrength(password);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!tosAccepted) {
          setError("tos_required");
          return;
        }
        setBusy(true);
        setError(null);
        try {
          const res = await fetch("/api/auth/sign-up/email", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, email, password }),
          });
          if (res.ok) {
            // Bootstrap hook (Phase 4) creates the persona-org during this
            // call already, so by the time we redirect the verification flow
            // can show "we sent you mail at <email>".
            window.location.href = `/verify-email?pending=true&email=${encodeURIComponent(
              email,
            )}`;
            return;
          }
          if (res.status === 422) setError("weak");
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
        <span className="font-medium">Имя</span>
        <Input
          required
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
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
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {strength ? (
          <span
            className={
              "text-xs " +
              (strength === "short"
                ? "text-destructive"
                : strength === "strong"
                  ? "text-emerald-500"
                  : "text-muted-foreground")
            }
          >
            {strength === "short"
              ? "Короткий"
              : strength === "strong"
                ? "Сильный"
                : "Нормальный"}
          </span>
        ) : null}
      </label>
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={tosAccepted}
          onChange={(e) => setTosAccepted(e.target.checked)}
        />
        <span>
          Я согласен с{" "}
          <a
            href="/legal/terms"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            условиями использования
          </a>{" "}
          и{" "}
          <a
            href="/legal/privacy"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            политикой конфиденциальности
          </a>
          .
        </span>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {ERRORS[error]}
        </p>
      ) : null}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Создаём..." : "Зарегистрироваться"}
      </Button>
    </form>
  );
}
