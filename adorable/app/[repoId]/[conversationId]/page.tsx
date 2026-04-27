import { Assistant } from "../../assistant";
import { RepoWelcome } from "@/components/assistant-ui/repo-welcome";
import { getOrCreateIdentitySession } from "@/lib/identity-session";
import { readConversationMessages } from "@/lib/repo-storage";

const hasRepoAccess = async (repoId: string) => {
  const { identity } = await getOrCreateIdentitySession();
  const { repositories } = await identity.permissions.git.list({ limit: 200 });
  return repositories.some((repo) => repo.id === repoId);
};

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ repoId: string; conversationId: string }>;
}) {
  // Next.js 16 + Turbopack не декодит dynamic params в App Router —
  // "adorable%2Ffoo" приходит как есть. ACL хранит decoded repoId
  // ("adorable/foo"), поэтому без decode access всегда false и
  // initialMessages становится []. Декодим явно.
  const rawParams = await params;
  const repoId = decodeURIComponent(rawParams.repoId);
  const conversationId = decodeURIComponent(rawParams.conversationId);

  if (!(await hasRepoAccess(repoId))) {
    return (
      <Assistant
        initialMessages={[]}
        selectedRepoId={repoId}
        selectedConversationId={conversationId}
        welcome={<RepoWelcome />}
      />
    );
  }

  const initialMessages = await readConversationMessages(
    repoId,
    conversationId,
  );
  return (
    <Assistant
      initialMessages={initialMessages}
      selectedRepoId={repoId}
      selectedConversationId={conversationId}
      welcome={<RepoWelcome />}
    />
  );
}
