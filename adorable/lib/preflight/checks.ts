// Pure preflight checks — invoked by `scripts/preflight-static.ts`
// before an operator flips PREVIEW_PROVIDER default to "static" or
// runs migrate-repo-to-static.ts en masse.
//
// Each check is a pure function over an injected environment. The CLI
// wraps these with the actual fs/network calls. Pure structure means
// the alert-style table is unit-testable on synthetic inputs.
//
// Severity:
//   "fail" — blocks the switch. Operator MUST fix before proceeding.
//   "warn" — strong recommendation, not blocking.
//   "ok"   — green check.

import { promises as fsp } from "node:fs";

export type CheckSeverity = "ok" | "warn" | "fail";

export interface CheckResult {
  name: string;
  severity: CheckSeverity;
  message: string;
  /** Optional: how to fix. Surfaced when severity != "ok". */
  remediation?: string;
}

// ---------------------------------------------------------------------------
// Env-var presence checks
// ---------------------------------------------------------------------------

// Required for any static-mode operation.
export const REQUIRED_ENV_VARS = [
  "PREVIEW_PROVIDER",
  "PROJECTS_ROOT",
  "STATIC_ROOT",
] as const;

// Recommended; absence means the default is fine for single-node dev
// but might be wrong for split-host (Caddy in separate container).
export const RECOMMENDED_ENV_VARS = [
  "CADDY_STATIC_ROOT",
  "BUILD_RUNNER_NETWORK",
  "BUILD_RUNNER_TIMEOUT_MS",
  "BUILD_WAIT_DEADLINE_BUFFER_MS",
  "SANDBOX_AUDIT_LOG",
] as const;

export const checkRequiredEnvVar = (
  name: string,
  env: Readonly<Record<string, string | undefined>>,
): CheckResult => {
  const v = env[name];
  if (v === undefined || v === "") {
    return {
      name: `env.${name}`,
      severity: "fail",
      message: `${name} is not set`,
      remediation: `set ${name} in .env (see .env.example for canonical defaults)`,
    };
  }
  return {
    name: `env.${name}`,
    severity: "ok",
    message: `${name}=${v}`,
  };
};

export const checkRecommendedEnvVar = (
  name: string,
  env: Readonly<Record<string, string | undefined>>,
): CheckResult => {
  const v = env[name];
  if (v === undefined || v === "") {
    return {
      name: `env.${name}`,
      severity: "warn",
      message: `${name} is not set — falling back to code default`,
      remediation: `pin ${name} explicitly so prod config doesn't drift from .env.example`,
    };
  }
  return {
    name: `env.${name}`,
    severity: "ok",
    message: `${name}=${v}`,
  };
};

// PREVIEW_PROVIDER must be one of {static, sandbox, mock}.
export const checkPreviewProviderValue = (env: Readonly<Record<string, string | undefined>>): CheckResult => {
  const v = env["PREVIEW_PROVIDER"];
  if (v === undefined || v === "") {
    return {
      name: "preview-provider.value",
      severity: "fail",
      message: "PREVIEW_PROVIDER is unset",
      remediation: 'set PREVIEW_PROVIDER="static" (recommended) or "sandbox"',
    };
  }
  if (v !== "static" && v !== "sandbox" && v !== "mock") {
    return {
      name: "preview-provider.value",
      severity: "fail",
      message: `PREVIEW_PROVIDER="${v}" is not one of {static, sandbox, mock}`,
      remediation: 'set PREVIEW_PROVIDER="static" (recommended) or "sandbox"',
    };
  }
  // Static mode is the goal of this preflight; surface a warn if not yet.
  if (v !== "static") {
    return {
      name: "preview-provider.value",
      severity: "warn",
      message: `PREVIEW_PROVIDER="${v}" — preflight assumes you're flipping to "static"`,
      remediation: 'set PREVIEW_PROVIDER="static" once acceptance gates are green',
    };
  }
  return {
    name: "preview-provider.value",
    severity: "ok",
    message: 'PREVIEW_PROVIDER="static"',
  };
};

// ---------------------------------------------------------------------------
// Filesystem checks
// ---------------------------------------------------------------------------

interface DirCheckOpts {
  /** Override the fs API for tests. */
  stat?: (p: string) => Promise<{ isDir: boolean }>;
  access?: (p: string, mode: number) => Promise<void>;
}

const REAL_STAT = async (p: string) => {
  const s = await fsp.stat(p);
  return { isDir: s.isDirectory() };
};

const REAL_ACCESS = (p: string, mode: number) => fsp.access(p, mode);

// W_OK constant from node:fs/constants. Inlined to avoid an extra
// import in the test path (the test stub doesn't actually look at it).
const W_OK = 2;

export const checkDirectoryWritable = async (
  envVarName: string,
  path: string,
  opts: DirCheckOpts = {},
): Promise<CheckResult> => {
  const stat = opts.stat ?? REAL_STAT;
  const access = opts.access ?? REAL_ACCESS;

  let s: { isDir: boolean };
  try {
    s = await stat(path);
  } catch (err) {
    return {
      name: `dir.${envVarName}`,
      severity: "fail",
      message: `${path} (${envVarName}) does not exist: ${(err as Error).message}`,
      remediation: `mkdir -p ${path} && chown 1000:1000 ${path}`,
    };
  }
  if (!s.isDir) {
    return {
      name: `dir.${envVarName}`,
      severity: "fail",
      message: `${path} (${envVarName}) is not a directory`,
      remediation: `point ${envVarName} at a directory, or remove the existing file at ${path}`,
    };
  }
  try {
    await access(path, W_OK);
  } catch {
    return {
      name: `dir.${envVarName}`,
      severity: "fail",
      message: `${path} (${envVarName}) is not writable by the adorable process`,
      remediation: `chown 1000:1000 ${path} (or whatever uid the adorable process runs as)`,
    };
  }
  return {
    name: `dir.${envVarName}`,
    severity: "ok",
    message: `${path} (${envVarName}) — writable`,
  };
};

// ---------------------------------------------------------------------------
// HTTP reachability checks
// ---------------------------------------------------------------------------

// Both checks use this minimal fetch surface — easier to stub in tests
// than mocking the global Response object.
type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

interface HttpCheckOpts {
  /** Override fetch for tests. */
  fetch?: FetchLike;
  /** Override timeout (ms). Default 5000. */
  timeoutMs?: number;
}

const fetchWithTimeout = async (
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
): Promise<
  | { kind: "ok"; status: number; bodyExcerpt: string }
  | { kind: "error"; message: string }
> => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ac.signal });
    if (!res.ok) {
      return {
        kind: "error",
        message: `HTTP ${res.status}`,
      };
    }
    let bodyExcerpt = "";
    try {
      bodyExcerpt = (await res.text()).slice(0, 200);
    } catch {
      // ignore body read errors — status is what matters
    }
    return { kind: "ok", status: res.status, bodyExcerpt };
  } catch (err) {
    return { kind: "error", message: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
};

// Caddy admin endpoint reachable. Uses CADDY_ADMIN_URL (default
// "http://localhost:2019" — matches docker-compose).
export const checkCaddyAdmin = async (
  env: Readonly<Record<string, string | undefined>>,
  opts: HttpCheckOpts = {},
): Promise<CheckResult> => {
  const baseUrl = env["CADDY_ADMIN_URL"] ?? "http://localhost:2019";
  const url = `${baseUrl.replace(/\/$/, "")}/config/`;
  const fetchImpl = opts.fetch ?? (globalThis.fetch as FetchLike);
  const timeoutMs = opts.timeoutMs ?? 5000;
  const res = await fetchWithTimeout(fetchImpl, url, timeoutMs);
  if (res.kind === "error") {
    return {
      name: "http.caddy",
      severity: "fail",
      message: `Caddy admin (${url}) unreachable: ${res.message}`,
      remediation:
        "verify adorable-caddy is up + the admin port is bound + CADDY_ADMIN_URL points at it",
    };
  }
  return {
    name: "http.caddy",
    severity: "ok",
    message: `Caddy admin (${url}) → ${res.status}`,
  };
};

// Gitea API version endpoint reachable. Uses GITEA_BASE_URL.
export const checkGiteaApi = async (
  env: Readonly<Record<string, string | undefined>>,
  opts: HttpCheckOpts = {},
): Promise<CheckResult> => {
  const baseUrl = env["GITEA_BASE_URL"];
  if (!baseUrl) {
    return {
      name: "http.gitea",
      severity: "fail",
      message: "GITEA_BASE_URL is unset — can't probe Gitea",
      remediation: "set GITEA_BASE_URL in .env (default http://localhost:3001)",
    };
  }
  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/version`;
  const fetchImpl = opts.fetch ?? (globalThis.fetch as FetchLike);
  const timeoutMs = opts.timeoutMs ?? 5000;
  const res = await fetchWithTimeout(fetchImpl, url, timeoutMs);
  if (res.kind === "error") {
    return {
      name: "http.gitea",
      severity: "fail",
      message: `Gitea API (${url}) unreachable: ${res.message}`,
      remediation:
        "verify adorable-gitea is up + bind port matches GITEA_BASE_URL",
    };
  }
  // Gitea version endpoint returns JSON like {"version":"1.21.0"}.
  // We don't enforce a specific version — any 200 with a version
  // string is enough; just surface what we got.
  let versionHint = "";
  try {
    const parsed = JSON.parse(res.bodyExcerpt) as { version?: unknown };
    if (typeof parsed.version === "string") {
      versionHint = ` (version ${parsed.version})`;
    }
  } catch {
    // body wasn't JSON — still ok if status was 200
  }
  return {
    name: "http.gitea",
    severity: "ok",
    message: `Gitea API (${url}) → ${res.status}${versionHint}`,
  };
};

// ---------------------------------------------------------------------------
// Aggregated runner
// ---------------------------------------------------------------------------

export interface RunChecksOptions {
  /** Either NodeJS.ProcessEnv or a synthesised env in tests. */
  env: Readonly<Record<string, string | undefined>>;
  /** Override fs for tests. Forwarded to checkDirectoryWritable. */
  dirCheckOpts?: DirCheckOpts;
  /**
   * When true, also probe Caddy admin + Gitea API. Off by default
   * because those checks need live infra; the static-mode CLI
   * enables this when invoked with --network.
   */
  includeNetworkChecks?: boolean;
  /** Forwarded to network checks. Override fetch for tests. */
  httpCheckOpts?: HttpCheckOpts;
}

export interface PreflightReport {
  results: CheckResult[];
  failed: number;
  warned: number;
  passed: number;
}

export const runStaticPreflight = async (
  opts: RunChecksOptions,
): Promise<PreflightReport> => {
  const { env, dirCheckOpts, includeNetworkChecks, httpCheckOpts } = opts;
  const results: CheckResult[] = [];

  results.push(checkPreviewProviderValue(env));
  for (const v of REQUIRED_ENV_VARS) {
    if (v === "PREVIEW_PROVIDER") continue; // already covered
    results.push(checkRequiredEnvVar(v, env));
  }
  for (const v of RECOMMENDED_ENV_VARS) {
    results.push(checkRecommendedEnvVar(v, env));
  }

  // Directory checks — only run if env points to a path. A failed
  // env check above will already be reported as a fail, no need to
  // double-fail by trying to stat undefined.
  const projectsRoot = env["PROJECTS_ROOT"];
  if (projectsRoot) {
    results.push(
      await checkDirectoryWritable("PROJECTS_ROOT", projectsRoot, dirCheckOpts),
    );
  }
  const staticRoot = env["STATIC_ROOT"];
  if (staticRoot) {
    results.push(
      await checkDirectoryWritable("STATIC_ROOT", staticRoot, dirCheckOpts),
    );
  }

  if (includeNetworkChecks) {
    results.push(await checkCaddyAdmin(env, httpCheckOpts));
    results.push(await checkGiteaApi(env, httpCheckOpts));
  }

  return {
    results,
    failed: results.filter((r) => r.severity === "fail").length,
    warned: results.filter((r) => r.severity === "warn").length,
    passed: results.filter((r) => r.severity === "ok").length,
  };
};
