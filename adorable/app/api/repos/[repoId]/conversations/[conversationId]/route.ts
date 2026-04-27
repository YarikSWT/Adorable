import { NextResponse } from "next/server";
import { getOrCreateIdentitySession } from "@/lib/identity-session";
import { readConversationMessages } from "@/lib/repo-storage";

const assertRepoAccess = async (repoId: string) => {
  const { identity } = await getOrCreateIdentitySession();
  const { repositories } = await identity.permissions.git.list({ limit: 200 });
  return repositories.some((repo) => repo.id === repoId);
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ repoId: string; conversationId: string }> },
) {
  // Next 16 не декодит dynamic params — decode'им вручную.
  const raw = await params;
  const repoId = decodeURIComponent(raw.repoId);
  const conversationId = decodeURIComponent(raw.conversationId);

  if (!(await assertRepoAccess(repoId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const messages = await readConversationMessages(repoId, conversationId);
  return NextResponse.json({ messages });
}
