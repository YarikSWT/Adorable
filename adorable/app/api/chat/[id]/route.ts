// GET /api/chat/:id — run metadata + transcript for hydrating useChat
// initialMessages (спец v2.1 §4.4). `:id` is the conversationId. The front uses
// run.status to decide: running → useChat({ resume:true }) attaches to the
// stream; terminal → just render the history.

import { db } from "@/lib/db/client";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { loadLatestRunForConversation } from "@/lib/agent-run/run-state";
import { loadConversationUIMessages } from "@/lib/db/queries/transcript";

type Params = { id: string };

export const GET = protectedRoute<Params>(async ({ params, session }) => {
  const run = await loadLatestRunForConversation(db, params.id);
  if (run && run.userId !== session.user.id) {
    return new Response(null, { status: 404 });
  }
  const messages = await loadConversationUIMessages(db, params.id);
  return Response.json({
    run: run
      ? {
          id: run.id,
          status: run.status,
          activeStreamId: run.activeStreamId,
          stepCount: run.stepCount,
          createdAt: run.createdAt,
          finishedAt: run.finishedAt,
        }
      : null,
    messages,
  });
});
