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

import { getOrCreateIdentitySession } from "@/lib/identity-session";
import { getBuildQueue } from "@/lib/preview/provider-singleton";

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
  const projectId = decodeURIComponent(rawId);

  const { identity } = await getOrCreateIdentitySession();
  const { repositories } = await identity.permissions.git.list({ limit: 200 });
  if (!repositories.some((r) => r.id === projectId)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const queue = getBuildQueue();
  const encoder = new TextEncoder();

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

      // 4. Tear down when client disconnects.
      req.signal.addEventListener("abort", () => {
        clearInterval(keepAlive);
        unsubscribe();
        close();
      });
    },
    cancel() {
      // Backup teardown if controller side is cancelled before request abort.
      // (subscribe/keepalive cleanup is handled inside `start()` via
      // request.signal — same path.)
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
