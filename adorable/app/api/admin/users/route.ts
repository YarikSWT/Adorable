import { NextResponse } from "next/server";
import { count, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/users";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requireAdminPermission } from "@/lib/auth/authorization";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const GET = protectedRoute(async ({ req, session }) => {
  await requireAdminPermission(session.user.id, "admin.users.read");
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT),
  );
  const q = (url.searchParams.get("q") ?? "").trim();

  const where = q
    ? or(ilike(users.email, `%${q}%`), ilike(users.name, `%${q}%`))
    : undefined;

  const itemsQuery = db
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
    .limit(limit)
    .offset((page - 1) * limit);
  const items = where ? await itemsQuery.where(where) : await itemsQuery;

  const totalQuery = db.select({ n: count() }).from(users);
  const totalRow = where ? await totalQuery.where(where) : await totalQuery;

  return NextResponse.json({
    items,
    total: Number(totalRow[0]?.n ?? 0),
    page,
    limit,
  });
});

void eq; // kept for parity with single-user fetcher in [userId]/route.ts.
