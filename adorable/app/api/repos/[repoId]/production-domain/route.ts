import { NextResponse } from "next/server";
import { readRepoMetadata, setRepoProductionDomain } from "@/lib/repo-storage";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requirePermission } from "@/lib/auth/authorization";
import { getProjectByGiteaWrapperId } from "@/lib/db/queries/projects";
import { HttpError } from "@/lib/auth/errors";

const PRODUCTION_SUFFIX = ".style.dev";

const normalizeDomain = (domain: string) => {
  const trimmed = domain.trim().toLowerCase();
  const withoutProtocol = trimmed.replace(/^https?:\/\//, "");
  return withoutProtocol.split("/")[0] ?? "";
};

const isValidProductionDomain = (domain: string) => {
  return (
    domain.endsWith(PRODUCTION_SUFFIX) &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]+)*\.style\.dev$/.test(
      domain,
    )
  );
};

export const POST = protectedRoute<{ repoId: string }>(
  async ({ req, params, session }) => {
    const repoId = decodeURIComponent(params.repoId);
    const project = await getProjectByGiteaWrapperId(repoId);
    if (!project) throw new HttpError(404, "not_found", "Project not found");
    await requirePermission(session.user.id, "project.domain.manage", {
      projectId: project.id,
    });

    let requestedDomain = "";
    try {
      const payload = (await req.json()) as { domain?: string };
      requestedDomain = payload?.domain ?? "";
    } catch {
      requestedDomain = "";
    }

    const domain = normalizeDomain(requestedDomain);
    if (!domain || !isValidProductionDomain(domain)) {
      throw new HttpError(
        400,
        "validation.failed",
        "Domain must be a valid hostname ending in .style.dev",
      );
    }

    const metadata = await readRepoMetadata(repoId);
    if (!metadata) {
      throw new HttpError(404, "not_found", "Repository metadata not found");
    }

    const nextMetadata = await setRepoProductionDomain(repoId, metadata, domain);

    return NextResponse.json({
      productionDomain: nextMetadata.productionDomain,
      productionDeploymentId: nextMetadata.productionDeploymentId,
    });
  },
);
