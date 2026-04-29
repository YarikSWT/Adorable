// Sandbox PreviewProvider — заглушка для Phase 1 scaffolding.
// Реальная реализация (обёртка над adorable-vm + sandboxProvider) — следующая
// итерация Phase 1 (см. MIGRATION_PATH.md).
import type { PreviewProvider } from "./preview";

export const createSandboxPreviewProvider = (): PreviewProvider => {
  throw new Error(
    "preview-sandbox: not implemented yet (Phase 1 follow-up iter).",
  );
};
