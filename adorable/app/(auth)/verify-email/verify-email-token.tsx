"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type VerifyState =
  | { status: "loading" }
  | { status: "ok" }
  | { status: "error"; reason: string };

export function VerifyEmailToken({ token }: { token: string }) {
  const [state, setState] = useState<VerifyState>({ status: "loading" });

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        // Better Auth's verify-email endpoint accepts the token via query AND
        // POST body. We use GET because the link in the email is a GET click.
        const url = `/api/auth/verify-email?token=${encodeURIComponent(token)}`;
        const res = await fetch(url, { signal: ac.signal });
        if (res.ok) {
          setState({ status: "ok" });
          return;
        }
        if (res.status === 400 || res.status === 410) {
          setState({ status: "error", reason: "expired" });
        } else {
          setState({ status: "error", reason: "generic" });
        }
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setState({ status: "error", reason: "generic" });
      }
    })();
    return () => ac.abort();
  }, [token]);

  if (state.status === "loading") {
    return (
      <p className="text-sm text-muted-foreground">Проверяем токен...</p>
    );
  }
  if (state.status === "ok") {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p>Email подтверждён.</p>
        <Link
          href="/"
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90"
        >
          К проектам
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        {state.reason === "expired"
          ? "Ссылка не действительна или уже использована."
          : "Не удалось подтвердить email. Попробуйте запросить новое письмо."}
      </p>
      <Link
        href="/verify-email?pending=true"
        className="inline-flex h-9 items-center justify-center rounded-md border bg-background px-4 text-sm font-medium hover:bg-accent"
      >
        Запросить новое письмо
      </Link>
    </div>
  );
}
