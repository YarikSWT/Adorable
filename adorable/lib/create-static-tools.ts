// LLM-tools for the static preview-provider mode (capabilities.shellAccess=false).
//
// Source: docs/preview-provider/CONTRACTS.md §13.
//
// All file operations go through ProjectFs (whitelist-enforced). Build
// operations go through BuildQueue. There is no `bash`, no `checkApp`,
// no `devServerLogs` — those are sandbox-only and remain in legacy
// lib/create-tools.ts. chat/route.ts will branch by
// capabilities.shellAccess in the next Phase 4 iter.

import { tool } from "ai";
import { z } from "zod";

import type { BuildQueue, ProjectFs } from "@/lib/adapters/preview";
import { ProjectFsError } from "@/lib/adapters/preview";
import { explainNonWritable } from "@/lib/preview/project-fs";
import {
  getSharedAuditLogger,
  type AuditLogger,
} from "@/lib/sandbox/audit-log";

export interface StaticToolsOptions {
  /** ProjectFs for all read/write/list/search ops. Required. */
  fs: ProjectFs;
  /** Build queue for rebuild + log retrieval. Required for static mode. */
  buildQueue: BuildQueue;
  /** Project id (= repoId) — used by build tools. */
  projectId: string;

  /** Hook into write/append/replace for batch-commit (chat onFinish). */
  onFileChange?: (path: string, content: string) => void;
  /** Hook into delete/move-source for batch-commit. */
  onFileDelete?: (path: string) => void;

  /**
   * Audit logger for security-relevant events (path_rejected when the
   * LLM tries to escape the writable whitelist). Defaults to the shared
   * audit logger; pass null to silence.
   */
  auditLogger?: AuditLogger | null;
}

const friendlyError = (err: unknown): { ok: false; error: string } => {
  if (err instanceof ProjectFsError) {
    return { ok: false, error: err.message };
  }
  return {
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  };
};

export const createStaticTools = (opts: StaticToolsOptions) => {
  const { fs, buildQueue, projectId } = opts;
  const audit =
    "auditLogger" in opts ? opts.auditLogger : getSharedAuditLogger();

  const auditPathRejection = (
    err: unknown,
    tool: "write" | "remove" | "rename" | "mkdir",
  ): void => {
    if (!audit) return;
    if (!(err instanceof ProjectFsError)) return;
    if (err.code !== "path-not-writable" && err.code !== "invalid-path") {
      return;
    }
    void audit
      .log({
        event: "path_rejected",
        projectId,
        path: err.path ?? "",
        tool,
        reason: err.message,
      })
      .catch(() => undefined);
  };

  const readFileTool = tool({
    description: "Read the content of a project file (utf-8 text).",
    inputSchema: z
      .object({
        file: z.string().min(1).describe("Path relative to project root."),
      })
      .passthrough(),
    execute: async ({ file }) => {
      try {
        const content = await fs.readTextFile(file);
        return { ok: true, content };
      } catch (err) {
        return friendlyError(err);
      }
    },
  });

  const writeFileTool = tool({
    description:
      "Write/overwrite a project file. Path must be inside src/, public/ or functions/.",
    inputSchema: z
      .object({
        file: z.string().min(1),
        content: z.string(),
      })
      .passthrough(),
    execute: async ({ file, content }) => {
      try {
        await fs.writeTextFile(file, content);
        opts.onFileChange?.(file, content);
        return { ok: true };
      } catch (err) {
        auditPathRejection(err, "write");
        return friendlyError(err);
      }
    },
  });

  const replaceInFileTool = tool({
    description:
      "Find-and-replace text in a project file. Replaces first or all matches.",
    inputSchema: z
      .object({
        file: z.string().min(1),
        search: z.string(),
        replace: z.string(),
        all: z.boolean().default(true),
      })
      .passthrough(),
    execute: async ({ file, search, replace, all }) => {
      try {
        const before = await fs.readTextFile(file);
        if (!before.includes(search)) {
          return {
            ok: false,
            error: `String not found in ${file}: ${JSON.stringify(search.slice(0, 80))}`,
          };
        }
        const after = all
          ? before.split(search).join(replace)
          : before.replace(search, replace);
        await fs.writeTextFile(file, after);
        opts.onFileChange?.(file, after);
        return { ok: true };
      } catch (err) {
        return friendlyError(err);
      }
    },
  });

  const appendToFileTool = tool({
    description: "Append a string to a project file (creates the file if missing).",
    inputSchema: z
      .object({
        file: z.string().min(1),
        content: z.string(),
      })
      .passthrough(),
    execute: async ({ file, content }) => {
      try {
        let existing = "";
        try {
          existing = await fs.readTextFile(file);
        } catch {
          /* file may not exist yet — that's ok */
        }
        const next = existing + content;
        await fs.writeTextFile(file, next);
        opts.onFileChange?.(file, next);
        return { ok: true };
      } catch (err) {
        return friendlyError(err);
      }
    },
  });

  const listFilesTool = tool({
    description: "List files / directories under a project path.",
    inputSchema: z
      .object({
        path: z.string().default("").describe("Project-relative path. Empty = root."),
        recursive: z.boolean().default(false),
        maxDepth: z.number().int().min(1).max(8).default(3),
      })
      .passthrough(),
    execute: async ({ path, recursive, maxDepth }) => {
      try {
        const entries = await fs.list({
          path: path || undefined,
          recursive,
          maxDepth,
        });
        return { ok: true, entries };
      } catch (err) {
        return friendlyError(err);
      }
    },
  });

  const searchFilesTool = tool({
    description: "Search for a literal string across project files.",
    inputSchema: z
      .object({
        query: z.string().min(1),
        path: z.string().default(""),
        maxResults: z.number().int().min(1).max(500).default(100),
      })
      .passthrough(),
    execute: async ({ query, path, maxResults }) => {
      try {
        const results = await fs.search({
          query,
          path: path || undefined,
          maxResults,
        });
        return { ok: true, results };
      } catch (err) {
        return friendlyError(err);
      }
    },
  });

  const makeDirectoryTool = tool({
    description: "Create a directory (mkdir -p) inside src/, public/ or functions/.",
    inputSchema: z.object({ path: z.string().min(1) }).passthrough(),
    execute: async ({ path }) => {
      try {
        await fs.mkdir(path);
        return { ok: true };
      } catch (err) {
        auditPathRejection(err, "mkdir");
        return friendlyError(err);
      }
    },
  });

  const movePathTool = tool({
    description: "Rename or move a file/directory inside the project.",
    inputSchema: z
      .object({ from: z.string().min(1), to: z.string().min(1) })
      .passthrough(),
    execute: async ({ from, to }) => {
      try {
        await fs.rename(from, to);
        opts.onFileDelete?.(from);
        // For follow-up commits, the new file will be picked up next read
        // or via subsequent writes. We don't read content here — too
        // expensive for large files.
        return { ok: true };
      } catch (err) {
        auditPathRejection(err, "rename");
        return friendlyError(err);
      }
    },
  });

  const deletePathTool = tool({
    description: "Delete a file or directory (recursive). Idempotent.",
    inputSchema: z.object({ path: z.string().min(1) }).passthrough(),
    execute: async ({ path }) => {
      try {
        await fs.remove(path);
        opts.onFileDelete?.(path);
        return { ok: true };
      } catch (err) {
        auditPathRejection(err, "remove");
        return friendlyError(err);
      }
    },
  });

  // ---- Build tools ------------------------------------------------------

  const requestRebuildTool = tool({
    description:
      "Force a project rebuild. Only use when the user explicitly asks (e.g. after fixing a build error).",
    inputSchema: z.object({}).passthrough(),
    execute: async () => {
      const res = await buildQueue.enqueue({
        projectId,
        reason: "manual",
      });
      return { ok: true, jobId: res.jobId, status: res.status };
    },
  });

  const getBuildLogsTool = tool({
    description:
      "Get the most recent build's structured errors/warnings + raw stdout/stderr.",
    inputSchema: z.object({}).passthrough(),
    execute: async () => {
      const active = buildQueue.getActive(projectId);
      if (active?.result) {
        return { ok: true, source: "running", build: active.result };
      }
      // No persistent storage of finished jobs in Phase 3 — caller can
      // subscribe to build-status SSE for finals. Return a friendly hint.
      return {
        ok: false,
        error: "No completed build available; subscribe to /api/projects/<id>/build-status for live updates.",
      };
    },
  });

  return {
    readFileTool,
    writeFileTool,
    replaceInFileTool,
    appendToFileTool,
    listFilesTool,
    searchFilesTool,
    makeDirectoryTool,
    movePathTool,
    deletePathTool,
    requestRebuildTool,
    getBuildLogsTool,
  };
};

// Re-export for callers that want to render whitelist messages outside
// the tool flow (e.g. UI upload error overlay).
export { explainNonWritable };
