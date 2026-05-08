"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function GeneralSettingsForm({
  projectId,
  initialName,
  initialDescription,
  initialSlug,
  slugLocked,
}: {
  projectId: string;
  initialName: string;
  initialDescription: string;
  initialSlug: string;
  slugLocked: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [slug, setSlug] = useState(initialSlug);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const dirty =
    name !== initialName ||
    description !== initialDescription ||
    slug !== initialSlug;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setFeedback(null);
        const body: Record<string, string> = {};
        if (name !== initialName) body.name = name;
        if (description !== initialDescription) body.description = description;
        if (slug !== initialSlug) body.slug = slug;
        try {
          const res = await fetch(`/api/projects/${projectId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          if (res.ok) {
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
        <span className="font-medium">Описание</span>
        <textarea
          rows={3}
          className="rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Slug</span>
        <Input
          value={slug}
          disabled={slugLocked}
          onChange={(e) => setSlug(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">
          {slugLocked
            ? "Slug зафиксирован после первой публикации, чтобы preview-ссылки не ломались."
            : "Будет зафиксирован после первой публикации."}
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
  );
}
