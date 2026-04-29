// Mock PreviewProvider — заглушка для Phase 1 scaffolding.
// Реальная реализация (in-memory state, контракт-tests) — следующая итерация.
import type { PreviewProvider } from "./preview";

export const createMockPreviewProvider = (): PreviewProvider => {
  throw new Error(
    "preview-mock: not implemented yet (Phase 1 follow-up iter).",
  );
};
