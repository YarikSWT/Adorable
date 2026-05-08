// Request-scoped session helpers — used by every protected API route.
//
// `getRequestSession` is a non-throwing read; `requireSession` is the strict
// variant that throws an HttpError(401). Email-verification gating is split
// into `requireEmailVerified` so individual handlers can opt in/out
// (e.g. /api/me works without verification, /api/repos POST does not).

import { headers } from "next/headers";
import { auth } from "./better-auth";
import { HttpError } from "./errors";

export type RequestSession = {
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    isAdmin: boolean;
    status: "active" | "suspended" | "deleted";
  };
  sessionId: string;
};

export const getRequestSession = async (): Promise<RequestSession | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const rawStatus = (session.user as { status?: unknown }).status;
  const status: RequestSession["user"]["status"] =
    rawStatus === "suspended" || rawStatus === "deleted"
      ? rawStatus
      : "active";
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      emailVerified: session.user.emailVerified === true,
      isAdmin:
        (session.user as { isAdmin?: unknown }).isAdmin === true,
      status,
    },
    sessionId: session.session.id,
  };
};

export const requireSession = async (): Promise<RequestSession> => {
  const s = await getRequestSession();
  if (!s) throw new HttpError(401, "auth.unauthenticated", "Login required");
  // Suspended/deleted accounts keep a Better Auth session token until it
  // expires, but they're locked out of every protected surface (Doc 2 §7.11
  // — admin can suspend; the contract is "loses access immediately"). The
  // suspend handler also nukes sessions, so this is a defence in depth for
  // tokens issued before the suspend.
  if (s.user.status === "suspended" || s.user.status === "deleted") {
    throw new HttpError(
      423,
      "auth.account_suspended",
      "Аккаунт временно недоступен. Свяжитесь с поддержкой.",
    );
  }
  return s;
};

export const requireEmailVerified = (s: RequestSession): RequestSession => {
  if (!s.user.emailVerified) {
    throw new HttpError(
      423,
      "auth.email_not_verified",
      "Подтвердите email прежде чем выполнять это действие",
    );
  }
  return s;
};
