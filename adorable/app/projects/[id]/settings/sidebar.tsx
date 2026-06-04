"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  { href: "general", label: "General" },
  { href: "members", label: "Members" },
  { href: "tokens", label: "Tokens" },
  { href: "publication", label: "Publication" },
  { href: "danger", label: "Danger Zone" },
];

export function ProjectSettingsSidebar({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 p-2 text-sm">
      {SECTIONS.map((s) => {
        const href = `/projects/${projectId}/settings/${s.href}`;
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
