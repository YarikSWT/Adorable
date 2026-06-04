// GET /api/chat/:id/stream — resume the worker's live stream for reconnect
// (спец v2.1 §4.2). `:id` is the conversationId. 204+Retry-After in the brief
// enqueue→setActiveStream window (front retries); plain 204 when terminal / no
// active stream (front loads history from GET /api/chat/:id). The bridge/resume
// logic is the tested resumeRunStream helper.

import { db } from "@/lib/db/client";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { getStreamContext } from "@/lib/agent-run/app-singletons";
import { resumeRunStream } from "@/lib/agent-run/stream";
import { loadLatestRunForConversation } from "@/lib/agent-run/run-state";

type Params = { id: string };

export const GET = protectedRoute<Params>(async ({ params, session }) => {
  // Ownership: the latest run of this conversation must belong to the caller.
  const run = await loadLatestRunForConversation(db, params.id);
  if (run && run.userId !== session.user.id) {
    return new Response(null, { status: 404 });
  }

  const ctx = getStreamContext();
  const res = await resumeRunStream(ctx.ctx, db, params.id);
  if (res.kind === "204") {
    return new Response(null, {
      status: 204,
      headers: res.retryAfter
        ? { "Retry-After": String(res.retryAfter) }
        : undefined,
    });
  }
  return new Response(res.stream as unknown as BodyInit, {
    headers: UI_MESSAGE_STREAM_HEADERS,
  });
});
