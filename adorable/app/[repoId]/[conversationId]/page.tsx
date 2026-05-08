import { Assistant } from "../../assistant";
import { RepoWelcome } from "@/components/assistant-ui/repo-welcome";
import { readConversationMessages } from "@/lib/repo-storage";
import { getRequestSession } from "@/lib/auth/session";
import { getProjectAccessContext } from "@/lib/auth/authorization";
import { getProjectByGiteaWrapperId } from "@/lib/db/queries/projects";

const hasRepoAccess = async (repoId: string): Promise<boolean> => {
  const session = await getRequestSession();
  if (!session) return false;
  const project = await getProjectByGiteaWrapperId(repoId);
  if (!project) return false;
  const access = await getProjectAccessContext(session.user.id, project.id);
  return access != null && access.permissions.has("project.view");
};

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ repoId: string; conversationId: string }>;
}) {
  // Next.js 16 + Turbopack не декодит dynamic params в App Router —
  // "adorable%2Ffoo" приходит как есть. Гитеа repoId хранится как
  // "owner/name" — декодим явно.
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
