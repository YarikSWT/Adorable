"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Two destructive actions per Doc 3 §6.7. Each block is independently
// validated:
//   - Archive: requires the project name typed exactly.
//   - Delete : requires the project name AND the literal word "удалить".
//
// Both POST/DELETE go through /api/projects/:id (DELETE), with `archive:true`
// for the soft path. Success → redirect to /.

export function DangerZoneClient({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [archiveConfirm, setArchiveConfirm] = useState("");
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const [deleteName, setDeleteName] = useState("");
  const [deleteWord, setDeleteWord] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const archiveReady = archiveConfirm === projectName;
  const deleteReady =
    deleteName === projectName && deleteWord.trim().toLowerCase() === "удалить";

  const callDelete = async (archive: boolean): Promise<boolean> => {
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archive }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
    }
    return true;
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-md border border-amber-500/40 p-4">
        <h2 className="text-base font-semibold">Архивировать</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Проект перестанет быть видимым в списке, но его можно восстановить
          через поддержку. Sandbox освобождается, публикация остаётся доступной.
        </p>
        <label className="mb-2 flex flex-col gap-1 text-sm">
          <span className="font-medium">
            Введите имя проекта <strong>{projectName}</strong> для подтверждения
          </span>
          <Input
            value={archiveConfirm}
            onChange={(e) => setArchiveConfirm(e.target.value)}
          />
        </label>
        {archiveError ? (
          <p role="alert" className="mb-2 text-xs text-destructive">
            {archiveError}
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={!archiveReady || archiveBusy}
          onClick={async () => {
            setArchiveBusy(true);
            setArchiveError(null);
            try {
              await callDelete(true);
              window.location.href = "/";
            } catch (err) {
              setArchiveError((err as Error).message);
            } finally {
              setArchiveBusy(false);
            }
          }}
        >
          {archiveBusy ? "Архивируем..." : "Архивировать"}
        </Button>
      </section>

      <section className="rounded-md border border-destructive/40 p-4">
        <h2 className="text-base font-semibold text-destructive">Удалить</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Проект и его данные будут удалены безвозвратно.
        </p>
        <label className="mb-2 flex flex-col gap-1 text-sm">
          <span className="font-medium">
            Введите имя проекта <strong>{projectName}</strong>
          </span>
          <Input
            value={deleteName}
            onChange={(e) => setDeleteName(e.target.value)}
          />
        </label>
        <label className="mb-2 flex flex-col gap-1 text-sm">
          <span className="font-medium">Введите слово <code>удалить</code></span>
          <Input
            value={deleteWord}
            onChange={(e) => setDeleteWord(e.target.value)}
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
          disabled={!deleteReady || deleteBusy}
          onClick={async () => {
            setDeleteBusy(true);
            setDeleteError(null);
            try {
              await callDelete(false);
              window.location.href = "/";
            } catch (err) {
              setDeleteError((err as Error).message);
            } finally {
              setDeleteBusy(false);
            }
          }}
        >
          {deleteBusy ? "Удаляем..." : "Удалить навсегда"}
        </Button>
      </section>
    </div>
  );
}
