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
import {
  readRepoMetadata,
  sanitiseConversationMessages,
  saveConversationMessages,
} from "@/lib/repo-storage";
import { protectedRoute } from "@/lib/auth/api-wrap";
import { requireEmailVerified } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/authorization";
import { recordUsage, requireQuota } from "@/lib/auth/quotas";
import { getProjectByGiteaWrapperId } from "@/lib/db/queries/projects";
import { HttpError } from "@/lib/auth/errors";
import { getSystemPrompt } from "@/lib/system-prompt";
import {
  getBuildQueue,
  getPreviewProvider,
} from "@/lib/preview/provider-singleton";
import { shouldEnqueueAfterTurn } from "@/lib/preview/post-turn";
import { autoCommitProjectFs } from "@/lib/preview/auto-commit-project-fs";
import {
  SANDBOX_CAPABILITIES,
  type ProjectFs,
} from "@/lib/adapters/preview";
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

// Pre-flight quota: how many LLM tokens we *might* burn on this turn. Spec
// §13 hard-codes 50_000 — generous enough that almost any single completion
// fits, conservative enough that hitting projects.tokens.monthly limit
// pre-empts a partial stream rather than after the fact. Actual usage is
// recorded on stream finish via recordUsage().
const ESTIMATED_TURN_TOKENS = 50_000;

export const POST = protectedRoute(async ({ req, session }) => {
  requireEmailVerified(session);

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
    throw new HttpError(
      400,
      "validation.failed",
      "repoId and conversationId are required.",
    );
  }
  if (!messages) {
    throw new HttpError(
      400,
      "validation.failed",
      "messages must be an array.",
    );
  }

  const project = await getProjectByGiteaWrapperId(repoId);
  if (!project) {
    // 404 (not 403) so non-members can't probe for repo existence — Doc 2 §9.4.
    throw new HttpError(404, "not_found", "Repository not found");
  }
  await requirePermission(session.user.id, "project.edit", {
    projectId: project.id,
  });
  await requireQuota(
    project.organizationId,
    "llm.tokens.monthly",
    ESTIMATED_TURN_TOKENS,
  );

  const metadata = await readRepoMetadata(repoId);
  if (!metadata) {
    throw new HttpError(
      404,
      "not_found",
      "Repository metadata not found.",
    );
  }

  // Sanitise once and reuse: persistence + the LLM call should see the
  // same cleaned transcript. Raw `messages` from the client may carry
  // duplicate toolCallId parts (StrictMode dual-mount, mid-stream
  // step-boundary); persisting raw is unsafe (loaded back triggers
  // tapResources crash) and feeding raw to the LLM wastes tokens on
  // information-superseded copies.
  const sanitisedMessages = sanitiseConversationMessages(messages);

  await saveConversationMessages(
    repoId,
    metadata,
    conversationId,
    sanitisedMessages,
  );

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
  let staticFs: ProjectFs | undefined;
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
    staticFs = projectFs;
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
    messages: sanitisedMessages,
    tools,
    // Only pass user key if there's no global key
    ...(hasGlobalKey
      ? {}
      : { apiKey: userApiKey, providerOverride: userProvider }),
  });

  return llm.result.toUIMessageStreamResponse({
    sendReasoning: true,
    originalMessages: sanitisedMessages,
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
      // Auto-commit branch:
      //   sandbox: snapshot via vm.exec(find) + vm.fs.readTextFile.
      //   static:  walk ProjectFs.list(recursive) + readTextFile —
      //            covers files written by createStaticTools (which all
      //            go through ProjectFs).
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
      } else if (staticFs) {
        try {
          const gitProvider = await getGitProvider();
          await autoCommitProjectFs({
            fs: staticFs,
            gitProvider,
            sourceRepoId: latestMetadata.sourceRepoId,
          });
        } catch (err) {
          process.stderr.write(
            `chat onFinish: static auto-commit failed for ${latestMetadata.sourceRepoId}: ${(err as Error).message}\n`,
          );
        }
      }

      // Phase 13 — record actual LLM usage. The AI SDK exposes usage as a
      // resolved value once the stream finishes; if it's missing (e.g. mock
      // provider returns no token counts), fall back to the estimate so
      // counters still advance and quota enforcement remains predictable.
      try {
        const usage = await llm.result.usage;
        const totalFromUsage =
          typeof usage?.totalTokens === "number" && usage.totalTokens > 0
            ? usage.totalTokens
            : (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
        const totalTokens =
          totalFromUsage > 0 ? totalFromUsage : ESTIMATED_TURN_TOKENS;
        await recordUsage({
          organizationId: project.organizationId,
          userId: session.user.id,
          projectId: project.id,
          kind: "llm.tokens.monthly",
          amount: totalTokens,
          unit: "tokens",
          model: undefined,
          metadata: {
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
          },
        });
      } catch (err) {
        process.stderr.write(
          `chat onFinish: recordUsage failed: ${(err as Error).message}\n`,
        );
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
});
