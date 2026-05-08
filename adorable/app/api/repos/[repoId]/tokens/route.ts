import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { db } from "@/lib/db/client";
import { projectTokens } from "@/lib/db/schema/tokens";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requirePermission } from "@/lib/auth/authorization";
import { writeAuditLog } from "@/lib/auth/audit";
import { getProjectByGiteaWrapperId } from "@/lib/db/queries/projects";
import { HttpError } from "@/lib/auth/errors";

type Params = { repoId: string };

const KIND_PREFIX: Record<string, string> = {
  public: "pk_live_",
  server: "sk_live_",
  export: "xp_live_",
};

const ALLOWED_KINDS = new Set(Object.keys(KIND_PREFIX));

const issueToken = (
  kind: keyof typeof KIND_PREFIX,
): { plaintext: string; prefix: string } => {
  // 24 url-safe bytes ≈ 32 chars after base64url. Add the kind prefix in
  // front so server-side parsing can route on it cheaply.
  const body = randomBytes(24).toString("base64url");
  const prefixForBucket = body.slice(0, 8);
  return {
    plaintext: `${KIND_PREFIX[kind]}${body}`,
    prefix: prefixForBucket,
  };
};

const stripRevoked = (
  rows: Awaited<ReturnType<typeof listTokens>>,
): Awaited<ReturnType<typeof listTokens>> =>
  rows.filter((r) => !r.revokedAt || r.revokedAt > new Date());

const listTokens = async (projectId: string) =>
  db
    .select({
      id: projectTokens.id,
      kind: projectTokens.kind,
      name: projectTokens.name,
      tokenPrefix: projectTokens.tokenPrefix,
      createdAt: projectTokens.createdAt,
      lastUsedAt: projectTokens.lastUsedAt,
      expiresAt: projectTokens.expiresAt,
      revokedAt: projectTokens.revokedAt,
    })
    .from(projectTokens)
    .where(eq(projectTokens.projectId, projectId));

export const GET = protectedRoute<Params>(async ({ params, session }) => {
  const project = await getProjectByGiteaWrapperId(params.repoId);
  if (!project) throw new HttpError(404, "not_found", "Project not found");
  await requirePermission(session.user.id, "project.tokens.manage", {
    projectId: project.id,
  });
  const tokens = await listTokens(project.id);
  // Surfaces both active and revoked tokens; UI dims the revoked ones. We do
  // NOT filter them out here so admins can audit revoked-but-not-deleted
  // entries.
  void stripRevoked;
  return NextResponse.json({ tokens });
});

type CreateBody = {
  name?: string;
  kind?: string;
  expiresInDays?: number;
};

export const POST = protectedRoute<Params>(async ({ req, params, session }) => {
  const project = await getProjectByGiteaWrapperId(params.repoId);
  if (!project) throw new HttpError(404, "not_found", "Project not found");
  await requirePermission(session.user.id, "project.tokens.manage", {
    projectId: project.id,
  });
  const body = (await req.json().catch(() => ({}))) as CreateBody;
  const name = (body.name ?? "").trim();
  const kind = (body.kind ?? "").trim();
  if (!name || name.length > 60) {
    throw new HttpError(400, "validation.failed", "name must be 1..60 chars");
  }
  if (!ALLOWED_KINDS.has(kind)) {
    throw new HttpError(
      400,
      "validation.failed",
      `kind must be one of ${[...ALLOWED_KINDS].join(", ")}`,
    );
  }
  const expiresAt =
    typeof body.expiresInDays === "number" && body.expiresInDays > 0
      ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

  const issued = issueToken(kind as keyof typeof KIND_PREFIX);
  const tokenHash = await argon2.hash(issued.plaintext, {
    type: argon2.argon2id,
  });
  const [created] = await db
    .insert(projectTokens)
    .values({
      projectId: project.id,
      kind: kind as "public" | "server" | "export",
      name,
      tokenHash,
      tokenPrefix: issued.prefix,
      createdBy: session.user.id,
      expiresAt: expiresAt ?? undefined,
    })
    .returning({
      id: projectTokens.id,
      tokenPrefix: projectTokens.tokenPrefix,
      createdAt: projectTokens.createdAt,
      expiresAt: projectTokens.expiresAt,
    });

  await writeAuditLog({
    actorUserId: session.user.id,
    action: "project.token_issue",
    targetType: "project",
    targetId: project.id,
    organizationId: project.organizationId,
    metadata: { tokenId: created.id, kind, name },
  });

  // Plaintext is returned ONLY here. Subsequent GETs expose only the prefix.
  return NextResponse.json({
    id: created.id,
    kind,
    name,
    token: issued.plaintext,
    tokenPrefix: created.tokenPrefix,
    createdAt: created.createdAt,
    expiresAt: created.expiresAt,
  });
});
