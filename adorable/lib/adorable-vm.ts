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
import { seedSandboxFromTemplate } from "@/lib/template-seeder";

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
  // поле в контракте есть, реализация нет. Поэтому seed'им bundled
  // Vite+React шаблон руками через handle.fs. Без этого агент видит
  // пустую директорию и начинает npm create vite с нуля (а то и вовсе
  // валится на readonly /home). Ошибки подавляем — sandbox остаётся
  // работоспособен, агент в крайнем случае сам построит template.
  try {
    await seedSandboxFromTemplate({ fs: handle.fs });
  } catch (err) {
    process.stderr.write(
      `adorable-vm: template seed failed (${(err as Error).message})\n`,
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

  return {
    vmId: handle.sandboxId,
    previewUrl: `${proto}://${previewHost}`,
    devCommandTerminalUrl: `${proto}://${devCommandHost}`,
    additionalTerminalsUrl: `${proto}://${additionalHost}`,
  };
};
