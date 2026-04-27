// Sandbox lifecycle для одного проекта/репо.
//
// Заменяет прежнюю freestyle-реализацию. Теперь все VM-операции идут
// через `SandboxProvider` (см. `lib/adapters/sandbox.ts`) — в dev/prod
// это `DockerSandboxProvider`, в тестах — mock.
//
// Контракт `createVmForRepo(repoId)` сохранён: callers (repos/route.ts)
// получают `VmRuntimeMetadata` с тем же shape (`vmId`, `previewUrl`,
// `devCommandTerminalUrl`, `additionalTerminalsUrl`).
//
// Домены формируются по схеме `<sandboxId>.<PREVIEW_DOMAIN_SUFFIX>` —
// это поддомены одного корневого домена (`preview.localhost` в dev или
// prod-суффикс в проде). Proxy-роуты в Caddy пока не регистрируются
// здесь — это будет задача Phase 4 (ProxyProvider).

import { randomUUID } from "node:crypto";

import {
  ADDITIONAL_TERMINALS_PORT,
  DEV_COMMAND_TERMINAL_PORT,
  VM_PORT,
  WORKDIR,
} from "@/lib/vars";
import { getSandboxProvider } from "@/lib/sandbox/provider-singleton";
import { getProxyProvider } from "@/lib/proxy/provider-singleton";
import { seedSandboxFromSourceRepo } from "@/lib/template-seeder";
import { getGitProvider } from "@/lib/git/provider-singleton";

export type VmRuntimeMetadata = {
  vmId: string;
  previewUrl: string;
  devCommandTerminalUrl: string;
  additionalTerminalsUrl: string;
};

const previewSuffix = (): string =>
  process.env["PREVIEW_DOMAIN_SUFFIX"] ?? "preview.localhost";

const previewProtocol = (): string =>
  process.env["PREVIEW_PROTOCOL"] ?? "http";

/**
 * Внешний порт прокси для preview. В dev-сетапе Caddy слушает на 8080
 * (CADDY_HTTP_PORT в `scripts/dev-infra.sh` / `start-dev.sh`), потому что
 * дефолтные 80/443 требуют privileged-bind. Без явного указания порта
 * iframe в UI шёл на дефолтный 80 → "Loading preview..." висел вечно.
 *
 * Приоритет источников:
 *   PREVIEW_PUBLIC_PORT — явный override.
 *   CADDY_HTTP_PORT      — то, что выставлено для Caddy в dev.
 *   protocol-default     — 80 для http, 443 для https.
 *
 * Если итоговый порт совпадает с дефолтным для протокола — НЕ добавляем
 * `:port` в URL (чтобы prod с Caddy на 80/443 + ACME не ломался).
 */
const previewPortSegment = (proto: string): string => {
  const explicit =
    process.env["PREVIEW_PUBLIC_PORT"] ?? process.env["CADDY_HTTP_PORT"];
  const port = explicit ? Number.parseInt(explicit, 10) : NaN;
  if (!Number.isFinite(port) || port <= 0) return "";
  const defaultPort = proto === "https" ? 443 : 80;
  return port === defaultPort ? "" : `:${port}`;
};

export const createVmForRepo = async (
  repoId: string,
): Promise<VmRuntimeMetadata> => {
  const provider = await getSandboxProvider();
  const subdomainKey = randomUUID().slice(0, 8);
  const suffix = previewSuffix();
  const proto = previewProtocol();

  const previewHost = `${subdomainKey}.${suffix}`;
  const devCommandHost = `dev-command-${subdomainKey}.${suffix}`;
  const additionalHost = `terminals-${subdomainKey}.${suffix}`;

  const domains = [
    { hostname: previewHost, sandboxPort: VM_PORT, role: "preview" },
    {
      hostname: devCommandHost,
      sandboxPort: DEV_COMMAND_TERMINAL_PORT,
      role: "devCommandTerminal",
    },
    {
      hostname: additionalHost,
      sandboxPort: ADDITIONAL_TERMINALS_PORT,
      role: "additionalTerminals",
    },
  ] as const;

  const handle = await provider.create({
    repoId,
    workdir: WORKDIR,
    persistence: "sticky",
    git: {
      repos: [{ path: WORKDIR, repo: repoId }],
      config: { user: { name: "Adorable", email: "adorable@localhost" } },
    },
    domains: domains.map((d) => ({ ...d })),
  });

  // Docker-адаптер в нынешнем виде не клонирует git.repos в workspace —
  // поле в контракте есть, реализация нет. Seedим из source-репо в
  // Gitea (а не из bundled template'а), чтобы пересоздание sandbox'а
  // после cleanup-worker'а восстанавливало последнее закоммиченное
  // состояние агентских правок. Если коммитов нет / Gitea недоступен,
  // seedSandboxFromSourceRepo сам fallback'нется на bundled template.
  try {
    const provider = await getGitProvider();
    await seedSandboxFromSourceRepo({
      fs: handle.fs,
      provider,
      sourceRepoId: repoId,
    });
  } catch (err) {
    process.stderr.write(
      `adorable-vm: source seed failed (${(err as Error).message})\n`,
    );
  }

  // Register proxy routes for each public port. Errors are swallowed —
  // sandbox is usable without the proxy (direct port access within
  // the infra network), and broken proxy shouldn't block project
  // creation. Routes are logged via audit-log.
  try {
    const proxy = await getProxyProvider();
    for (const d of domains) {
      await proxy.addRoute({
        id: `${handle.sandboxId}-${d.role}`,
        hostname: d.hostname,
        upstream: `${handle.sandboxId}:${d.sandboxPort}`,
        sandboxId: handle.sandboxId,
      });
    }
  } catch (err) {
    process.stderr.write(
      `adorable-vm: proxy registration failed (${(err as Error).message})\n`,
    );
  }

  const portSegment = previewPortSegment(proto);

  return {
    vmId: handle.sandboxId,
    previewUrl: `${proto}://${previewHost}${portSegment}`,
    devCommandTerminalUrl: `${proto}://${devCommandHost}${portSegment}`,
    additionalTerminalsUrl: `${proto}://${additionalHost}${portSegment}`,
  };
};
