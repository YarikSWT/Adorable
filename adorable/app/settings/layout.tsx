import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getRequestSession } from "@/lib/auth/session";
import { UserSettingsSidebar } from "./sidebar";

export default async function UserSettingsLayout({
  children,
}: LayoutProps<"/settings">) {
  const session = await getRequestSession();
  if (!session) redirect("/login?from=/settings/profile");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border/40 px-4 py-3">
        <Link
          href="/"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ←
        </Link>
        <span className="text-sm font-semibold">Настройки</span>
      </div>
      <div className="flex flex-1 min-h-0">
        <aside className="w-56 shrink-0 border-r border-border/40">
          <UserSettingsSidebar />
        </aside>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
