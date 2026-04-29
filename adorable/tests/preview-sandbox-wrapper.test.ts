// Структурные тесты для SandboxPreviewProvider.
//
// Реальные lifecycle операции (create → destroy) требуют live docker и
// проверяются интеграционно через sandbox-docker-* тесты + landing-flow-e2e.
// Здесь — только что обёртка имеет правильный shape, чтобы TS-контракт
// не разъезжался с реализацией.

import { describe, expect, it } from "vitest";

import {
  SANDBOX_CAPABILITIES,
  type PreviewProvider,
} from "@/lib/adapters/preview";
import { createSandboxPreviewProvider } from "@/lib/adapters/preview-sandbox";

describe("SandboxPreviewProvider (structural)", () => {
  it("declares name + sandbox capabilities", () => {
    const provider: PreviewProvider = createSandboxPreviewProvider();
    expect(provider.name).toBe("sandbox");
    expect(provider.capabilities).toEqual(SANDBOX_CAPABILITIES);
    expect(provider.capabilities.shellAccess).toBe(true);
    expect(provider.capabilities.hotReload).toBe(true);
    expect(provider.capabilities.serverRuntime).toBe(true);
    expect(provider.capabilities.customDependencies).toBe(true);
    expect(provider.capabilities.manualRebuild).toBe(true);
  });

  it("build returns a stub succeeded result (HMR — no real rebuild)", async () => {
    const provider = createSandboxPreviewProvider();
    const res = await provider.build({
      projectId: "any",
      reason: "turn-finished",
    });
    expect(res.status).toBe("succeeded");
    expect(res.exitCode).toBe(0);
    expect(res.wasSwapped).toBe(false);
    expect(res.errors).toEqual([]);
  });

  it("destroy / touch are idempotent for unknown projectId", async () => {
    const provider = createSandboxPreviewProvider();
    await provider.destroy("never-existed");
    await provider.touch("never-existed");
  });

  it("getProjectFs returns null for unknown projectId", async () => {
    const provider = createSandboxPreviewProvider();
    expect(await provider.getProjectFs("never-existed")).toBeNull();
  });
});
