"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  { href: "/admin", label: "Дашборд", exact: true },
  { href: "/admin/users", label: "Юзеры" },
  { href: "/admin/audit", label: "Аудит" },
];

export function AdminSidebar() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 p-2 text-sm">
      {SECTIONS.map((s) => {
        const active = s.exact ? pathname === s.href : pathname?.startsWith(s.href);
        return (
          <Link
            key={s.href}
            href={s.href}
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
