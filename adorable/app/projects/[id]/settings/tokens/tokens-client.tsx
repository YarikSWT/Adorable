"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Two staged dialogs: the create form (name/kind/expiry) and the
// post-create plaintext panel (Doc 3 §6.5). The flow:
//   1. user clicks "Создать токен" → CreateDialog open.
//   2. submit → POST /api/repos/:repoId/tokens → response carries plaintext
//      `token`. We close CreateDialog and open PlaintextDialog with the
//      plaintext value the API returned. Plaintext is held only in this
//      component's state, so unmount = it's gone.
//   3. PlaintextDialog can only be dismissed via "Понятно, сохранил".
//
// Revoke uses a separate small confirm dialog. We do soft-revoke (DELETE
// flips revoked_at) so the row stays in the table greyed out.

type TokenRow = {
  id: string;
  kind: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

type Issued = {
  id: string;
  kind: string;
  name: string;
  token: string;
  tokenPrefix: string;
  createdAt: string;
  expiresAt: string | null;
};

const tokensUrl = (repoId: string): string =>
  `/api/repos/${encodeURIComponent(repoId)}/tokens`;

const fetchTokens = async (repoId: string): Promise<TokenRow[]> => {
  const res = await fetch(tokensUrl(repoId));
  if (!res.ok) return [];
  const data = (await res.json()) as { tokens: TokenRow[] };
  return data.tokens ?? [];
};

const tokenStatus = (t: TokenRow): "active" | "revoked" | "expired" => {
  if (t.revokedAt) return "revoked";
  if (t.expiresAt && new Date(t.expiresAt) < new Date()) return "expired";
  return "active";
};

const STATUS_LABEL: Record<"active" | "revoked" | "expired", string> = {
  active: "Активен",
  revoked: "Отозван",
  expired: "Истёк",
};

const formatDate = (iso: string | null): string => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
};

export function TokensClient({ repoId }: { repoId: string }) {
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setRows(await fetchTokens(repoId));
    setLoading(false);
  }, [repoId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">
          Токены используются для server-side обращения к API проекта.
          Plaintext-значение видно ровно один раз — сразу после создания.
        </p>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          Создать токен
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-border/40">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Имя</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Префикс</th>
              <th className="px-3 py-2">Создан</th>
              <th className="px-3 py-2">Last used</th>
              <th className="px-3 py-2">Expires</th>
              <th className="px-3 py-2">Статус</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-muted-foreground">
                  Загружаем...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-muted-foreground">
                  Пока нет токенов.
                </td>
              </tr>
            ) : (
              rows.map((t) => {
                const status = tokenStatus(t);
                return (
                  <tr
                    key={t.id}
                    className={
                      "border-t border-border/40 " +
                      (status === "active" ? "" : "text-muted-foreground")
                    }
                    data-token-row={t.id}
                  >
                    <td className="px-3 py-2 font-medium">{t.name}</td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-muted px-2 py-0.5 text-xs uppercase">
                        {t.kind}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {t.tokenPrefix}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {formatDate(t.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {formatDate(t.lastUsedAt)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {formatDate(t.expiresAt)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {STATUS_LABEL[status]}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {status === "active" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRevokingId(t.id)}
                        >
                          Отозвать
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {createOpen ? (
        <CreateDialog
          repoId={repoId}
          onCancel={() => setCreateOpen(false)}
          onIssued={(t) => {
            setCreateOpen(false);
            setIssued(t);
            void reload();
          }}
        />
      ) : null}
      {issued ? (
        <PlaintextDialog
          issued={issued}
          onAcknowledge={() => setIssued(null)}
        />
      ) : null}
      {revokingId ? (
        <RevokeConfirmDialog
          repoId={repoId}
          tokenId={revokingId}
          tokenName={
            rows.find((r) => r.id === revokingId)?.name ?? "<token>"
          }
          onCancel={() => setRevokingId(null)}
          onRevoked={() => {
            setRevokingId(null);
            void reload();
          }}
        />
      ) : null}
    </div>
  );
}

const KINDS = [
  { value: "server", label: "server", desc: "Серверный — sk_live_..." },
  { value: "public", label: "public", desc: "Клиентский — pk_live_..." },
  { value: "export", label: "export", desc: "Экспортный — xp_live_..." },
];

function CreateDialog({
  repoId,
  onCancel,
  onIssued,
}: {
  repoId: string;
  onCancel: () => void;
  onIssued: (t: Issued) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("server");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <DialogShell title="Создать токен" onClose={onCancel}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const days = Number(expiresInDays);
            const res = await fetch(tokensUrl(repoId), {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                name,
                kind,
                expiresInDays: Number.isFinite(days) && days > 0 ? days : undefined,
              }),
            });
            if (!res.ok) {
              const err = (await res.json().catch(() => null)) as
                | { error?: { message?: string } }
                | null;
              throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
            }
            onIssued((await res.json()) as Issued);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Имя</span>
          <Input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Kind</span>
          {KINDS.map((k) => (
            <label key={k.value} className="flex items-start gap-2">
              <input
                type="radio"
                name="kind"
                value={k.value}
                checked={kind === k.value}
                onChange={() => setKind(k.value)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{k.label}</span>{" "}
                <span className="text-xs text-muted-foreground">{k.desc}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Expires (дней)</span>
          <Input
            type="number"
            min={0}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            placeholder="бессрочно"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Создаём..." : "Создать"}
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

function PlaintextDialog({
  issued,
  onAcknowledge,
}: {
  issued: Issued;
  onAcknowledge: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <DialogShell
      title="Токен создан"
      // Plaintext modal — Doc 3 §6.5 — only "Понятно" closes it. We DON'T
      // pass onClose so the backdrop click + Esc are no-ops; user has to
      // explicitly acknowledge.
      onClose={undefined}
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          <strong>Это единственный раз</strong>, когда вы видите токен
          целиком. Сохраните его сейчас.
        </p>
        <pre
          data-testid="plaintext-token"
          className="overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-sm"
        >
          {issued.token}
        </pre>
        <div className="flex justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(issued.token);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Скопировано" : "Скопировать"}
          </Button>
          <Button type="button" onClick={onAcknowledge}>
            Понятно, сохранил
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}

function RevokeConfirmDialog({
  repoId,
  tokenId,
  tokenName,
  onCancel,
  onRevoked,
}: {
  repoId: string;
  tokenId: string;
  tokenName: string;
  onCancel: () => void;
  onRevoked: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <DialogShell title="Отозвать токен" onClose={onCancel}>
      <p className="mb-4 text-sm">
        Токен <strong>{tokenName}</strong> перестанет работать сразу после
        отзыва. Восстановить его невозможно.
      </p>
      {error ? (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Отмена
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await fetch(`${tokensUrl(repoId)}/${tokenId}`, {
                method: "DELETE",
              });
              if (!res.ok) {
                const err = (await res.json().catch(() => null)) as
                  | { error?: { message?: string } }
                  | null;
                throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
              }
              onRevoked();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Отзываем..." : "Отозвать"}
        </Button>
      </div>
    </DialogShell>
  );
}

function DialogShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: (() => void) | undefined;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
      onClick={(e) => {
        if (onClose && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-md border bg-card p-5 shadow-md">
        <h2 className="mb-3 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
