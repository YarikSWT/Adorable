// Static PreviewProvider — заглушка для Phase 1 scaffolding.
// Реальная реализация (vite build в ephemeral docker-runner'е) — Phase 2.
import type { PreviewProvider } from "./preview";

export const createStaticPreviewProvider = (): PreviewProvider => {
  throw new Error(
    "preview-static: not implemented yet (Phase 2 of preview-provider migration).",
  );
};
