import { type UIMessage } from "ai";
import { cookies } from "next/headers";
import { createTools as createVmTools } from "@/lib/create-tools";
import { streamLlmResponse } from "@/lib/llm-provider";
import {
  getSandboxProvider,
  touchSandbox,
  ensureCleanupWorkerRunning,
} from "@/lib/sandbox/provider-singleton";
import { getGitProvider } from "@/lib/git/provider-singleton";
import { getOrCreateIdentitySession } from "@/lib/identity-session";
import { readRepoMetadata, saveConversationMessages } from "@/lib/repo-storage";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
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

  await ensureCleanupWorkerRunning().catch(() => undefined);
  const provider = await getSandboxProvider();
  const vm = await provider.ref({
    sandboxId: metadata.vm.vmId,
    repoId: metadata.sourceRepoId,
  });
  touchSandbox(vm.sandboxId);

  const tools = createVmTools(vm, {
    sourceRepoId: metadata.sourceRepoId,
    metadataRepoId: repoId,
  });

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
    system: SYSTEM_PROMPT,
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
    },
  });
}
