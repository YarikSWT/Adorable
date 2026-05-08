"use client";

import { useEffect, useState } from "react";

type Usage = {
  plan: { slug: string; name: string; limits: Record<string, number> };
  period: { start: string; end: string };
  limits: Record<string, number>;
  used: Record<string, number>;
  overrides: Array<{
    limits: Record<string, number>;
    reason: string | null;
    expiresAt: string | null;
    createdAt: string;
  }>;
  events: {
    total: number;
    lastEventAt: string | null;
    items: Array<{
      id: string;
      kind: string;
      amount: string;
      unit: string;
      model: string | null;
      projectId: string | null;
      createdAt: string;
    }>;
  };
};

const fmtNumber = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString() : "—";

const barColor = (pct: number): string => {
  if (pct >= 100) return "bg-destructive";
  if (pct >= 80) return "bg-amber-500";
  return "bg-primary";
};

export function BillingClient({ orgId }: { orgId: string }) {
  const [data, setData] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/orgs/${orgId}/usage`);
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
        }
        setData(await res.json());
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [orgId]);

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Загружаем...</p>;
  }

  const limitKeys = Object.keys(data.limits);

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-md border border-border/40 p-4">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-xs uppercase text-muted-foreground">План</div>
            <div className="text-lg font-semibold">{data.plan.name}</div>
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            Период: {fmtDate(data.period.start)} — {fmtDate(data.period.end)}
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Лимиты и использование</h2>
        <div className="overflow-hidden rounded-md border border-border/40">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Ресурс</th>
                <th className="px-3 py-2">Лимит</th>
                <th className="px-3 py-2">Использовано</th>
                <th className="px-3 py-2">Прогресс</th>
                <th className="px-3 py-2">Остаток</th>
              </tr>
            </thead>
            <tbody>
              {limitKeys.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-muted-foreground">
                    Нет лимитов.
                  </td>
                </tr>
              ) : (
                limitKeys.map((kind) => {
                  const limit = data.limits[kind] ?? 0;
                  const used = data.used[kind] ?? 0;
                  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
                  const remaining = Math.max(0, limit - used);
                  return (
                    <tr key={kind} className="border-t border-border/40">
                      <td className="px-3 py-2 font-mono text-xs">{kind}</td>
                      <td className="px-3 py-2">{fmtNumber(limit)}</td>
                      <td className="px-3 py-2">{fmtNumber(used)}</td>
                      <td className="px-3 py-2">
                        <div className="h-2 w-32 overflow-hidden rounded bg-muted">
                          <div
                            className={`h-full ${barColor(pct)}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {fmtNumber(remaining)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {data.overrides.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Индивидуальные лимиты</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Эти лимиты установлены поддержкой.
          </p>
          <div className="rounded-md border border-border/40 p-3 text-sm">
            {data.overrides.map((o, i) => (
              <div key={i} className="border-t border-border/40 first:border-t-0 py-2">
                <div className="font-mono text-xs">
                  {Object.entries(o.limits ?? {})
                    .map(([k, v]) => `${k}=${v}`)
                    .join(", ")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {o.reason ? `«${o.reason}» · ` : ""}создан {fmtDate(o.createdAt)}
                  {o.expiresAt ? ` · истекает ${fmtDate(o.expiresAt)}` : ""}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-sm font-semibold">
          История событий ({data.events.total})
        </h2>
        <div className="overflow-hidden rounded-md border border-border/40">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Дата</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Project</th>
              </tr>
            </thead>
            <tbody>
              {data.events.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-muted-foreground">
                    Пока ничего не использовано.
                  </td>
                </tr>
              ) : (
                data.events.items.map((e) => (
                  <tr key={e.id} className="border-t border-border/40">
                    <td className="px-3 py-2 text-xs">{fmtDate(e.createdAt)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{e.kind}</td>
                    <td className="px-3 py-2 text-xs">
                      {e.amount} {e.unit}
                    </td>
                    <td className="px-3 py-2 text-xs">{e.model ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {e.projectId ? e.projectId.slice(0, 8) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
