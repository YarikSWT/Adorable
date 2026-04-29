// Тесты для getSystemPrompt(capabilities) (CONTRACTS §14, ADR-010).

import { describe, expect, it } from "vitest";

import {
  SANDBOX_CAPABILITIES,
  STATIC_CAPABILITIES,
  type PreviewCapabilities,
} from "@/lib/adapters/preview";
import {
  getSystemPrompt,
  SANDBOX_SYSTEM_PROMPT,
  STATIC_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
} from "@/lib/system-prompt";

describe("getSystemPrompt — branches by shellAccess", () => {
  it("returns SANDBOX_SYSTEM_PROMPT for shellAccess=true", () => {
    expect(getSystemPrompt(SANDBOX_CAPABILITIES)).toBe(SANDBOX_SYSTEM_PROMPT);
  });

  it("returns STATIC_SYSTEM_PROMPT for shellAccess=false", () => {
    expect(getSystemPrompt(STATIC_CAPABILITIES)).toBe(STATIC_SYSTEM_PROMPT);
  });

  it("treats arbitrary capabilities — only shellAccess matters", () => {
    const weird: PreviewCapabilities = {
      shellAccess: true,
      customDependencies: false,
      serverRuntime: false,
      hotReload: false,
      manualRebuild: false,
    };
    expect(getSystemPrompt(weird)).toBe(SANDBOX_SYSTEM_PROMPT);
  });

  it("legacy SYSTEM_PROMPT export === SANDBOX_SYSTEM_PROMPT", () => {
    expect(SYSTEM_PROMPT).toBe(SANDBOX_SYSTEM_PROMPT);
  });
});

describe("STATIC_SYSTEM_PROMPT — content guarantees (ADR-010)", () => {
  it("contains the ARCHITECTURE CONSTRAINT block", () => {
    expect(STATIC_SYSTEM_PROMPT).toMatch(/ARCHITECTURE CONSTRAINT/);
  });

  it("explicitly lists React + Tailwind + react-router-dom + lucide-react", () => {
    for (const tech of [
      "React 18",
      "React Router DOM 6",
      "Tailwind CSS 3",
      "lucide-react",
    ]) {
      expect(STATIC_SYSTEM_PROMPT).toContain(tech);
    }
  });

  it("declares NOT AVAILABLE: server runtime / npm install", () => {
    expect(STATIC_SYSTEM_PROMPT).toMatch(/NOT AVAILABLE/);
    expect(STATIC_SYSTEM_PROMPT).toMatch(/npm install.*does NOT exist/i);
    expect(STATIC_SYSTEM_PROMPT).toMatch(/Express\/Fastify/i);
  });

  it("points the LLM at fetch + localStorage for data", () => {
    expect(STATIC_SYSTEM_PROMPT).toMatch(/fetch/);
    expect(STATIC_SYSTEM_PROMPT).toMatch(/localStorage/);
  });

  it("describes file layout: src/public/functions whitelist", () => {
    expect(STATIC_SYSTEM_PROMPT).toContain("src/**");
    expect(STATIC_SYSTEM_PROMPT).toContain("public/**");
    expect(STATIC_SYSTEM_PROMPT).toContain("functions/**");
  });

  it("lists fixed boilerplate files the LLM must NOT touch", () => {
    expect(STATIC_SYSTEM_PROMPT).toContain("package.json");
    expect(STATIC_SYSTEM_PROMPT).toContain("vite.config.js");
    expect(STATIC_SYSTEM_PROMPT).toContain("tailwind.config.js");
  });

  it("describes requestRebuildTool + getBuildLogsTool flow", () => {
    expect(STATIC_SYSTEM_PROMPT).toContain("requestRebuildTool");
    expect(STATIC_SYSTEM_PROMPT).toContain("getBuildLogsTool");
  });

  it("does NOT instruct the LLM to run npm install / npm run dev", () => {
    expect(STATIC_SYSTEM_PROMPT).not.toMatch(/npm run dev/);
    expect(STATIC_SYSTEM_PROMPT).not.toMatch(/^\s*\* npm install/m);
  });
});

describe("SANDBOX_SYSTEM_PROMPT — content guarantees", () => {
  it("still describes the npm install + dev server flow", () => {
    expect(SANDBOX_SYSTEM_PROMPT).toMatch(/npm install/);
    expect(SANDBOX_SYSTEM_PROMPT).toMatch(/npm run dev/);
  });
});
