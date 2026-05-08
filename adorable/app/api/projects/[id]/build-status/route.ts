// GET /api/projects/[id]/build-status — Server-Sent Events.
//
// Контракт: docs/preview-provider/CONTRACTS.md §15.
//
//   Response: text/event-stream
//
//   event: status
//   data: <JSON BuildEvent>
//
//   :keep-alive  (every 30s — comment line, ignored by EventSource)
//
//   Клиент отписывается через abort fetch'а. Сервер слушает request.signal
//   и закрывает stream.
//
// На connect (включая reconnect после рестарта builder'а) шлём
// snapshot текущего state'а одним event'ом, если есть running/queued.
// Если нет активного job'а — никаких events до следующего enqueue.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema/projects";
import { getBuildQueue } from "@/lib/preview/provider-singleton";
import { getRequestSession } from "@/lib/auth/session";
import { getProjectAccessContext } from "@/lib/auth/authorization";
import {
  getProjectByGiteaWrapperId,
  type ProjectRow,
} from "@/lib/db/queries/projects";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const resolveProject = async (raw: string): Promise<ProjectRow | null> => {
  const decoded = decodeURIComponent(raw);
  if (UUID_RE.test(decoded)) {
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.id, decoded))
      .limit(1);
    if (rows[0]) return rows[0];
  }
  return getProjectByGiteaWrapperId(decoded);
};

const DEFAULT_KEEP_ALIVE_MS = 30_000;

// Test-friendly override — production never sets this. Tests pin a small
// value so they can assert keep-alive comments arrive within reasonable
// wait time.
const resolveKeepAliveMs = (): number => {
  const raw = process.env["SSE_KEEP_ALIVE_MS"];
  if (!raw) return DEFAULT_KEEP_ALIVE_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_KEEP_ALIVE_MS;
};

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  // SSE route can't use protectedRoute (it returns a streaming Response,
  // not a regular one). Inline the session/perm checks instead.
  const session = await getRequestSession();
  if (!session) {
    return new Response(
      JSON.stringify({ error: { code: "auth.unauthenticated" } }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  const project = await resolveProject(rawId);
  if (!project) {
    return new Response(
      JSON.stringify({ error: { code: "not_found" } }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }
  const access = await getProjectAccessContext(session.user.id, project.id);
  if (!access || !access.permissions.has("project.view")) {
    return new Response(
      JSON.stringify({ error: { code: "access.denied" } }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  // Build queue keyed on the source-repo identifier the PreviewProvider
  // uses internally (== sourceRepoId, == giteaRepoId).
  const projectId =
    project.giteaRepoId ?? project.giteaWrapperRepoId ?? project.id;
  const queue = getBuildQueue();
  const encoder = new TextEncoder();

  // Cleanup handle shared between req.signal abort and ReadableStream
  // cancel() — whichever fires first frees the resources, the other
  // becomes a no-op via the `closed` flag.
  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const send = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const sendEvent = (eventName: string, data: unknown): void => {
        send(`event: ${eventName}\n`);
        send(`data: ${JSON.stringify(data)}\n\n`);
      };

      // 1. Initial snapshot — running first, then queued (if any).
      const active = queue.getActive(projectId);
      if (active) {
        sendEvent("status", {
          jobId: active.jobId,
          projectId,
          status: active.status,
          at: active.startedAt ?? active.enqueuedAt,
        });
      }
      const queued = queue.getQueued(projectId);
      if (queued) {
        sendEvent("status", {
          jobId: queued.jobId,
          projectId,
          status: queued.status,
          at: queued.enqueuedAt,
        });
      }

      // 2. Subscribe to subsequent events.
      const unsubscribe = queue.subscribe(projectId, (event) => {
        sendEvent("status", event);
      });

      // 3. Periodic keep-alive (so proxies don't time the connection out).
      const keepAlive = setInterval(() => {
        send(":keep-alive\n\n");
      }, resolveKeepAliveMs());

      cleanup = (): void => {
        clearInterval(keepAlive);
        unsubscribe();
        close();
      };

      // 4. Tear down when client disconnects.
      req.signal.addEventListener("abort", () => {
        cleanup?.();
      });
    },
    cancel() {
      // Fires when the consumer side cancels (e.g., Next.js tears the
      // response down without req.signal having fired yet). Run the
      // same cleanup so we don't leak a setInterval + queue listener.
      cleanup?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx/Caddy buffering
    },
  });
}
