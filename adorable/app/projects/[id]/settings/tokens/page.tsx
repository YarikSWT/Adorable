import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema/projects";
import { TokensClient } from "./tokens-client";

export default async function TokensPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rows = await db
    .select({
      id: projects.id,
      giteaWrapperRepoId: projects.giteaWrapperRepoId,
    })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  const project = rows[0];
  if (!project) return null;
  // The token API is keyed on giteaWrapperRepoId (URL-segment compat with
  // the rest of /api/repos/:repoId/* — see Doc 2 §7.4 + Appendix A).
  const wrapperId = project.giteaWrapperRepoId ?? project.id;
  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-lg font-semibold">Tokens</h1>
      <TokensClient repoId={wrapperId} />
    </div>
  );
}
