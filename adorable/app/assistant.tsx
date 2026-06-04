"use client";

import { AssistantRuntimeProvider, useAuiState } from "@assistant-ui/react";
import {
  useAISDKRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { useChat } from "@ai-sdk/react";
import { type UIMessage } from "ai";
import { Thread } from "@/components/assistant-ui/thread";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { dedupeToolCallsAcrossMessages } from "@/lib/cross-message-tool-dedup";

type ThreadState = {
  isEmpty: boolean;
  isRunning: boolean;
};

type CreateFromGithubDetail = {
  githubRepoName: string;
};

type EnsureResult = {
  repoId: string;
  conversationId: string;
};

const EMPTY_MESSAGES: UIMessage[] = [];

// Module-level inflight dedup: React StrictMode in dev double-invokes
// effects, which can cause `prepareSendMessagesRequest` to fire twice for
// one Send and produce two POST /api/repos. Keyed by chatSessionIdRef so
// concurrent callers (including across re-mounts that share the same
// session key) reuse the same in-flight promise instead of racing.
const inflightEnsure = new Map<string, Promise<EnsureResult>>();
const inflightClientRequestIds = new Map<string, string>();

const newClientRequestId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // jsdom in some test envs lacks randomUUID — fall back to a non-crypto id.
  return `crid-${Math.random().toString(36).slice(2)}-${Date.now()}`;
};

const extractUserPrompt = (messages: UIMessage[]): string | null => {
  const firstUserMessage = messages.find((message) => message.role === "user");
  if (!firstUserMessage) return null;

  const textPart = firstUserMessage.parts?.find((part) => part.type === "text");
  if (!textPart || !("text" in textPart)) return null;

  const clean = textPart.text.trim().replace(/\s+/g, " ");
  return clean || null;
};

export const Assistant = ({
  initialMessages,
  selectedRepoId = null,
  selectedConversationId = null,
  onThreadStateChange,
  onActiveConversationChange,
  welcome,
  homeBackdrop = false,
}: {
  initialMessages?: UIMessage[];
  selectedRepoId?: string | null;
  selectedConversationId?: string | null;
  onThreadStateChange?: (next: ThreadState) => void;
  onActiveConversationChange?: (repoId: string, conversationId: string) => void;
  welcome?: ReactNode;
  homeBackdrop?: boolean;
}) => {
  const resolvedInitialMessages = initialMessages ?? EMPTY_MESSAGES;

  const [seedMessages, setSeedMessages] = useState<UIMessage[]>(
    resolvedInitialMessages,
  );
  const [runtimeVersion, setRuntimeVersion] = useState(0);
  const [localRepoId, setLocalRepoId] = useState<string | null>(selectedRepoId);
  const [localConversationId, setLocalConversationId] = useState<string | null>(
    selectedConversationId,
  );
  const activeRepoIdRef = useRef<string | null>(selectedRepoId);
  const activeConversationIdRef = useRef<string | null>(selectedConversationId);
  const onActiveConversationChangeRef = useRef(onActiveConversationChange);
  const chatSessionIdRef = useRef(
    selectedConversationId
      ? `conversation:${selectedConversationId}`
      : selectedRepoId
        ? `repo:${selectedRepoId}:draft`
        : "home:draft",
  );

  // Re-seed only when the conversation actually changes — NOT on every
  // parent re-render that hands us a fresh `initialMessages` array
  // reference. Re-seeding mid-stream replaces useChat's state and
  // collides with in-flight tool-call updates, producing the
  // "Duplicate key toolCallId-… in tapResources" crash.
  const lastSeededConversationRef = useRef(selectedConversationId);
  useEffect(() => {
    if (lastSeededConversationRef.current !== selectedConversationId) {
      lastSeededConversationRef.current = selectedConversationId;
      setSeedMessages(resolvedInitialMessages);
    }
  }, [resolvedInitialMessages, selectedConversationId]);

  useEffect(() => {
    setLocalRepoId((previous) => selectedRepoId ?? previous);
    setLocalConversationId((previous) => selectedConversationId ?? previous);
  }, [selectedConversationId, selectedRepoId]);

  useEffect(() => {
    if (selectedRepoId) {
      activeRepoIdRef.current = selectedRepoId;
    }
    if (selectedConversationId) {
      activeConversationIdRef.current = selectedConversationId;
    }
  }, [selectedConversationId, selectedRepoId]);

  useEffect(() => {
    onActiveConversationChangeRef.current = onActiveConversationChange;
  }, [onActiveConversationChange]);

  useEffect(() => {
    const handleGoHome = () => {
      setSeedMessages(EMPTY_MESSAGES);
      setLocalRepoId(null);
      setLocalConversationId(null);
      activeRepoIdRef.current = null;
      activeConversationIdRef.current = null;
      chatSessionIdRef.current = `home:draft:${Date.now()}`;
      setRuntimeVersion((version) => version + 1);
    };

    window.addEventListener("adorable:go-home", handleGoHome);
    return () => {
      window.removeEventListener("adorable:go-home", handleGoHome);
    };
  }, []);

  useEffect(() => {
    const handleGoToRepo = (event: Event) => {
      const customEvent = event as CustomEvent<{ repoId: string }>;
      const detail = customEvent.detail;
      if (!detail?.repoId) return;

      setSeedMessages(EMPTY_MESSAGES);
      setLocalRepoId(detail.repoId);
      setLocalConversationId(null);
      activeRepoIdRef.current = detail.repoId;
      activeConversationIdRef.current = null;
      chatSessionIdRef.current = `repo:${detail.repoId}:draft:${Date.now()}`;
      setRuntimeVersion((version) => version + 1);
    };

    window.addEventListener(
      "adorable:go-to-repo",
      handleGoToRepo as EventListener,
    );
    return () => {
      window.removeEventListener(
        "adorable:go-to-repo",
        handleGoToRepo as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    const handleCreateFromGithub = async (event: Event) => {
      const customEvent = event as CustomEvent<CreateFromGithubDetail>;
      const githubRepoName = customEvent.detail?.githubRepoName?.trim();
      if (!githubRepoName) return;

      const response = await fetch("/api/repos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ githubRepoName }),
      });

      if (!response.ok) {
        return;
      }

      const data = await response.json();
      const repoId = data.id as string | undefined;
      const conversationId = data.conversationId as string | undefined;

      if (!repoId || !conversationId) {
        return;
      }

      // repoId из Gitea — "owner/repo" со slash. Без encodeURIComponent
      // route [repoId]/[conversationId] парсит owner как repoId, остальное
      // как conversationId — открывается чужая (несуществующая) сессия.
      const nextPath = `/${encodeURIComponent(repoId)}/${encodeURIComponent(conversationId)}`;
      window.history.replaceState(window.history.state, "", nextPath);
      setSeedMessages(EMPTY_MESSAGES);
      setLocalRepoId(repoId);
      setLocalConversationId(conversationId);
      activeRepoIdRef.current = repoId;
      activeConversationIdRef.current = conversationId;
      chatSessionIdRef.current = `conversation:${conversationId}`;
      setRuntimeVersion((version) => version + 1);
      onActiveConversationChangeRef.current?.(repoId, conversationId);
      window.dispatchEvent(
        new CustomEvent("adorable:active-conversation", {
          detail: { repoId, conversationId },
        }),
      );
      window.dispatchEvent(new Event("adorable:repos-updated"));
    };

    window.addEventListener(
      "adorable:create-from-github",
      handleCreateFromGithub as EventListener,
    );
    return () => {
      window.removeEventListener(
        "adorable:create-from-github",
        handleCreateFromGithub as EventListener,
      );
    };
  }, []);

  const ensureActiveConversation = useCallback(
    async (
      requestedRepoName?: string,
      requestedConversationTitle?: string,
    ): Promise<EnsureResult> => {
      const activeRepoId = activeRepoIdRef.current;
      const activeConversationId = activeConversationIdRef.current;

      if (activeRepoId && activeConversationId) {
        return {
          repoId: activeRepoId,
          conversationId: activeConversationId,
        };
      }

      // Dedup key: collapse concurrent callers into one network request.
      // For the no-repo case the key is the session id (StrictMode dev
      // double-mount + double-Send share "home:draft"). For the
      // repo-but-no-conversation case the key is the repo id.
      const dedupKey = activeRepoId
        ? `conv:${activeRepoId}`
        : `repo:${chatSessionIdRef.current}`;

      const existing = inflightEnsure.get(dedupKey);
      if (existing) return existing;

      let clientRequestId = inflightClientRequestIds.get(dedupKey);
      if (!clientRequestId) {
        clientRequestId = newClientRequestId();
        inflightClientRequestIds.set(dedupKey, clientRequestId);
      }

      const run = async (): Promise<EnsureResult> => {
        if (activeRepoId) {
          // repoId из Gitea имеет формат "owner/repo" — slash обязан быть
          // encoded, иначе Next.js dynamic route [repoId] его не матчит.
          const response = await fetch(
            `/api/repos/${encodeURIComponent(activeRepoId)}/conversations`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                clientRequestId,
                ...(requestedConversationTitle
                  ? { title: requestedConversationTitle }
                  : {}),
              }),
            },
          );

          if (!response.ok) {
            throw new Error(
              "Failed to create a conversation for the selected repo.",
            );
          }

          const data = await response.json();
          const conversationId = data.conversationId as string | undefined;

          if (!conversationId) {
            throw new Error("Conversation creation did not return an id.");
          }

          const nextPath = `/${encodeURIComponent(activeRepoId)}/${encodeURIComponent(conversationId)}`;
          window.history.replaceState(window.history.state, "", nextPath);
          setLocalConversationId(conversationId);
          activeConversationIdRef.current = conversationId;
          onActiveConversationChangeRef.current?.(
            activeRepoId,
            conversationId,
          );
          window.dispatchEvent(
            new CustomEvent("adorable:active-conversation", {
              detail: { repoId: activeRepoId, conversationId },
            }),
          );

          return {
            repoId: activeRepoId,
            conversationId,
          };
        }

        const response = await fetch("/api/repos", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            clientRequestId,
            ...(requestedRepoName ? { name: requestedRepoName } : {}),
            ...(requestedConversationTitle
              ? { conversationTitle: requestedConversationTitle }
              : {}),
          }),
        });
        if (!response.ok) {
          throw new Error("Failed to create a repository for this chat.");
        }

        const data = await response.json();
        const repoId = data.id as string | undefined;
        const conversationId = data.conversationId as string | undefined;

        if (!repoId || !conversationId) {
          throw new Error("Repository creation did not return ids.");
        }

        const nextPath = `/${encodeURIComponent(repoId)}/${encodeURIComponent(conversationId)}`;
        window.history.replaceState(window.history.state, "", nextPath);
        setLocalRepoId(repoId);
        setLocalConversationId(conversationId);
        activeRepoIdRef.current = repoId;
        activeConversationIdRef.current = conversationId;
        onActiveConversationChangeRef.current?.(repoId, conversationId);
        window.dispatchEvent(
          new CustomEvent("adorable:active-conversation", {
            detail: { repoId, conversationId },
          }),
        );

        return {
          repoId,
          conversationId,
        };
      };

      const promise = run().finally(() => {
        inflightEnsure.delete(dedupKey);
        inflightClientRequestIds.delete(dedupKey);
      });
      inflightEnsure.set(dedupKey, promise);
      return promise;
    },
    [],
  );

  const runtimeKey = `${chatSessionIdRef.current}:${runtimeVersion}`;

  const handleThreadStateChange = useCallback(
    (next: ThreadState) => {
      onThreadStateChange?.(next);
      window.dispatchEvent(
        new CustomEvent("adorable:thread-state", {
          detail: {
            repoId: activeRepoIdRef.current,
            isRunning: next.isRunning,
          },
        }),
      );
    },
    [onThreadStateChange],
  );

  const dispatchReposUpdated = useCallback(() => {
    const repoId = activeRepoIdRef.current;
    if (!repoId) return;

    window.dispatchEvent(
      new CustomEvent("adorable:repos-updated", {
        detail: { repoId },
      }),
    );
  }, []);

  const handleChatFinish = useCallback(() => {
    dispatchReposUpdated();
  }, [dispatchReposUpdated]);

  const chat = useChat<UIMessage>({
    id: runtimeKey,
    // Bridge mode (worker architecture): reconnect to the worker's live stream
    // via GET /api/chat/:id/stream on mount (закрыл вкладку — не потерял). The
    // server returns 204 when there is no active stream, so this is safe even
    // for completed runs. (Off in the inline/no-worker path.)
    resume: process.env["NEXT_PUBLIC_AGENT_LOOP_BRIDGE"] === "1",
    transport: new AssistantChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: async (options) => {
        const prompt = extractUserPrompt(options.messages);
        const repoName = prompt ? prompt.slice(0, 50) : undefined;
        const conversationTitle = prompt ? prompt.slice(0, 60) : undefined;
        const active = await ensureActiveConversation(
          repoName,
          conversationTitle,
        );

        if (prompt) {
          window.dispatchEvent(
            new CustomEvent("adorable:metadata-optimistic", {
              detail: {
                repoId: active.repoId,
                conversationId: active.conversationId,
                repoName: repoName,
                conversationTitle,
              },
            }),
          );
        }

        return {
          body: {
            ...options.body,
            messages: options.messages,
            metadata: options.requestMetadata,
            id: undefined,
            trigger: "submit-message",
            messageId: undefined,
            repoId: active.repoId,
            conversationId: active.conversationId,
          },
        };
      },
    }),
    messages: seedMessages,
    onFinish: handleChatFinish,
  });

  // Cross-message toolCallId dedup. The message converter inside
  // @assistant-ui/react-ai-sdk only dedups WITHIN one message, so when
  // the same toolCallId leaks into two messages (typical after a
  // step-boundary mid-stream) `tapResources` throws "Duplicate key
  // toolCallId-… in tapResources" and freezes the UI. We strip the
  // earlier copies before the converter sees them. UI-render concern
  // only — chat.setMessages / sendMessage operate on the underlying
  // state (which the save-time sanitiser handles separately), so
  // outbound HTTP and persistence are unaffected.
  //
  // The useMemo on chat.messages is the only useful one — `chat`
  // itself is a fresh object literal each render (see @ai-sdk/react),
  // so the spread is cheap and worth doing inline.
  const dedupedMessages = useMemo(
    () => dedupeToolCallsAcrossMessages(chat.messages),
    [chat.messages],
  );

  // Stop button (спец §4.3): an EXPLICIT stop must cancel the worker run, not
  // just disconnect the client (disconnect ≠ stop — the worker keeps going and
  // the stream stays resumable). In bridge mode we POST /api/chat/:id/stop with
  // the partial assistant snapshot before the normal client-side stop.
  const stopWithServerCancel = useCallback(async () => {
    const conversationId = activeConversationIdRef.current;
    if (
      conversationId &&
      process.env["NEXT_PUBLIC_AGENT_LOOP_BRIDGE"] === "1"
    ) {
      const assistantMessage = [...chat.messages]
        .reverse()
        .find((m) => m.role === "assistant");
      void fetch(`/api/chat/${encodeURIComponent(conversationId)}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assistantMessage }),
      }).catch(() => undefined);
    }
    chat.stop();
  }, [chat]);

  const runtime = useAISDKRuntime({
    ...chat,
    stop: stopWithServerCancel,
    messages: dedupedMessages,
  });

  return (
    <AssistantRuntimeProvider key={runtimeKey} runtime={runtime}>
      <ThreadStateBridge onThreadStateChange={handleThreadStateChange} />
      <Thread welcome={welcome} homeBackdrop={homeBackdrop} />
    </AssistantRuntimeProvider>
  );
};

function ThreadStateBridge({
  onThreadStateChange,
}: {
  onThreadStateChange?: (next: ThreadState) => void;
}) {
  const isEmpty = useAuiState(({ thread }) => thread.isEmpty);
  const isRunning = useAuiState(({ thread }) => thread.isRunning);

  useEffect(() => {
    onThreadStateChange?.({ isEmpty, isRunning });
  }, [isEmpty, isRunning, onThreadStateChange]);

  return null;
}
