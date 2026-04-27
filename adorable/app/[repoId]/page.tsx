import { Assistant } from "../assistant";
import { RepoWelcome } from "@/components/assistant-ui/repo-welcome";

export default async function RepoPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const rawParams = await params;
  // Next.js 16 + Turbopack не декодит dynamic params в App Router.
  const repoId = decodeURIComponent(rawParams.repoId);
  return (
    <Assistant
      initialMessages={[]}
      selectedRepoId={repoId}
      selectedConversationId={null}
      welcome={<RepoWelcome />}
    />
  );
}
