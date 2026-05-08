import Link from "next/link";
import { redirect } from "next/navigation";
import { getRequestSession } from "@/lib/auth/session";
import { AdminSidebar } from "./sidebar";

export default async function AdminLayout({
  children,
}: LayoutProps<"/admin">) {
  const session = await getRequestSession();
  if (!session) redirect("/login?from=/admin");
  if (!session.user.isAdmin) {
    // Doc 3 §9: 403 for non-admins. We render a friendly empty page instead
    // of throwing so the existing shell stays mounted.
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Доступ запрещён.
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border/40 px-4 py-3">
        <Link
          href="/"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ←
        </Link>
        <span className="text-sm font-semibold">Admin</span>
      </div>
      <div className="flex flex-1 min-h-0">
        <aside className="w-48 shrink-0 border-r border-border/40">
          <AdminSidebar />
        </aside>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
