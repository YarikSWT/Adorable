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
