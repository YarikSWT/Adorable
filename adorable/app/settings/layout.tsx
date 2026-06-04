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
      <div className="flex items-center gap-3 border-b border-cream-deep px-5 py-3.5">
        <Link
          href="/"
          className="text-sm text-n-500 transition-colors hover:text-ink"
          aria-label="Back to all apps"
        >
          ←
        </Link>
        <span className="font-display text-lg font-medium text-ink">
          Settings
        </span>
      </div>
      <div className="flex flex-1 min-h-0">
        <aside className="w-56 shrink-0 border-r border-cream-deep p-1">
          <UserSettingsSidebar />
        </aside>
        <main className="flex-1 overflow-y-auto p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
