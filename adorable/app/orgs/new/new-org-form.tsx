"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const slugify = (raw: string): string =>
  raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

export function NewOrgForm() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-fill slug from name until the user edits the slug field manually.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const res = await fetch("/api/orgs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, slug }),
          });
          if (!res.ok) {
            const err = (await res.json().catch(() => null)) as
              | { error?: { code?: string; message?: string } }
              | null;
            throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
          }
          const body = (await res.json()) as {
            organization: { slug: string };
          };
          window.location.href = `/orgs/${body.organization.slug}`;
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Имя</span>
        <Input
          required
          minLength={2}
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Slug</span>
        <Input
          required
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugTouched(true);
          }}
        />
        <span className="text-xs text-muted-foreground">
          В URL: /orgs/<code>{slug || "<slug>"}</code>
        </span>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy || !name || !slug}>
        {busy ? "Создаём..." : "Создать"}
      </Button>
    </form>
  );
}
