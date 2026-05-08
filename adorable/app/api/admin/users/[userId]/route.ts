import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/users";
import { sessions } from "@/lib/db/schema/sessions";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requireAdminPermission } from "@/lib/auth/authorization";
import { writeAuditLog } from "@/lib/auth/audit";
import { normaliseEmail } from "@/lib/auth/email-normalize";
import { HttpError } from "@/lib/auth/errors";

type Params = { userId: string };

const ALLOWED_STATUS = new Set(["active", "suspended", "deleted"]);

type PatchBody = {
  email?: string;
  name?: string;
  avatarUrl?: string;
  status?: string;
};

// PATCH /api/admin/users/:id (Doc 2 §7.11 + правка 5).
//
// Email change has the largest blast radius:
//   1. normalise via the same canonicaliser the auth flow uses, so the
//      uniqueness check matches future logins.
//   2. 409 conflict.email_exists if another user holds that email.
//   3. UPDATE { email, email_raw, email_verified=false } — verification has
//      to be re-established on the new mailbox.
//   4. DELETE all sessions for that user — the cookie they're holding now
//      points at an account whose principal identifier just changed.
//   5. audit_log entry with old + new email so ops can reconstruct.
export const PATCH = protectedRoute<Params>(async ({ req, params, session }) => {
  await requireAdminPermission(session.user.id, "admin.users.update");
  const body = (await req.json().catch(() => ({}))) as PatchBody;

  const target = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      status: users.status,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(eq(users.id, params.userId))
    .limit(1);
  if (!target[0]) throw new HttpError(404, "not_found", "User not found");

  const update: Record<string, unknown> = {};
  let oldEmail: string | undefined;
  let newNormalisedEmail: string | undefined;

  if (typeof body.email === "string" && body.email.trim()) {
    const normalised = normaliseEmail(body.email);
    if (!normalised.includes("@")) {
      throw new HttpError(400, "validation.failed", "Invalid email");
    }
    if (normalised !== target[0].email) {
      const conflict = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, normalised), ne(users.id, params.userId)))
        .limit(1);
      if (conflict[0]) {
        throw new HttpError(
          409,
          "conflict.email_exists",
          "Email already in use",
        );
      }
      oldEmail = target[0].email;
      newNormalisedEmail = normalised;
      update.email = normalised;
      update.emailRaw = body.email.trim();
      update.emailVerified = false;
    }
  }
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (name.length > 80) {
      throw new HttpError(400, "validation.failed", "Name too long");
    }
    update.name = name || null;
  }
  if (typeof body.avatarUrl === "string") {
    update.avatarUrl = body.avatarUrl.trim() || null;
  }
  if (typeof body.status === "string") {
    const status = body.status.trim().toLowerCase();
    if (!ALLOWED_STATUS.has(status)) {
      throw new HttpError(400, "validation.failed", "Invalid status");
    }
    update.status = status;
  }
  if (Object.keys(update).length === 0) {
    throw new HttpError(400, "validation.failed", "No editable fields");
  }
  update.updatedAt = new Date();

  const [updated] = await db
    .update(users)
    .set(update)
    .where(eq(users.id, params.userId))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      status: users.status,
      emailVerified: users.emailVerified,
    });

  if (newNormalisedEmail) {
    // Invalidate every active session for that user — cookie is no longer
    // tied to the same principal identifier.
    await db.delete(sessions).where(eq(sessions.userId, params.userId));
  }

  await writeAuditLog({
    actorUserId: session.user.id,
    action: newNormalisedEmail
      ? "user.email_change_by_admin"
      : "user.update_by_admin",
    targetType: "user",
    targetId: params.userId,
    metadata: newNormalisedEmail
      ? { oldEmail, newEmail: newNormalisedEmail }
      : { fields: Object.keys(update).filter((k) => k !== "updatedAt") },
  });

  return NextResponse.json({ user: updated });
});
