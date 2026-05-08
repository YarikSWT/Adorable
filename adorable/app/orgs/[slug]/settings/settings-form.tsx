"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function OrgSettingsForm({
  orgId,
  initialName,
  initialSlug,
  canDelete,
}: {
  orgId: string;
  initialName: string;
  initialSlug: string;
  canDelete: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(initialSlug);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const dirty = name !== initialName || slug !== initialSlug;

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setFeedback(null);
          const body: Record<string, string> = {};
          if (name !== initialName) body.name = name;
          if (slug !== initialSlug) body.slug = slug;
          try {
            const res = await fetch(`/api/orgs/${orgId}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            });
            if (res.ok) {
              const updated = (await res.json()) as {
                organization: { slug: string };
              };
              if (updated.organization.slug !== initialSlug) {
                window.location.href = `/orgs/${updated.organization.slug}/settings`;
                return;
              }
              setFeedback("Сохранено");
            } else {
              const err = (await res.json().catch(() => null)) as
                | { error?: { message?: string } }
                | null;
              setFeedback(err?.error?.message ?? "Не удалось сохранить");
            }
          } catch {
            setFeedback("Сетевая ошибка");
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
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Slug</span>
          <Input
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">
            Изменение slug меняет URL организации. Старые ссылки перестанут
            работать.
          </span>
        </label>
        {feedback ? (
          <p
            role="status"
            className={
              "text-sm " +
              (feedback === "Сохранено"
                ? "text-emerald-500"
                : "text-destructive")
            }
          >
            {feedback}
          </p>
        ) : null}
        <div>
          <Button type="submit" disabled={!dirty || busy}>
            {busy ? "Сохраняем..." : "Сохранить"}
          </Button>
        </div>
      </form>

      {canDelete ? (
        <section className="rounded-md border border-destructive/40 p-4">
          <h2 className="text-base font-semibold text-destructive">
            Удалить организацию
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Все участники потеряют доступ к проектам этой организации. Восстановить нельзя.
          </p>
          <label className="mb-2 flex flex-col gap-1 text-sm">
            <span className="font-medium">
              Введите имя организации <strong>{initialName}</strong> для
              подтверждения
            </span>
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
            />
          </label>
          {deleteError ? (
            <p role="alert" className="mb-2 text-xs text-destructive">
              {deleteError}
            </p>
          ) : null}
          <Button
            type="button"
            variant="destructive"
            disabled={deleteConfirm !== initialName || deleteBusy}
            onClick={async () => {
              setDeleteBusy(true);
              setDeleteError(null);
              try {
                const res = await fetch(`/api/orgs/${orgId}`, {
                  method: "DELETE",
                });
                if (!res.ok) {
                  const err = (await res.json().catch(() => null)) as
                    | { error?: { message?: string } }
                    | null;
                  throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
                }
                window.location.href = "/";
              } catch (err) {
                setDeleteError((err as Error).message);
                setDeleteBusy(false);
              }
            }}
          >
            {deleteBusy ? "Удаляем..." : "Удалить организацию"}
          </Button>
        </section>
      ) : null}
    </div>
  );
}
