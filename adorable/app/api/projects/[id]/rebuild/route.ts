// POST /api/projects/[id]/rebuild
//
// Контракт: docs/preview-provider/CONTRACTS.md §17.
//
//   Body: {} (пусто)
//   Response 200: { jobId: "uuid", status: "queued" | "running" }
//   Response 403: { error: "Forbidden" } — caller не владеет проектом.
//   Response 403: { error: "manualRebuild not supported" } — provider
//     с capabilities.manualRebuild=false (sandbox-режим до Phase 4).
//   Response 404: { error: "Repository not found" } — repo нет в Gitea.
//
// UI делает client-side debounce ~500мс перед вызовом (ADR-012).
// LLM имеет аналогичный requestRebuildTool — тоже сюда.

import { NextResponse } from "next/server";

import { getOrCreateIdentitySession } from "@/lib/identity-session";
import {
  getBuildQueue,
  getPreviewProvider,
} from "@/lib/preview/provider-singleton";
import { getSharedAuditLogger } from "@/lib/sandbox/audit-log";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const projectId = decodeURIComponent(rawId);

  // Identity check — only repo owner can rebuild.
  const { identity } = await getOrCreateIdentitySession();
  const { repositories } = await identity.permissions.git.list({ limit: 200 });
  if (!repositories.some((r) => r.id === projectId)) {
    void getSharedAuditLogger()
      .log({
        event: "auth_denied",
        projectId,
        action: "rebuild",
        reason: "caller has no grant on repo",
      })
      .catch(() => undefined);
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Capability check — sandbox provider returns build={succeeded:stub},
  // но всё равно обозначим intent: только static-режим должен быть
  // здесь активен. Если provider declares manualRebuild=false — отказ.
  const provider = await getPreviewProvider();
  if (!provider.capabilities.manualRebuild) {
    return NextResponse.json(
      { error: "manualRebuild not supported by provider" },
      { status: 403 },
    );
  }

  const queue = getBuildQueue();
  const result = await queue.enqueue({ projectId, reason: "manual" });
  return NextResponse.json(result);
}
