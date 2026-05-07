// Initial admin seed.
//
// Reads INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD. If both are set and the
// user does not yet exist, signs them up through Better Auth (so the password
// gets the proper scrypt hash) and then flips is_admin + grants the
// `admin.superadmin` role. Idempotent — re-runs are no-ops.
//
// Phase 2 ↔ Phase 3 dependency: Better Auth lives in lib/auth/better-auth.ts
// and is created in Phase 3. We dynamically import it; if the module isn't
// there yet, we log and skip cleanly so `db:reset` still works during Phase 2.

import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { users } from "../schema/users";
import { adminRoleAssignments } from "../schema/organizations";
import { roles } from "../schema/roles";

export const seedInitialAdmin = async (): Promise<void> => {
  const email = process.env.INITIAL_ADMIN_EMAIL;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log(
      "[seed] INITIAL_ADMIN_EMAIL / _PASSWORD not set — skipping admin seed",
    );
    return;
  }

  const existing = await db
    .select({ id: users.id, isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);

  let userId = existing[0]?.id;

  if (!userId) {
    const auth = await loadBetterAuthOrNull();
    if (!auth) {
      console.warn(
        "[seed] lib/auth/better-auth.ts not available yet — admin seed will run on next db:reset after Phase 3 is in place",
      );
      return;
    }
    const result = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name: "Initial Admin",
      },
    });
    const created = (result as { user?: { id?: string } } | null)?.user;
    if (!created?.id) {
      throw new Error("[seed] Better Auth signUpEmail returned no user id");
    }
    userId = created.id;
  }

  await db
    .update(users)
    .set({ isAdmin: true, emailVerified: true })
    .where(eq(users.id, userId));

  const superadminRole = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.scope, "admin"), eq(roles.slug, "superadmin")))
    .limit(1);

  if (!superadminRole[0]) {
    throw new Error(
      "[seed] admin.superadmin role not found — run roles-permissions seed first",
    );
  }

  await db
    .insert(adminRoleAssignments)
    .values({ userId, roleId: superadminRole[0].id })
    .onConflictDoNothing({
      target: [adminRoleAssignments.userId, adminRoleAssignments.roleId],
    });
};

const loadBetterAuthOrNull = async (): Promise<{
  api: { signUpEmail: (args: { body: unknown }) => Promise<unknown> };
} | null> => {
  try {
    // Dynamic path keeps TypeScript from resolving the (Phase 3) module at
    // typecheck time. The seed must work before lib/auth/better-auth.ts
    // exists.
    const modulePath = ["..", "..", "auth", "better-auth"].join("/");
    const dynamicImport = new Function(
      "p",
      "return import(p)",
    ) as (p: string) => Promise<unknown>;
    const mod = await dynamicImport(modulePath);
    const auth = (mod as { auth?: unknown }).auth;
    if (
      auth &&
      typeof auth === "object" &&
      "api" in auth &&
      typeof (auth as { api: { signUpEmail?: unknown } }).api.signUpEmail ===
        "function"
    ) {
      return auth as {
        api: {
          signUpEmail: (args: { body: unknown }) => Promise<unknown>;
        };
      };
    }
    return null;
  } catch {
    return null;
  }
};
