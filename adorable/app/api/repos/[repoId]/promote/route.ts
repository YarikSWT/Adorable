import { NextResponse } from "next/server";
import { getOrCreateIdentitySession } from "@/lib/identity-session";
import {
  promoteRepoDeploymentToProduction,
  readRepoMetadata,
} from "@/lib/repo-storage";

const assertRepoAccess = async (repoId: string) => {
  const { identity } = await getOrCreateIdentitySession();
  const { repositories } = await identity.permissions.git.list({ limit: 200 });
  return repositories.some((repo) => repo.id === repoId);
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ repoId: string }> },
) {
  const { repoId } = await params;

  if (!(await assertRepoAccess(repoId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let deploymentId = "";
  try {
    const payload = (await req.json()) as { deploymentId?: string };
    deploymentId = payload?.deploymentId?.trim() ?? "";
  } catch {
    deploymentId = "";
  }

  if (!deploymentId) {
    return NextResponse.json(
      { error: "deploymentId is required" },
      { status: 400 },
    );
  }

  const metadata = await readRepoMetadata(repoId);
  if (!metadata) {
    return NextResponse.json(
      { error: "Repository metadata not found" },
      { status: 404 },
    );
  }

  if (!metadata.productionDomain) {
    return NextResponse.json(
      { error: "Configure a production domain ending in .style.dev first" },
      { status: 400 },
    );
  }

  // TODO(phase-4): wire ProxyProvider.addRoute to point
  // `metadata.productionDomain` at the deployment's serving upstream.
  // Until then, promote just records the mapping in repo metadata.
  const nextMetadata = await promoteRepoDeploymentToProduction(
    repoId,
    metadata,
    deploymentId,
  );

  return NextResponse.json({
    productionDomain: nextMetadata.productionDomain,
    productionDeploymentId: nextMetadata.productionDeploymentId,
  });
}
