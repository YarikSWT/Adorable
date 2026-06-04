// POST /api/chat/:id/stop — explicit stop (спец v2.1 §4.3). `:id` is the
// conversationId. Branches by status (queued → cancelled+release; running →
// cancelling+flag) via the tested stopRun helper. NEVER called from navigation/
// cleanup — only an explicit Stop button.

import { db } from "@/lib/db/client";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { loadLatestRunForConversation } from "@/lib/agent-run/run-state";
import { stopRun, type StopBody } from "@/lib/agent-run/stop";
import { upsertAssistantMessage } from "@/lib/db/queries/transcript";
import { getBoss, getStreamContext } from "@/lib/agent-run/app-singletons";
import { AGENT_RUN_QUEUE } from "@/lib/agent-run/queue";

type Params = { id: string };

export const POST = protectedRoute<Params>(async ({ req, params, session }) => {
  const run = await loadLatestRunForConversation(db, params.id);
  if (!run || run.userId !== session.user.id) {
    return new Response("Not found", { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as StopBody;
  const ctx = getStreamContext();
  const boss = await getBoss();

  const outcome = await stopRun(
    {
      db,
      redis: ctx.publisher,
      boss: { cancel: (jobId) => boss.cancel(AGENT_RUN_QUEUE, jobId) },
      upsertSnapshot: (args) => upsertAssistantMessage(db, args),
    },
    run,
    body,
  );

  return Response.json({ success: true, outcome });
});
