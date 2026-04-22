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

  const handle = await provider.create({
    repoId,
    workdir: WORKDIR,
    persistence: "sticky",
    git: {
      repos: [{ path: WORKDIR, repo: repoId }],
      config: { user: { name: "Adorable", email: "adorable@localhost" } },
    },
    domains: [
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
    ],
  });

  return {
    vmId: handle.sandboxId,
    previewUrl: `${proto}://${previewHost}`,
    devCommandTerminalUrl: `${proto}://${devCommandHost}`,
    additionalTerminalsUrl: `${proto}://${additionalHost}`,
  };
};
