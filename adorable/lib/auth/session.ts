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
  };
  sessionId: string;
};

export const getRequestSession = async (): Promise<RequestSession | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      emailVerified: session.user.emailVerified === true,
      isAdmin:
        (session.user as { isAdmin?: unknown }).isAdmin === true,
    },
    sessionId: session.session.id,
  };
};

export const requireSession = async (): Promise<RequestSession> => {
  const s = await getRequestSession();
  if (!s) throw new HttpError(401, "auth.unauthenticated", "Login required");
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
