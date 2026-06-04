// Live verification server (NOT production) — boots the REAL agent-loop code
// paths (handle-agent-run worker + bridge + GET reconnect + stop + quota) over
// REAL Redis + Postgres, behind plain HTTP, so curl + playwright-mcp can verify
// the live UX with artifacts. Run: npx tsx scripts/agent-loop-live-server.ts
//
// Env: DATABASE_URL, REDIS_URL, PORT.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import { UI_MESSAGE_STREAM_HEADERS, tool, type LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import * as schema from "@/lib/db/schema";
import { users } from "@/lib/db/schema/users";
import { organizations } from "@/lib/db/schema/organizations";
import { projects } from "@/lib/db/schema/projects";
import { planOverrides } from "@/lib/db/schema/billing";
import { conversations } from "@/lib/db/schema/conversations";
import { runs } from "@/lib/db/schema/runs";
import { messages } from "@/lib/db/schema/messages";
import { handleAgentRun, type AgentRunDeps } from "@/lib/agent-run/handle-agent-run";
import {
  createStreamContext,
  bridgeFirstStream,
  resumeRunStream,
} from "@/lib/agent-run/stream";
import {
  loadLatestRunForConversation,
  loadRun,
} from "@/lib/agent-run/run-state";
import { stopRun } from "@/lib/agent-run/stop";
import { hasCancelFlag } from "@/lib/agent-run/cancel";
import { loadConversationUIMessages } from "@/lib/db/queries/transcript";
import {
  reserveQuota,
  reconcileUsage,
  releaseReservation,
} from "@/lib/agent-run/quota";

const DATABASE_URL = process.env.DATABASE_URL!;
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6399";
const PORT = Number(process.env.PORT ?? 7799);
const STEP_DELAY = Number(process.env.STEP_DELAY_MS ?? 400);

const sql = postgres(DATABASE_URL, { max: 8 });
const db = drizzle(sql, { schema });
const workerCtx = createStreamContext(REDIS_URL);
const bridgeCtx = createStreamContext(REDIS_URL);
const flagRedis = bridgeCtx.publisher;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Abort-aware sleep — a real provider cancels its in-flight HTTP stream on
// abort; the mock must do the same so stop interrupts mid-generation.
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

// 2-step mock model: text + writeFile tool-call, then closing text.
function mockModel(): LanguageModel {
  let call = 0;
  return new MockLanguageModelV3({
    modelId: "mock-main",
    provider: "mock",
    doStream: (async (options?: { abortSignal?: AbortSignal }) => {
      const signal = options?.abortSignal;
      const n = call++;
      if (n === 0) {
        return {
          stream: new ReadableStream({
            async start(c) {
              try {
              c.enqueue({ type: "stream-start", warnings: [] });
              c.enqueue({ type: "text-start", id: "t0" });
              await abortableSleep(STEP_DELAY, signal);
              c.enqueue({ type: "text-delta", id: "t0", delta: "Creating the file. " });
              c.enqueue({ type: "text-end", id: "t0" });
              c.enqueue({ type: "tool-input-start", id: "tc1", toolName: "writeFile" });
              c.enqueue({ type: "tool-input-delta", id: "tc1", delta: '{"path":"app.tsx","contents":"x"}' });
              c.enqueue({ type: "tool-input-end", id: "tc1" });
              c.enqueue({ type: "tool-call", toolCallId: "tc1", toolName: "writeFile", input: '{"path":"app.tsx","contents":"x"}' });
              c.enqueue({ type: "finish", finishReason: "tool-calls", usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 } });
              c.close();
              } catch { try { c.close(); } catch {} }
            },
          }),
        };
      }
      return {
        stream: new ReadableStream({
          async start(c) {
            try {
            c.enqueue({ type: "stream-start", warnings: [] });
            c.enqueue({ type: "text-start", id: "t1" });
            await abortableSleep(STEP_DELAY, signal);
            c.enqueue({ type: "text-delta", id: "t1", delta: "Done — the counter app is ready." });
            c.enqueue({ type: "text-end", id: "t1" });
            c.enqueue({ type: "finish", finishReason: "stop", usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 } });
            c.close();
            } catch { try { c.close(); } catch {} }
          },
        }),
      };
    }) as never,
  });
}

const writeFileTool = tool({
  description: "write a file",
  inputSchema: z.object({ path: z.string(), contents: z.string() }),
  execute: async ({ path }) => ({ ok: true, path }),
});

let seeded: { userId: string; organizationId: string; projectId: string; conversationId: string };

async function seed() {
  await migrate(db, { migrationsFolder: "lib/db/migrations" });
  const [u] = await db.insert(users).values({ email: `live-${Date.now()}@example.com` } as never).returning({ id: users.id });
  const [o] = await db.insert(organizations).values({ type: "personal", slug: `o-${Date.now()}`, name: "Live", ownerUserId: u.id } as never).returning({ id: organizations.id });
  await db.insert(planOverrides).values({ organizationId: o.id, limits: { "llm.tokens.monthly": 10_000_000 } } as never);
  const [p] = await db.insert(projects).values({ organizationId: o.id, slug: `p-${Date.now()}`, name: "Live Project", createdByUserId: u.id } as never).returning({ id: projects.id });
  const [c] = await db.insert(conversations).values({ projectId: p.id, userId: u.id }).returning({ id: conversations.id });
  seeded = { userId: u.id, organizationId: o.id, projectId: p.id, conversationId: c.id };
}

function makeDeps(): AgentRunDeps {
  return {
    db,
    streamCtx: workerCtx.ctx,
    buildModel: () => mockModel(),
    system: "You are a live test agent.",
    resolveSandbox: async () => ({ ensureHydrated: async () => undefined }),
    buildTools: () => ({ writeFile: writeFileTool }),
    gitCommit: async ({ branch, runId }) => {
      console.log(JSON.stringify({ ev: "gitCommit", branch, runId }));
    },
    recordUsage: async ({ runId, usage }) => {
      await reconcileUsage(db, { runId, organizationId: seeded.organizationId, userId: seeded.userId, projectId: seeded.projectId }, usage.inputTokens + usage.outputTokens);
    },
    releaseReservation: async (runId) => {
      await releaseReservation(db, { runId, organizationId: seeded.organizationId });
    },
    cancelChecker: (runId) => hasCancelFlag(flagRedis, runId),
    onCancelClear: async (runId) => { await flagRedis.del(`agent-run:cancel:${runId}`); },
    cancelPollMs: 300,
  };
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { return {}; }
}

async function pipeWebStream(stream: ReadableStream<string>, res: ServerResponse) {
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) res.write(value);
  }
  res.end();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean);
  try {
    // POST /api/chat — bridge: enqueue (in-proc worker) + resume the live stream.
    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await readBody(req);
      const conversationId = (body.conversationId as string) ?? seeded.conversationId;
      const prompt = (body.prompt as string) ?? "make a counter app";
      // reserve quota (reserve, not check-then-act)
      const runId = randomUUID();
      const reservation = await reserveQuota(db, { runId, organizationId: seeded.organizationId, userId: seeded.userId, projectId: seeded.projectId });
      if (!reservation.ok) { res.writeHead(429, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "quota_exceeded" })); return; }
      await db.insert(messages).values({ conversationId, role: "user", uiMessage: { id: randomUUID(), role: "user", parts: [{ type: "text", text: prompt }] } as never });
      await db.insert(runs).values({ id: runId, userId: seeded.userId, organizationId: seeded.organizationId, projectId: seeded.projectId, conversationId, prompt, modelKey: "mock-main", status: "queued" } as never);
      // in-proc "worker"
      void handleAgentRun({ runId, userId: seeded.userId, organizationId: seeded.organizationId, projectId: seeded.projectId, conversationId, modelKey: "mock-main" }, makeDeps());
      const stream = await bridgeFirstStream(bridgeCtx.ctx, db, runId, { timeoutMs: 20_000 });
      if (!stream) { res.writeHead(504, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "stream_start_timeout", runId })); return; }
      res.writeHead(200, { ...UI_MESSAGE_STREAM_HEADERS, "x-run-id": runId });
      await pipeWebStream(stream, res);
      return;
    }
    // GET /api/chat/:id/stream — reconnect
    if (req.method === "GET" && parts[0] === "api" && parts[1] === "chat" && parts[3] === "stream") {
      const conversationId = decodeURIComponent(parts[2]);
      const result = await resumeRunStream(bridgeCtx.ctx, db, conversationId);
      if (result.kind === "204") { res.writeHead(204, result.retryAfter ? { "Retry-After": String(result.retryAfter) } : {}); res.end(); return; }
      res.writeHead(200, UI_MESSAGE_STREAM_HEADERS);
      await pipeWebStream(result.stream, res);
      return;
    }
    // POST /api/chat/:id/stop
    if (req.method === "POST" && parts[0] === "api" && parts[1] === "chat" && parts[3] === "stop") {
      const conversationId = decodeURIComponent(parts[2]);
      const body = await readBody(req);
      const run = await loadLatestRunForConversation(db, conversationId);
      if (!run) { res.writeHead(404); res.end(); return; }
      const outcome = await stopRun({ db, redis: flagRedis }, run, body);
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ success: true, outcome })); return;
    }
    // GET /api/chat/:id — metadata + transcript
    if (req.method === "GET" && parts[0] === "api" && parts[1] === "chat" && parts.length === 3) {
      const conversationId = decodeURIComponent(parts[2]);
      const run = await loadLatestRunForConversation(db, conversationId);
      const msgs = await loadConversationUIMessages(db, conversationId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ run: run ? { id: run.id, status: run.status, activeStreamId: run.activeStreamId, stepCount: run.stepCount } : null, messages: msgs }));
      return;
    }
    // GET / — minimal streaming UI for playwright
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(HTML.replace("__CONV__", seeded.conversationId));
      return;
    }
    res.writeHead(404); res.end();
  } catch (e) {
    console.error("server error", e);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(e) }));
  }
});

const HTML = `<!doctype html><html><head><meta charset=utf-8><title>agent-loop live</title>
<style>body{font:14px monospace;padding:20px} #t{white-space:pre-wrap;border:1px solid #ccc;padding:12px;min-height:80px} .tool{color:#0a7}</style></head>
<body><h3>agent-loop live bridge</h3><button id=send>Send prompt</button> <button id=stop>Stop</button> <span id=status>idle</span>
<div id=t></div>
<script>
const conv="__CONV__";
document.getElementById('send').onclick=async()=>{
  document.getElementById('status').textContent='streaming';
  const t=document.getElementById('t'); t.textContent='';
  const res=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId:conv,prompt:'make a counter app'})});
  const reader=res.body.getReader(); const dec=new TextDecoder(); let buf='';
  for(;;){const {done,value}=await reader.read(); if(done)break; buf+=dec.decode(value,{stream:true});
    const recs=buf.split('\\n\\n'); buf=recs.pop();
    for(const r of recs){const line=r.split('\\n').find(l=>l.startsWith('data: ')); if(!line)continue; const p=line.slice(6); if(p==='[DONE]')continue;
      try{const j=JSON.parse(p);
        if(j.type==='text-delta') t.textContent+=j.delta;
        if(j.type&&j.type.indexOf('tool-')===0){const d=document.createElement('div'); d.className='tool'; d.textContent='[tool: '+j.type+(j.toolName?' '+j.toolName:'')+']'; t.appendChild(d);}
      }catch(e){}
    }
  }
  document.getElementById('status').textContent='done';
};
let curRun=null;
document.getElementById('stop').onclick=async()=>{
  await fetch('/api/chat/'+conv+'/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  document.getElementById('status').textContent='stopped';
};
</script></body></html>`;

async function main() {
  await seed();
  server.listen(PORT, () => {
    console.log(JSON.stringify({ ev: "ready", port: PORT, ...seeded }));
  });
}
main().catch((e) => { console.error("fatal", e); process.exit(1); });
