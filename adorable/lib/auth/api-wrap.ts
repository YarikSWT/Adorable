// Universal wrapper for protected Next.js route handlers.
//
// Responsibility split:
//   * `protectedRoute(handler)` — requires a session, hands it to the handler
//     along with the awaited route params, and converts any thrown HttpError
//     into the standard JSON envelope. Used for any route that needs a logged-in
//     user.
//   * `optionalSessionRoute(handler)` — same shape but session may be null
//     (e.g. /api/auth/* or /__published_authz where unauthenticated reads are
//     legitimate).
//   * `publicRoute(handler)` — no session lookup; just standard error mapping.
//
// We intentionally do NOT do per-route permission checks here — those belong
// in the handler so the call site is greppable. The wrapper only enforces
// "you have a session" so handlers don't need to repeat session loading.

import type { RequestSession } from "./session";
import { requireSession, getRequestSession } from "./session";
import { errorToResponse } from "./errors";

type RouteContext<P> = { params: Promise<P> };

type ProtectedHandler<P> = (ctx: {
  req: Request;
  params: P;
  session: RequestSession;
}) => Promise<Response>;

type OptionalSessionHandler<P> = (ctx: {
  req: Request;
  params: P;
  session: RequestSession | null;
}) => Promise<Response>;

type PublicHandler<P> = (ctx: {
  req: Request;
  params: P;
}) => Promise<Response>;

const logDuration = (label: string, t0: number) => {
  const ms = Date.now() - t0;
  // Cheap and grep-friendly. Replaced by a proper metrics export later.
  console.log(`[api-wrap] ${label} ${ms}ms`);
};

export const protectedRoute = <P>(handler: ProtectedHandler<P>) => {
  return async (req: Request, route: RouteContext<P>): Promise<Response> => {
    const t0 = Date.now();
    const url = new URL(req.url);
    try {
      const session = await requireSession();
      const params = await route.params;
      return await handler({ req, params, session });
    } catch (err) {
      return errorToResponse(err);
    } finally {
      logDuration(`${req.method} ${url.pathname}`, t0);
    }
  };
};

export const optionalSessionRoute = <P>(handler: OptionalSessionHandler<P>) => {
  return async (req: Request, route: RouteContext<P>): Promise<Response> => {
    const t0 = Date.now();
    const url = new URL(req.url);
    try {
      const session = await getRequestSession();
      const params = await route.params;
      return await handler({ req, params, session });
    } catch (err) {
      return errorToResponse(err);
    } finally {
      logDuration(`${req.method} ${url.pathname}`, t0);
    }
  };
};

export const publicRoute = <P>(handler: PublicHandler<P>) => {
  return async (req: Request, route: RouteContext<P>): Promise<Response> => {
    const t0 = Date.now();
    const url = new URL(req.url);
    try {
      const params = await route.params;
      return await handler({ req, params });
    } catch (err) {
      return errorToResponse(err);
    } finally {
      logDuration(`${req.method} ${url.pathname}`, t0);
    }
  };
};
