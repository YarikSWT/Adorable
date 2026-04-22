// Контрактные тесты для SandboxProvider.
//
// Крутятся против MockSandboxProvider. Та же последовательность сценариев
// в следующей итерации будет выполняться и против DockerSandboxProvider
// (через отдельный suite, который активируется по env).

import { describe, it, expect, beforeEach } from "vitest";

import {
  createSandboxProvider,
  type SandboxProvider,
  resolveSandboxProviderName,
} from "@/lib/adapters/sandbox";

const getMock = async (): Promise<SandboxProvider> => {
  return createSandboxProvider({ providerOverride: "mock" });
};

describe("resolveSandboxProviderName", () => {
  it("defaults to mock in test env", () => {
    expect(resolveSandboxProviderName()).toBe("mock");
  });

  it("honours override", () => {
    expect(resolveSandboxProviderName("docker")).toBe("docker");
  });
});

describe("SandboxProvider contract (mock)", () => {
  let provider: SandboxProvider;

  beforeEach(async () => {
    provider = await getMock();
  });

  it("create returns a handle with running status", async () => {
    const h = await provider.create({ repoId: "r1" });
    expect(h.sandboxId).toMatch(/^mock-sbx-r1-/);
    expect(h.repoId).toBe("r1");
    expect(h.workdir).toBe("/workspace");
    expect(h.status).toBe("running");
    expect(h.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("ref rehydrates the same sandbox", async () => {
    const h = await provider.create({ repoId: "r1" });
    const h2 = await provider.ref({ sandboxId: h.sandboxId });
    expect(h2.sandboxId).toBe(h.sandboxId);
    expect(h2.repoId).toBe("r1");
  });

  it("ref throws on unknown sandboxId", async () => {
    await expect(
      provider.ref({ sandboxId: "mock-sbx-unknown" }),
    ).rejects.toThrow(/unknown sandboxId/);
  });

  it("ref with mismatched repoId throws", async () => {
    const h = await provider.create({ repoId: "r1" });
    await expect(
      provider.ref({ sandboxId: h.sandboxId, repoId: "r2" }),
    ).rejects.toThrow(/belongs to repo/);
  });

  it("destroy marks sandbox stopped and removes from list", async () => {
    const h = await provider.create({ repoId: "r1" });
    await provider.destroy(h.sandboxId);
    expect(h.status).toBe("error"); // removed → default
    const list = await provider.list();
    expect(list.find((s) => s.sandboxId === h.sandboxId)).toBeUndefined();
  });

  it("destroy is idempotent", async () => {
    const h = await provider.create({ repoId: "r1" });
    await provider.destroy(h.sandboxId);
    await expect(provider.destroy(h.sandboxId)).resolves.toBeUndefined();
  });

  it("list returns all active sandboxes", async () => {
    await provider.create({ repoId: "r1" });
    await provider.create({ repoId: "r2" });
    const list = await provider.list();
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.map((s) => s.repoId)).toEqual(
      expect.arrayContaining(["r1", "r2"]),
    );
  });
});

describe("SandboxFs (mock)", () => {
  it("writeTextFile + readTextFile roundtrip", async () => {
    const provider = await getMock();
    const h = await provider.create({ repoId: "r1" });

    await h.fs.writeTextFile("hello.txt", "hi from agent");
    const back = await h.fs.readTextFile("hello.txt");
    expect(back).toBe("hi from agent");

    expect(await h.fs.exists("hello.txt")).toBe(true);
    expect(await h.fs.exists("nope.txt")).toBe(false);
  });

  it("readTextFile throws on missing file", async () => {
    const provider = await getMock();
    const h = await provider.create({ repoId: "r1" });
    await expect(h.fs.readTextFile("missing.md")).rejects.toThrow(
      /file not found/,
    );
  });

  it("normalizes path against workdir", async () => {
    const provider = await getMock();
    const h = await provider.create({ repoId: "r1", workdir: "/ws" });
    await h.fs.writeTextFile("pkg.json", "{}");
    const mock = provider as unknown as {
      inspect: (id: string) => { files: Map<string, string> } | undefined;
    };
    const state = mock.inspect(h.sandboxId);
    expect(state?.files.has("/ws/pkg.json")).toBe(true);
  });
});

describe("Sandbox exec (mock)", () => {
  it("default exec returns ok with empty stdout", async () => {
    const provider = await getMock();
    const h = await provider.create({ repoId: "r1" });
    const r = await h.exec({ command: "echo hello" });
    expect(r).toMatchObject({
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      command: "echo hello",
    });
  });

  it("custom exec handler can simulate git HEAD lookup", async () => {
    const provider = (await getMock()) as unknown as {
      setExecHandler: (
        id: string,
        h: (o: { command: string }) => { ok: true; exitCode: 0; stdout: string; stderr: string; command: string },
      ) => void;
    } & SandboxProvider;
    const h = await provider.create({ repoId: "r1" });
    provider.setExecHandler(h.sandboxId, ({ command }) => ({
      ok: true,
      exitCode: 0,
      stdout: command.includes("rev-parse") ? "deadbeef0123456789\n" : "",
      stderr: "",
      command,
    }));

    const r = await h.exec({ command: "git rev-parse HEAD" });
    expect(r.stdout.trim()).toBe("deadbeef0123456789");
  });
});

describe("Sandbox devServer (mock)", () => {
  it("getLogs returns empty array by default", async () => {
    const provider = await getMock();
    const h = await provider.create({ repoId: "r1" });
    const logs = await h.devServer.getLogs();
    expect(Array.isArray(logs) ? logs : []).toEqual([]);
  });
});

describe("Domains + ports (mock)", () => {
  it("records domains and fills default ports", async () => {
    const provider = await getMock();
    const h = await provider.create({
      repoId: "r1",
      domains: [
        { hostname: "preview.local", sandboxPort: 3000, role: "preview" },
        {
          hostname: "term.local",
          sandboxPort: 3010,
          role: "devCommandTerminal",
        },
      ],
    });
    expect(h.domains).toHaveLength(2);
    expect(h.ports.preview).toBe(3000);
    expect(h.ports.devCommandTerminal).toBe(3010);
    // additionalTerminals still has default.
    expect(h.ports.additionalTerminals).toBe(3020);
  });
});
