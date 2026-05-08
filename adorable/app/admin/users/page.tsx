import Link from "next/link";
import { desc, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/users";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const firstStr = (
  v: string | string[] | undefined,
): string | undefined => (Array.isArray(v) ? v[0] : v);

const PAGE_LIMIT = 50;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const q = (firstStr(params["q"]) ?? "").trim();
  const where = q
    ? or(ilike(users.email, `%${q}%`), ilike(users.name, `%${q}%`))
    : undefined;
  const baseQuery = db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isAdmin: users.isAdmin,
      status: users.status,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(PAGE_LIMIT);
  const items = where ? await baseQuery.where(where) : await baseQuery;

  return (
    <div className="max-w-4xl">
      <h1 className="mb-4 text-lg font-semibold">Юзеры</h1>
      <form className="mb-4" method="GET">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Поиск по email или имени"
          className="h-9 w-full max-w-md rounded-md border border-input bg-transparent px-3 text-sm"
        />
      </form>
      <div className="overflow-hidden rounded-md border border-border/40">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Имя</th>
              <th className="px-3 py-2">Статус</th>
              <th className="px-3 py-2">Verified</th>
              <th className="px-3 py-2">Создан</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-muted-foreground">
                  Нет юзеров.
                </td>
              </tr>
            ) : (
              items.map((u) => (
                <tr key={u.id} className="border-t border-border/40">
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {u.email}
                    </Link>
                    {u.isAdmin ? (
                      <span className="ml-2 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] uppercase">
                        admin
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs">{u.name ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{u.status}</td>
                  <td className="px-3 py-2 text-xs">
                    {u.emailVerified ? "✓" : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {new Date(u.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
