"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const VISIBILITY_OPTIONS = [
  {
    value: "private",
    label: "Private",
    desc: "Видят только участники проекта (после verify email).",
  },
  {
    value: "authenticated",
    label: "Authenticated",
    desc: "Любой залогиненный пользователь Adorable с verified email.",
  },
  {
    value: "public",
    label: "Public",
    desc: "Доступно всем без авторизации.",
  },
] as const;

type Visibility = (typeof VISIBILITY_OPTIONS)[number]["value"];

export function PublicationClient({
  repoId,
  published,
  visibility,
  publishedAt,
  commitHash,
  previewUrl,
}: {
  repoId: string;
  published: boolean;
  visibility: string | null;
  publishedAt: string | null;
  commitHash: string | null;
  previewUrl: string | null;
}) {
  const [dialog, setDialog] = useState<null | "publish" | "visibility">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePublish = async (v: Visibility) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/repos/${encodeURIComponent(repoId)}/promote`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ visibility: v }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
      }
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const handleVisibility = async (v: Visibility) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/repos/${encodeURIComponent(repoId)}/visibility`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ visibility: v }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
      }
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (!published) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-border/40 p-5 text-sm">
        <p>
          Опубликуйте проект, чтобы получить URL и поделиться. Перед публикацией
          выберите видимость.
        </p>
        <div>
          <Button type="button" onClick={() => setDialog("publish")}>
            Опубликовать
          </Button>
        </div>
        {dialog === "publish" ? (
          <PublishDialog
            initial="private"
            busy={busy}
            error={error}
            confirmLabel="Опубликовать"
            onCancel={() => {
              setDialog(null);
              setError(null);
            }}
            onConfirm={handlePublish}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border/40 p-5 text-sm">
      {previewUrl ? (
        <div className="flex items-center gap-2">
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-primary underline"
          >
            {previewUrl}
          </a>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => navigator.clipboard.writeText(previewUrl)}
          >
            Скопировать
          </Button>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs uppercase">
          {visibility ?? "—"}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setDialog("visibility")}
        >
          Изменить
        </Button>
      </div>
      {publishedAt ? (
        <div className="text-xs text-muted-foreground">
          Опубликовано {new Date(publishedAt).toLocaleString()}
          {commitHash ? (
            <> · snapshot <code className="font-mono">{commitHash}</code></>
          ) : null}
        </div>
      ) : null}
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => handlePublish((visibility as Visibility) ?? "private")}
        >
          Опубликовать снова
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {dialog === "visibility" ? (
        <PublishDialog
          initial={(visibility as Visibility) ?? "private"}
          busy={busy}
          error={error}
          confirmLabel="Сохранить"
          onCancel={() => {
            setDialog(null);
            setError(null);
          }}
          onConfirm={handleVisibility}
        />
      ) : null}
    </div>
  );
}

function PublishDialog({
  initial,
  busy,
  error,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  initial: Visibility;
  busy: boolean;
  error: string | null;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (v: Visibility) => void | Promise<void>;
}) {
  const [v, setV] = useState<Visibility>(initial);
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
    >
      <div className="w-full max-w-md rounded-md border bg-card p-5 shadow-md">
        <h2 className="mb-3 text-base font-semibold">Уровень видимости</h2>
        <fieldset className="mb-3 flex flex-col gap-2">
          {VISIBILITY_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="visibility"
                value={opt.value}
                checked={v === opt.value}
                onChange={() => setV(opt.value)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{opt.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {opt.desc}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
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
            disabled={busy}
            onClick={() => void onConfirm(v)}
          >
            {busy ? "..." : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
