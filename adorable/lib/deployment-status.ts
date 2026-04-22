import { getGitProvider } from "@/lib/git/provider-singleton";

export const DEPLOYMENT_DOMAIN_SUFFIX =
  process.env["DEPLOYMENT_DOMAIN_SUFFIX"] ?? "deploy.localhost";

/**
 * Phase 5 (DeployProvider) will surface live deployment state. Until then,
 * `serverless.deployments.list()` returns an empty set, so `state` reflects
 * only the agent-running flag plus commit presence.
 */
type DeploymentEntryStub = {
  deploymentId: string | null;
  state: "building" | "deployed" | "failed";
  domains: string[];
};
const listDeployments = async (): Promise<{ entries: DeploymentEntryStub[] }> => {
  // TODO(phase-5): wire DeployProvider and return live state. For now the
  // UI gracefully handles "no entries" — commits without matching
  // deployments stay in "deploying" / "idle" depending on isAgentRunning.
  return { entries: [] };
};

export type DeploymentUiStatus = {
  state: "idle" | "deploying" | "live" | "failed";
  domain: string | null;
  url: string | null;
  commitSha: string | null;
  deploymentId: string | null;
  lastError: string | null;
  updatedAt: string;
};

export type DeploymentTimelineEntry = {
  commitSha: string;
  commitMessage: string;
  commitDate: string;
  domain: string;
  url: string;
  deploymentId: string | null;
  state: "idle" | "deploying" | "live" | "failed";
};

const isBootstrapCommit = (message: string | undefined) =>
  (message ?? "").trim().toLowerCase() === "initial commit";

export const getLatestCommitSha = async (repoId: string) => {
  const provider = await getGitProvider();
  const repo = provider.getRepo(repoId);
  const commits = await repo.commits.list({ limit: 50, order: "desc" });
  const latestUserCommit = commits.commits.find(
    (commit) => !isBootstrapCommit(commit.message),
  );
  return latestUserCommit?.sha ?? null;
};

export const getDomainForCommit = (commitSha: string) => {
  return `${commitSha.slice(0, 12)}-${DEPLOYMENT_DOMAIN_SUFFIX}`;
};

export const getDeploymentStatusForLatestCommit = async (
  repoId: string,
  isAgentRunning: boolean,
): Promise<DeploymentUiStatus> => {
  const commitSha = await getLatestCommitSha(repoId);
  const updatedAt = new Date().toISOString();

  if (!commitSha) {
    return {
      state: "idle",
      domain: null,
      url: null,
      commitSha: null,
      deploymentId: null,
      lastError: "No commits found for repository.",
      updatedAt,
    };
  }

  const domain = getDomainForCommit(commitSha);
  const { entries } = await listDeployments();

  const match = entries.find((entry) => entry.domains.includes(domain));

  if (!match) {
    return {
      state: isAgentRunning ? "deploying" : "idle",
      domain,
      url: `https://${domain}`,
      commitSha,
      deploymentId: null,
      lastError: null,
      updatedAt,
    };
  }

  const state: DeploymentUiStatus["state"] =
    match.state === "deployed"
      ? "live"
      : match.state === "failed"
        ? "failed"
        : "deploying";

  return {
    state,
    domain,
    url: `https://${domain}`,
    commitSha,
    deploymentId: match.deploymentId,
    lastError: state === "failed" ? "Deployment reported failed state." : null,
    updatedAt,
  };
};

export const getDeploymentTimelineFromCommits = async (
  repoId: string,
  limit = 12,
): Promise<DeploymentTimelineEntry[]> => {
  const provider = await getGitProvider();
  const repo = provider.getRepo(repoId);
  const commits = await repo.commits.list({
    limit: 50,
    order: "desc",
  });
  const { entries } = await listDeployments();

  const userCommits = commits.commits
    .filter((commit) => !isBootstrapCommit(commit.message))
    .slice(0, limit);

  return userCommits.map((commit) => {
    const domain = getDomainForCommit(commit.sha);
    const match = entries.find((entry) => entry.domains.includes(domain));

    const state: DeploymentTimelineEntry["state"] = !match
      ? "idle"
      : match.state === "deployed"
        ? "live"
        : match.state === "failed"
          ? "failed"
          : "deploying";

    return {
      commitSha: commit.sha,
      commitMessage: commit.message,
      commitDate: commit.author?.date ?? new Date().toISOString(),
      domain,
      url: `https://${domain}`,
      deploymentId: match?.deploymentId ?? null,
      state,
    };
  });
};
