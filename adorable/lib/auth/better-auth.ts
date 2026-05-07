// Better Auth instance — Phase 3 scope.
//
// Wires email/password + Google OAuth (when env is provided), strict no-link
// policy on accounts, and email normalisation through both an endpoint hook
// (so `/sign-in/email` looks up the canonical address) and a database hook
// (so the canonical address is what gets persisted, with the raw input
// preserved on `users.email_raw`).
//
// after.signUpEmail (org bootstrap) is intentionally NOT wired here — it
// belongs to Phase 4.

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createAuthMiddleware } from "better-auth/api";
import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { normaliseEmail } from "./email-normalize";
import { bootstrapNewUserIfMissing } from "./bootstrap";

// Endpoints where we rewrite body.email to its canonical form so the lookup
// finds the existing user. Sign-up is intentionally absent — the database hook
// normalises during the insert, so the original input survives in `emailRaw`.
const PATHS_NEEDING_EMAIL_NORMALISATION = new Set([
  "/sign-in/email",
  "/forget-password",
  "/forgot-password",
  "/request-password-reset",
  "/send-verification-email",
]);

const googleProvider =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      }
    : undefined;

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      account: schema.accounts,
      session: schema.sessions,
      verification: schema.verificationTokens,
      rateLimit: schema.rateLimit,
    },
  }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
  },
  socialProviders: googleProvider ? { google: googleProvider } : {},
  account: {
    accountLinking: { enabled: false },
    fields: {
      providerId: "provider",
      accountId: "providerAccountId",
    },
  },
  user: {
    fields: {
      // Better Auth uses `image`; our column is `avatar_url` (camelCase
      // `avatarUrl` in the drizzle schema).
      image: "avatarUrl",
    },
    additionalFields: {
      emailRaw: { type: "string", required: false },
      isAdmin: { type: "boolean", required: false, defaultValue: false },
      status: { type: "string", required: false, defaultValue: "active" },
      referrerId: { type: "string", required: false },
      referralCode: { type: "string", required: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  advanced: {
    // Our schema uses uuid PKs everywhere; tell Better Auth's adapter to
    // emit UUIDs instead of its default cuid-style IDs.
    database: { generateId: "uuid" },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 10,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60 * 60, max: 5 },
      "/forget-password": { window: 60 * 60, max: 3 },
      "/verify-email": { window: 60, max: 10 },
      "/callback/google": { window: 60, max: 10 },
      "/callback/yandex": { window: 60, max: 10 },
      "/callback/vk": { window: 60, max: 10 },
    },
    storage: "memory",
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const raw = (user as { email?: string }).email;
          if (typeof raw !== "string") return;
          return {
            data: {
              ...user,
              email: normaliseEmail(raw),
              emailRaw: raw,
            },
          };
        },
        // Spec §3.4 lives here — Better Auth fires `user.create.after` for
        // both email signups and first-time OAuth callbacks (i.e. it's
        // semantically equivalent to "isNewUser"). Failing to bootstrap must
        // not surface as a 500 to the auth flow; we log and let the user
        // through, and the missing-org branch will be re-tried lazily on
        // next request via bootstrapNewUserIfMissing.
        after: async (user) => {
          const userId = (user as { id?: string }).id;
          if (!userId) return;
          try {
            await bootstrapNewUserIfMissing(userId, {
              userName:
                ((user as { name?: string | null }).name ?? null) || null,
            });
          } catch (err) {
            console.error("[auth.bootstrap] failed for user", userId, err);
          }
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (!PATHS_NEEDING_EMAIL_NORMALISATION.has(ctx.path)) return;
      const body = ctx.body as { email?: unknown } | undefined;
      if (!body || typeof body.email !== "string") return;
      // Mutating the body in place is supported by Better Auth's middleware
      // contract — the request handler reads from the same object.
      body.email = normaliseEmail(body.email);
    }),
  },
});
