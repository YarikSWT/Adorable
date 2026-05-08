import Link from "next/link";
import { and, desc, eq, gte, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema/audit";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const firstStr = (
  v: string | string[] | undefined,
): string | undefined => (Array.isArray(v) ? v[0] : v);

const PAGE_LIMIT = 100;

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const action = (firstStr(params["action"]) ?? "").trim();
  const sinceParam = (firstStr(params["since"]) ?? "").trim();

  const filters: SQL[] = [];
  if (action) filters.push(eq(auditLog.action, action));
  if (sinceParam) {
    const since = new Date(sinceParam);
    if (!Number.isNaN(since.getTime())) {
      filters.push(gte(auditLog.createdAt, since));
    }
  }

  const baseQuery = db
    .select({
      id: auditLog.id,
      actorUserId: auditLog.actorUserId,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      organizationId: auditLog.organizationId,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(PAGE_LIMIT);
  const items =
    filters.length > 0 ? await baseQuery.where(and(...filters)) : await baseQuery;

  return (
    <div className="max-w-5xl">
      <h1 className="mb-4 text-lg font-semibold">Аудит-лог</h1>
      <form className="mb-4 flex flex-wrap items-end gap-3" method="GET">
        <label className="flex flex-col gap-1 text-xs">
          <span>Action</span>
          <input
            type="text"
            name="action"
            defaultValue={action}
            placeholder="например, project.create"
            className="h-9 w-64 rounded-md border border-input bg-transparent px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span>Since</span>
          <input
            type="datetime-local"
            name="since"
            defaultValue={sinceParam}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          />
        </label>
        <button
          type="submit"
          className="h-9 rounded-md border bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Применить
        </button>
        <Link href="/admin/audit" className="text-xs text-muted-foreground hover:underline">
          сбросить
        </Link>
      </form>
      <div className="overflow-hidden rounded-md border border-border/40">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Дата</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Org</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-muted-foreground">
                  Нет записей.
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr key={row.id} className="border-t border-border/40">
                  <td className="px-3 py-2 text-xs">
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{row.action}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.actorUserId ? row.actorUserId.slice(0, 8) : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.targetType
                      ? `${row.targetType}:${row.targetId?.slice(0, 8) ?? "—"}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.organizationId ? row.organizationId.slice(0, 8) : "—"}
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
