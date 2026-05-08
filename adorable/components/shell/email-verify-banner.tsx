"use client";

import { useEffect, useState } from "react";
import { useMe } from "./me-context";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "adorable.shell.email-verify-dismissed-at";
const DISMISS_RETURN_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_S = 30;

const isDismissed = (): boolean => {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const then = Number(raw);
  if (!Number.isFinite(then)) return false;
  return Date.now() - then < DISMISS_RETURN_MS;
};

export function EmailVerifyBanner() {
  const { me } = useMe();
  const [dismissed, setDismissed] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resendBusy, setResendBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setDismissed(isDismissed());
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  if (!me || me.user.emailVerified || dismissed) return null;

  const handleResend = async () => {
    setResendBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/auth/send-verification-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: me.user.email,
          callbackURL: "/verify-email",
        }),
      });
      setCooldown(RESEND_COOLDOWN_S);
      setFeedback(
        res.ok
          ? "Письмо отправлено. Проверьте почту."
          : res.status === 429
            ? "Слишком часто. Попробуйте позже."
            : "Не удалось отправить — попробуйте через минуту.",
      );
    } catch {
      setFeedback("Не удалось отправить — попробуйте через минуту.");
    } finally {
      setResendBusy(false);
    }
  };

  const handleDismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  };

  return (
    <div
      role="status"
      className="flex w-full flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-100"
    >
      <span>
        Подтвердите email <strong>{me.user.email}</strong>, чтобы создавать
        проекты и публиковать приложения.
        {feedback ? (
          <span className="ml-2 text-amber-200/80">{feedback}</span>
        ) : null}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={resendBusy || cooldown > 0}
          onClick={handleResend}
        >
          {cooldown > 0
            ? `Отправить заново (${cooldown})`
            : resendBusy
              ? "Отправляем..."
              : "Отправить заново"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleDismiss}
          aria-label="Скрыть на сутки"
        >
          ✕
        </Button>
      </div>
    </div>
  );
}
