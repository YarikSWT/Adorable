import { and, count, eq, gte, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/users";
import { organizations } from "@/lib/db/schema/organizations";
import { projects } from "@/lib/db/schema/projects";

const oneWeekAgo = (): Date => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  return d;
};

export default async function AdminDashboardPage() {
  const userTotal = await db.select({ n: count() }).from(users);
  const userActive = await db
    .select({ n: count() })
    .from(users)
    .where(eq(users.status, "active"));
  const userLastWeek = await db
    .select({ n: count() })
    .from(users)
    .where(gte(users.createdAt, oneWeekAgo()));
  const orgTotal = await db.select({ n: count() }).from(organizations);
  const publishedTotal = await db
    .select({ n: count() })
    .from(projects)
    .where(
      and(
        isNotNull(projects.publishedSnapshotId),
        eq(projects.status, "active"),
      ),
    );

  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-lg font-semibold">Дашборд</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Юзеры (всего)" value={userTotal[0]?.n ?? 0} />
        <Stat label="Юзеры (активные)" value={userActive[0]?.n ?? 0} />
        <Stat
          label="Регистрации за неделю"
          value={userLastWeek[0]?.n ?? 0}
        />
        <Stat label="Организации" value={orgTotal[0]?.n ?? 0} />
        <Stat
          label="Опубликованные проекты"
          value={publishedTotal[0]?.n ?? 0}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | bigint }) {
  return (
    <div className="rounded-md border border-border/40 p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{String(value)}</div>
    </div>
  );
}
