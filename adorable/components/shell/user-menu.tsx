"use client";

import { useState } from "react";
import Link from "next/link";
import type { Me } from "./me-context";

const initials = (name: string | null, email: string): string => {
  const src = (name ?? email).trim();
  return (
    src
      .split(/\s+|@/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "·"
  );
};

const personalOrg = (me: Me): { slug: string } | null => {
  const personal = me.organizations.find((o) => o.type === "personal");
  return personal ? { slug: personal.slug } : null;
};

const handleSignOut = async () => {
  try {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  } finally {
    window.location.href = "/login";
  }
};

export function UserMenu({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const personal = personalOrg(me);

  return (
    <div className="relative">
      <button
        type="button"
        className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold hover:bg-accent"
        aria-label="Меню пользователя"
        onClick={() => setOpen((v) => !v)}
      >
        {me.user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={me.user.avatarUrl}
            alt=""
            className="size-full rounded-full object-cover"
          />
        ) : (
          initials(me.user.name, me.user.email)
        )}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <div className="px-2 py-1.5">
            <div className="text-sm font-medium">
              {me.user.name ?? me.user.email.split("@")[0]}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {me.user.email}
            </div>
          </div>
          <div className="my-1 h-px bg-border" />
          <Link
            href="/settings/profile"
            role="menuitem"
            className="block rounded px-2 py-1.5 text-sm hover:bg-accent"
            onClick={() => setOpen(false)}
          >
            Профиль
          </Link>
          <Link
            href="/settings/security"
            role="menuitem"
            className="block rounded px-2 py-1.5 text-sm hover:bg-accent"
            onClick={() => setOpen(false)}
          >
            Безопасность
          </Link>
          <Link
            href="/settings/connections"
            role="menuitem"
            className="block rounded px-2 py-1.5 text-sm hover:bg-accent"
            onClick={() => setOpen(false)}
          >
            Подключения
          </Link>
          {personal ? (
            <>
              <div className="my-1 h-px bg-border" />
              <Link
                href={`/orgs/${personal.slug}/billing`}
                role="menuitem"
                className="block rounded px-2 py-1.5 text-sm hover:bg-accent"
                onClick={() => setOpen(false)}
              >
                Биллинг
              </Link>
            </>
          ) : null}
          {me.user.isAdmin ? (
            <>
              <div className="my-1 h-px bg-border" />
              <Link
                href="/admin"
                role="menuitem"
                className="block rounded px-2 py-1.5 text-sm hover:bg-accent"
                onClick={() => setOpen(false)}
              >
                Админка
              </Link>
            </>
          ) : null}
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => {
              setOpen(false);
              void handleSignOut();
            }}
          >
            Выйти
          </button>
        </div>
      ) : null}
    </div>
  );
}
