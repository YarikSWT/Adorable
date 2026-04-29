import { type ToolSet, type UIMessage } from "ai";
import { cookies } from "next/headers";
import { createTools as createVmTools } from "@/lib/create-tools";
import { createStaticTools } from "@/lib/create-static-tools";
import { streamLlmResponse } from "@/lib/llm-provider";
import {
  getSandboxProvider,
  touchSandbox,
  ensureCleanupWorkerRunning,
} from "@/lib/sandbox/provider-singleton";
import { getGitProvider } from "@/lib/git/provider-singleton";
import { getOrCreateIdentitySession } from "@/lib/identity-session";
import { readRepoMetadata, saveConversationMessages } from "@/lib/repo-storage";
import { getSystemPrompt } from "@/lib/system-prompt";
import {
  getBuildQueue,
  getPreviewProvider,
} from "@/lib/preview/provider-singleton";
import { shouldEnqueueAfterTurn } from "@/lib/preview/post-turn";
import { SANDBOX_CAPABILITIES } from "@/lib/adapters/preview";
import type { SandboxHandle } from "@/lib/adapters/sandbox";

/**
 * Snapshot всех source-файлов /workspace и отправка их одним коммитом
 * в source-репо Gitea. Используется в onFinish стрима чата, чтобы
 * правки агента переживали cleanup-worker (sandbox tmpfs эфемерен;
 * Gitea — durable).
 *
 * Включаем только текстовые файлы под ~512 KiB, исключаем node_modules,
 * .git, .next, dist, build artifacts. На дефолтном Vite+React boilerplate
 * это ~15 файлов — дешёво.
 */
const autoCommitWorkspace = async (opts: {
  vm: SandboxHandle;
  sourceRepoId: string;
}): Promise<void> => {
  // 1. Список source-файлов через find в sandbox'е.
  const findCmd =
    "cd /workspace && find . -type f " +
    "-not -path './node_modules/*' " +
    "-not -path './.next/*' " +
    "-not -path './.git/*' " +
    "-not -path './dist/*' " +
    "-not -path './.npm-cache/*' " +
    "-not -name '*.log' " +
    "-size -512k " +
    "| sed 's|^\\./||' | sort";
  const listResult = await opts.vm.exec({
    command: findCmd,
    timeoutMs: 30_000,
  });
  if (listResult.exitCode !== 0) {
    throw new Error(
      `autoCommit: find failed exit=${listResult.exitCode} stderr=${listResult.stderr.slice(0, 300)}`,
    );
  }
  const paths = listResult.stdout
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
  if (paths.length === 0) return;

  // 2. Читаем содержимое каждого файла через handle.fs.readTextFile.
  //    Бинарные файлы (если попадутся) могут вызвать ошибку — игнорим
  //    их, чтобы коммит не свалился целиком.
  const files: Array<{ path: string; content: string }> = [];
  for (const path of paths) {
    try {
      const content = await opts.vm.fs.readTextFile(path);
      files.push({ path, content });
    } catch (err) {
      process.stderr.write(
        `autoCommit: skipped ${path} (${(err as Error).message})\n`,
      );
    }
  }
  if (files.length === 0) return;

  // 3. Один batch-commit через GitProvider.commits.create. Gitea сам
  //    дедупит unchanged blobs — но создаст empty-diff commit, если
  //    содержимое идентично. Чтобы не плодить пустые коммиты, можно
  //    было бы сравнивать с HEAD-ом, но это N запросов; полагаемся на
  //    то, что пользователь редко завершает chat без правок.
  const gitProvider = await getGitProvider();
  const repoRef = gitProvider.getRepo(opts.sourceRepoId);
  const { defaultBranch } = await repoRef.branches.getDefaultBranch();
  await repoRef.commits.create({
    branch: defaultBranch,
    message: `Auto-save: ${files.length} file${files.length === 1 ? "" : "s"}`,
    files,
    author: { name: "Adorable", email: "adorable@localhost" },
  });
};

export async function POST(req: Request) {
  const payload = (await req.json()) as {
    messages?: UIMessage[];
    repoId?: string;
    conversationId?: string;
  };

  const { repoId, conversationId } = payload;
  const messages = Array.isArray(payload.messages)
    ? payload.messages
    : undefined;

  if (!repoId || !conversationId) {
    return Response.json(
      { error: "repoId and conversationId are required." },
      { status: 400 },
    );
  }

  if (!messages) {
    return Response.json(
      { error: "messages must be an array." },
      { status: 400 },
    );
  }

  const { identity } = await getOrCreateIdentitySession();
  const { repositories } = await identity.permissions.git.list({ limit: 200 });
  const hasAccess = repositories.some((repo) => repo.id === repoId);

  if (!hasAccess) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const metadata = await readRepoMetadata(repoId);
  if (!metadata) {
    return Response.json(
      { error: "Repository metadata not found." },
      { status: 404 },
    );
  }

  await saveConversationMessages(repoId, metadata, conversationId, messages);

  // Capabilities pinned per-project (CONTRACTS §12 / ADR-015) — fall
  // back to the live PreviewProvider's capabilities for old metadata
  // without a `preview` block. Defaults are sandbox in env until
  // Phase 6 acceptance, so behaviour is unchanged.
  const livePreviewProvider = await getPreviewProvider();
  const capabilities =
    metadata.preview?.capabilities ??
    (livePreviewProvider.capabilities ?? SANDBOX_CAPABILITIES);

  // Branch by capabilities.shellAccess (CONTRACTS §13):
  //   - sandbox (true): existing flow — vm.ref + createVmTools, autoCommit via vm.fs.
  //   - static  (false): ProjectFs + createStaticTools, no sandbox lifecycle.
  // The static branch leaves `vm` undefined; downstream onFinish guards on it.
  let vm: SandboxHandle | undefined;
  let tools: ToolSet;

  if (capabilities.shellAccess) {
    await ensureCleanupWorkerRunning().catch(() => undefined);
    const provider = await getSandboxProvider();
    vm = await provider.ref({
      sandboxId: metadata.vm.vmId,
      repoId: metadata.sourceRepoId,
    });
    touchSandbox(vm.sandboxId);
    tools = createVmTools(vm, {
      sourceRepoId: metadata.sourceRepoId,
      metadataRepoId: repoId,
    }) as unknown as ToolSet;
  } else {
    const projectFs = await livePreviewProvider.getProjectFs(
      metadata.sourceRepoId,
    );
    if (!projectFs) {
      return Response.json(
        {
          error: `Static project "${metadata.sourceRepoId}" not initialised — call PreviewProvider.create() first.`,
        },
        { status: 500 },
      );
    }
    tools = createStaticTools({
      fs: projectFs,
      buildQueue: getBuildQueue(),
      projectId: metadata.sourceRepoId,
    }) as unknown as ToolSet;
  }

  // Read user-provided API key from cookie (if no global env key)
  const jar = await cookies();
  const userApiKey = jar.get("user-api-key")?.value;
  const userProvider = jar.get("user-api-provider")?.value;

  const hasGlobalKey = !!(
    process.env.Z_AI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    (process.env.LLM_PROVIDER ?? "").toLowerCase() === "mock"
  );

  // If no global key and no user key, reject
  if (!hasGlobalKey && !userApiKey) {
    return Response.json(
      { error: "No API key configured. Please add your API key in settings." },
      { status: 401 },
    );
  }

  const llm = await streamLlmResponse({
    system: getSystemPrompt(capabilities),
    messages,
    tools,
    // Only pass user key if there's no global key
    ...(hasGlobalKey
      ? {}
      : { apiKey: userApiKey, providerOverride: userProvider }),
  });

  return llm.result.toUIMessageStreamResponse({
    sendReasoning: true,
    originalMessages: messages,
    generateMessageId: () => crypto.randomUUID(),
    onFinish: async ({ messages: finalMessages }) => {
      const latestMetadata = await readRepoMetadata(repoId);
      if (!latestMetadata) return;
      await saveConversationMessages(
        repoId,
        latestMetadata,
        conversationId,
        finalMessages,
      );

      // Server-side auto-commit: snapshot всех source-файлов /workspace
      // и отправляем как коммит в Gitea. Делаем именно snapshot, а не
      // per-tool tracking, потому что агент часто использует bashTool
      // (`sed -i`, `cat > file`, `mv`), который не проходит через
      // writeFileTool/replaceInFileTool/appendToFileTool — иначе правки
      // потерялись бы.
      //
      // Sandbox не имеет сетевого доступа к Gitea (разные docker-network),
      // поэтому agent'ский git push не работает. Server-side у нас
      // прямой доступ к Gitea API.
      // autoCommit is sandbox-only — it shells into the running container
      // (find + readTextFile) to snapshot the workspace. In static-mode
      // the LLM only writes through ProjectFs (createStaticTools) — those
      // writes already land in the scratch dir, but a server-side commit
      // to Gitea for static-mode is a follow-up iter.
      if (vm) {
        try {
          await autoCommitWorkspace({
            vm,
            sourceRepoId: latestMetadata.sourceRepoId,
          });
        } catch (err) {
          process.stderr.write(
            `chat onFinish: auto-commit failed for ${latestMetadata.sourceRepoId}: ${(err as Error).message}\n`,
          );
        }
      }

      // Phase 4 — non-blocking build trigger (BUILD_PIPELINE §2). Sandbox
      // mode (hotReload=true) skips this — Vite HMR handles updates.
      // Static mode enqueues a vite build; user sees fresh artifact via
      // SSE / iframe reload.
      //
      // The queue keys on sourceRepoId (matches PreviewProvider.create()
      // contract — projectId == sourceRepoId, the wrapper is just the
      // metadata holder).
      if (shouldEnqueueAfterTurn(capabilities)) {
        const buildProjectId = latestMetadata.sourceRepoId;
        void getBuildQueue()
          .enqueue({ projectId: buildProjectId, reason: "turn-finished" })
          .catch((err: Error) => {
            process.stderr.write(
              `chat onFinish: build enqueue failed for ${buildProjectId}: ${err.message}\n`,
            );
          });
      }
    },
  });
}
