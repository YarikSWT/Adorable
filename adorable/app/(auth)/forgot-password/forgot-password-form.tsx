"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Doc 3 §3.4: ALWAYS show the same neutral message — leaks nothing about
// whether the account exists. 429 gets its own visible message because the
// user can act on it (wait and retry).

const NEUTRAL_MESSAGE =
  "Если такой email есть в системе — мы прислали ссылку для восстановления.";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);

  if (submitted) {
    return (
      <p
        role="status"
        className="rounded-md bg-muted/40 p-3 text-sm text-foreground"
      >
        {NEUTRAL_MESSAGE}
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setRateLimited(false);
        try {
          const res = await fetch("/api/auth/forget-password", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email,
              redirectTo: "/reset-password",
            }),
          });
          if (res.status === 429) {
            setRateLimited(true);
            return;
          }
          // Show the neutral confirmation regardless of 200/4xx (Doc 3 §3.4).
          setSubmitted(true);
        } catch {
          setSubmitted(true);
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
      {rateLimited ? (
        <p role="alert" className="text-sm text-destructive">
          Слишком много запросов. Попробуйте через час.
        </p>
      ) : null}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Отправляем..." : "Прислать ссылку"}
      </Button>
    </form>
  );
}
