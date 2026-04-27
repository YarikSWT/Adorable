// POST /api/repos/[repoId]/wake
//
// Контракт:
//   - Идемпотентно. Если sandbox уже запущен — no-op, возвращает текущий vm.
//   - Если sandbox мёртв (cleanup-worker реапнул, контейнер удалён,
//     рестарт хоста), пересоздаёт sandbox через createVmForRepo и
//     обновляет metadata.json с новым vm.{vmId,previewUrl,...}.
//   - Identity-проверка: только владелец wrapper-репо может wake'нуть.
//
// Mотивация: live preview iframe на старых проектах показывает белую
// страницу, потому что Caddy всё ещё держит route на бывшее имя
// контейнера, а сам upstream-контейнер уже убит cleanup-worker'ом
// (SANDBOX_MAX_LIFETIME_MIN=120, SANDBOX_IDLE_TIMEOUT_MIN=30). Wake
// позволяет UI оживить sandbox при первом обращении к проекту.

import { NextResponse } from "next/server";
import { createVmForRepo } from "@/lib/adorable-vm";
import { getOrCreateIdentitySession } from "@/lib/identity-session";
import { getSandboxProvider } from "@/lib/sandbox/provider-singleton";
import { readRepoMetadata, writeRepoMetadata } from "@/lib/repo-storage";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ repoId: string }> },
) {
  const { repoId: rawRepoId } = await params;
  const repoId = decodeURIComponent(rawRepoId);

  const { identity } = await getOrCreateIdentitySession();
  const { repositories } = await identity.permissions.git.list({ limit: 200 });
  if (!repositories.some((repo) => repo.id === repoId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const metadata = await readRepoMetadata(repoId);
  if (!metadata) {
    return NextResponse.json(
      { error: "Repository metadata not found" },
      { status: 404 },
    );
  }

  const provider = await getSandboxProvider();
  let alive = false;
  try {
    const handle = await provider.ref({
      sandboxId: metadata.vm.vmId,
      repoId: metadata.sourceRepoId,
    });
    alive = handle.status === "running";
  } catch {
    // ref() кидает 404, когда контейнер исчез — sandbox мёртв.
    alive = false;
  }

  if (alive) {
    return NextResponse.json({
      recreated: false,
      vm: metadata.vm,
    });
  }

  // Sandbox исчез — пересоздаём.
  const newVm = await createVmForRepo(metadata.sourceRepoId);
  const updatedMetadata = {
    ...metadata,
    vm: newVm,
  };
  await writeRepoMetadata(repoId, updatedMetadata);

  // Sandbox пересоздан с template'ом, но node_modules ещё нет и Vite не
  // запущен — без этого preview-iframe показывает белую страницу.
  // Делаем `npm install && npm run dev` синхронно (await), потому что
  // fire-and-forget Promise в Next.js dev-режиме иногда отменяется
  // после response. Стоимость — ~10-20s wake-response, но это окей: UI
  // и так показывает "Loading preview..." overlay в это время.
  try {
    const handle = await provider.ref({
      sandboxId: newVm.vmId,
      repoId: metadata.sourceRepoId,
    });
    // npm install + (запустить vite в фоне детачнуто) + кратко подождать.
    // setsid гарантирует, что vite не убьётся когда exec-сессия закроется.
    const cmd =
      "cd /workspace && npm install --silent 2>&1 | tail -3 && " +
      "(setsid bash -c 'npm run dev > /tmp/vite.log 2>&1' < /dev/null > /dev/null 2>&1 &) " +
      "&& sleep 4 && tail -10 /tmp/vite.log";
    await handle.exec({ command: cmd, timeoutMs: 120_000 });
  } catch (err) {
    process.stderr.write(
      `wake: failed to bootstrap dev-server in ${newVm.vmId}: ${(err as Error).message}\n`,
    );
  }

  return NextResponse.json({
    recreated: true,
    vm: newVm,
  });
}
