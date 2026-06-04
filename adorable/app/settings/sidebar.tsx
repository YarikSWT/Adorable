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
      <div className="px-3 pt-2 pb-1 font-mono text-[11px] tracking-wide text-n-400 uppercase">
        Personal
      </div>
      {SECTIONS.map((s) => {
        const href = `/settings/${s.href}`;
        const active = pathname?.startsWith(href);
        return (
          <Link
            key={s.href}
            href={href}
            className={
              "relative rounded-[var(--r-md)] px-3 py-2 transition-colors " +
              (active
                ? "bg-cream font-medium text-coral-deep before:absolute before:top-1/2 before:left-0 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-coral before:content-['']"
                : "text-ink hover:bg-cream")
            }
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
