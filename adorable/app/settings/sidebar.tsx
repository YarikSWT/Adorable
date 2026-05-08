"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  { href: "profile", label: "Профиль" },
  { href: "security", label: "Безопасность" },
  { href: "connections", label: "Подключения" },
];

export function UserSettingsSidebar() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 p-2 text-sm">
      {SECTIONS.map((s) => {
        const href = `/settings/${s.href}`;
        const active = pathname?.startsWith(href);
        return (
          <Link
            key={s.href}
            href={href}
            className={
              "rounded px-3 py-2 hover:bg-accent " +
              (active
                ? "border-l-2 border-primary bg-accent/40 font-medium"
                : "border-l-2 border-transparent")
            }
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
