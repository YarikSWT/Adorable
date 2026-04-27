import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getOrCreateIdentitySession } from "@/lib/identity-session";
import { createConversationInRepo, readRepoMetadata } from "@/lib/repo-storage";

const assertRepoAccess = async (repoId: string) => {
  const { identity } = await getOrCreateIdentitySession();
  const { repositories } = await identity.permissions.git.list({ limit: 200 });
  return repositories.some((repo) => repo.id === repoId);
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ repoId: string }> },
) {
  // Next 16 не декодит dynamic params — repoId с "%2F" иначе ломает ACL.
  const { repoId: rawRepoId } = await params;
  const repoId = decodeURIComponent(rawRepoId);

  if (!(await assertRepoAccess(repoId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const metadata = await readRepoMetadata(repoId);
  if (!metadata) {
    return NextResponse.json(
      { error: "Repository metadata not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ conversations: metadata.conversations });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ repoId: string }> },
) {
  // Next 16 не декодит dynamic params — repoId с "%2F" иначе ломает ACL.
  const { repoId: rawRepoId } = await params;
  const repoId = decodeURIComponent(rawRepoId);

  let requestedTitle: string | undefined;
  try {
    const payload = (await req.json()) as { title?: string };
    const nextTitle = payload?.title?.trim();
    requestedTitle = nextTitle ? nextTitle : undefined;
  } catch {
    requestedTitle = undefined;
  }

  if (!(await assertRepoAccess(repoId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const metadata = await readRepoMetadata(repoId);
  if (!metadata) {
    return NextResponse.json(
      { error: "Repository metadata not found" },
      { status: 404 },
    );
  }

  const conversationId = randomUUID();
  const next = await createConversationInRepo(
    repoId,
    metadata,
    conversationId,
    requestedTitle,
  );

  return NextResponse.json({
    conversationId,
    conversations: next.conversations,
  });
}
