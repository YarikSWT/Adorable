// Тесты для shouldEnqueueAfterTurn — pure helper для chat onFinish.

import { describe, expect, it } from "vitest";

import {
  SANDBOX_CAPABILITIES,
  STATIC_CAPABILITIES,
  type PreviewCapabilities,
} from "@/lib/adapters/preview";
import { shouldEnqueueAfterTurn } from "@/lib/preview/post-turn";

describe("shouldEnqueueAfterTurn", () => {
  it("returns false for sandbox capabilities (hotReload=true)", () => {
    expect(shouldEnqueueAfterTurn(SANDBOX_CAPABILITIES)).toBe(false);
  });

  it("returns true for static capabilities (hotReload=false, manualRebuild=true)", () => {
    expect(shouldEnqueueAfterTurn(STATIC_CAPABILITIES)).toBe(true);
  });

  it("returns false when manualRebuild=false (queue not active)", () => {
    const noBuild: PreviewCapabilities = {
      shellAccess: false,
      customDependencies: false,
      serverRuntime: false,
      hotReload: false,
      manualRebuild: false,
    };
    expect(shouldEnqueueAfterTurn(noBuild)).toBe(false);
  });

  it("hotReload takes precedence over manualRebuild", () => {
    const conflicting: PreviewCapabilities = {
      shellAccess: true,
      customDependencies: true,
      serverRuntime: true,
      hotReload: true,
      manualRebuild: true,
    };
    expect(shouldEnqueueAfterTurn(conflicting)).toBe(false);
  });
});
