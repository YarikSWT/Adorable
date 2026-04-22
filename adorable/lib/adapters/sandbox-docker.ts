// Docker-backed SandboxProvider через dockerode.
//
// STATUS: ПЛЕЙСХОЛДЕР. Будет полностью реализован в следующей итерации
// Phase 2. Пока что `createDockerSandboxProvider()` бросает, указывая
// на это. Это даёт CI возможность компилироваться и гарантирует, что
// mock-провайдер — единственный рабочий путь, пока docker-часть не
// готова.
//
// Целевой чек-лист из PROMPT.md (15 ограничений) будет реализован здесь:
//   NanoCpus, Memory, MemorySwap, PidsLimit, ReadonlyRootfs,
//   SecurityOpt=no-new-privileges, CapDrop ALL, User 1000:1000,
//   Ulimits (nofile, core), StorageOpt.size, BlkioDeviceReadBps/WriteBps,
//   NetworkMode = adorable_sandboxes, AutoRemove + TTL cleanup worker,
//   Tmpfs /tmp, AuditLog.

import type { SandboxProvider } from "./sandbox";

export const createDockerSandboxProvider = (): SandboxProvider => {
  throw new Error(
    "sandbox-docker: not implemented yet. Set SANDBOX_PROVIDER=mock for tests, " +
      "or wait for Phase 2 docker implementation.",
  );
};
