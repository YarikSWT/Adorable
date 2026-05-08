import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/users";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requireAdminPermission } from "@/lib/auth/authorization";
import { writeAuditLog } from "@/lib/auth/audit";
import { HttpError } from "@/lib/auth/errors";

type Params = { userId: string };

export const POST = protectedRoute<Params>(async ({ params, session }) => {
  await requireAdminPermission(session.user.id, "admin.users.ban");
  const result = await db
    .update(users)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(users.id, params.userId))
    .returning({ id: users.id });
  if (result.length === 0) throw new HttpError(404, "not_found", "User not found");
  await writeAuditLog({
    actorUserId: session.user.id,
    action: "user.unsuspend",
    targetType: "user",
    targetId: params.userId,
  });
  return NextResponse.json({ ok: true });
});
