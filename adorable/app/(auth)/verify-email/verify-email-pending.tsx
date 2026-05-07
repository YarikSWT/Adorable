"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const COOLDOWN_SECONDS = 30;

export function VerifyEmailPending({ email }: { email: string | null }) {
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p>
        Мы прислали письмо{email ? <> на <strong>{email}</strong></> : null}.
        Перейдите по ссылке, чтобы подтвердить адрес. Не пришло — проверьте
        папку «Спам».
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={busy || cooldown > 0 || !email}
        onClick={async () => {
          if (!email) return;
          setBusy(true);
          setFeedback(null);
          try {
            const res = await fetch("/api/auth/send-verification-email", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email,
                callbackURL: "/verify-email",
              }),
            });
            if (res.ok) {
              setFeedback("Отправили заново. Проверьте почту.");
              setCooldown(COOLDOWN_SECONDS);
            } else if (res.status === 429) {
              setFeedback("Слишком часто. Попробуйте позже.");
              setCooldown(COOLDOWN_SECONDS);
            } else {
              setFeedback("Не удалось отправить — попробуйте через минуту.");
            }
          } catch {
            setFeedback("Не удалось отправить — попробуйте через минуту.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {cooldown > 0 ? `Запросить заново (${cooldown})` : "Запросить заново"}
      </Button>
      {feedback ? (
        <p className="text-xs text-muted-foreground">{feedback}</p>
      ) : null}
    </div>
  );
}
