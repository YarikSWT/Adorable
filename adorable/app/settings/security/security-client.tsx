"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Session = {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent?: boolean;
};

export function SecurityClient() {
  return (
    <div className="flex flex-col gap-8">
      <ChangePasswordSection />
      <ActiveSessionsSection />
    </div>
  );
}

function ChangePasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <section>
      <h2 className="mb-2 text-base font-semibold">Сменить пароль</h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setFeedback(null);
          if (next.length < 8) {
            setError("Новый пароль должен быть не короче 8 символов");
            return;
          }
          if (next !== confirm) {
            setError("Пароли не совпадают");
            return;
          }
          setBusy(true);
          try {
            const res = await fetch("/api/auth/change-password", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                currentPassword: current,
                newPassword: next,
                revokeOtherSessions: true,
              }),
            });
            if (res.ok) {
              setFeedback("Пароль обновлён");
              setCurrent("");
              setNext("");
              setConfirm("");
            } else {
              const err = (await res.json().catch(() => null)) as
                | { error?: { message?: string } }
                | null;
              setError(err?.error?.message ?? "Не удалось обновить пароль");
            }
          } catch {
            setError("Сетевая ошибка");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Текущий пароль</span>
          <Input
            type="password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Новый пароль</span>
          <Input
            type="password"
            required
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Повторите пароль</span>
          <Input
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
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
            {busy ? "Сохраняем..." : "Сменить пароль"}
          </Button>
        </div>
      </form>
    </section>
  );
}

const fmtDate = (iso: string): string => new Date(iso).toLocaleString();

const summariseUserAgent = (ua: string | null): string => {
  if (!ua) return "Неизвестное устройство";
  if (/iPhone|iPad/i.test(ua)) return "Safari (iOS)";
  if (/Android/i.test(ua)) return "Browser (Android)";
  if (/Macintosh.*Chrome/i.test(ua)) return "Chrome (macOS)";
  if (/Macintosh.*Safari/i.test(ua)) return "Safari (macOS)";
  if (/Windows.*Chrome/i.test(ua)) return "Chrome (Windows)";
  if (/Linux.*Firefox/i.test(ua)) return "Firefox (Linux)";
  if (/curl/i.test(ua)) return "curl";
  return ua.slice(0, 60);
};

function ActiveSessionsSection() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/list-sessions");
      if (res.ok) {
        const data = await res.json();
        const items = (data?.sessions ?? data ?? []) as Session[];
        setSessions(items);
      } else {
        setError("Не удалось получить список сессий");
      }
    } catch {
      setError("Сетевая ошибка");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <section>
      <h2 className="mb-2 text-base font-semibold">Активные сессии</h2>
      {error ? (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-md border border-border/40">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Устройство</th>
              <th className="px-3 py-2">IP</th>
              <th className="px-3 py-2">Создана</th>
              <th className="px-3 py-2">Действие</th>
            </tr>
          </thead>
          <tbody>
            {sessions == null ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-muted-foreground">
                  Загружаем...
                </td>
              </tr>
            ) : sessions.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-muted-foreground">
                  Активных сессий нет.
                </td>
              </tr>
            ) : (
              sessions.map((s) => (
                <tr key={s.id} className="border-t border-border/40">
                  <td className="px-3 py-2">
                    {summariseUserAgent(s.userAgent)}
                    {s.isCurrent ? (
                      <span className="ml-2 rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">
                        Эта сессия
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs">{s.ipAddress ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {fmtDate(s.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {s.isCurrent ? null : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === s.id}
                        onClick={async () => {
                          setBusyId(s.id);
                          try {
                            await fetch("/api/auth/revoke-session", {
                              method: "POST",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({ token: s.id }),
                            });
                            await reload();
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        Завершить
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
