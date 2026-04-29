// Tests for git-gitea listRepos pagination — Gitea caps `?limit=N` at
// its per-page setting (default 50). Without pagination an instance
// with >50 repos would silently drop everything past page 1, breaking
// ACL checks for newly-created projects (the wrapper repo wouldn't
// appear in identity.permissions.git.list() → 403 on the API).

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { createGiteaGitProvider } from "@/lib/adapters/git-gitea";

let fetchSpy: MockInstance;
const originalBase = process.env["GITEA_BASE_URL"];
const originalToken = process.env["GITEA_TOKEN"];

const makeRepoPage = (count: number, startIdx: number) =>
  Array.from({ length: count }, (_, i) => ({
    full_name: `adorable/repo-${startIdx + i}`,
    name: `repo-${startIdx + i}`,
  }));

const mockResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const giteaProvider = () => createGiteaGitProvider();

beforeEach(() => {
  fetchSpy = vi.spyOn(global, "fetch");
  process.env["GITEA_BASE_URL"] = "http://gitea.test";
  process.env["GITEA_TOKEN"] = "tok";
});

afterEach(() => {
  fetchSpy.mockRestore();
  if (originalBase === undefined) delete process.env["GITEA_BASE_URL"];
  else process.env["GITEA_BASE_URL"] = originalBase;
  if (originalToken === undefined) delete process.env["GITEA_TOKEN"];
  else process.env["GITEA_TOKEN"] = originalToken;
});

describe("git-gitea listRepos pagination", () => {
  it("returns single page when total ≤ PAGE_SIZE (no second request)", async () => {
    fetchSpy.mockImplementationOnce(async () =>
      mockResponse(makeRepoPage(10, 0)),
    );
    const provider = giteaProvider();
    const out = await provider.listRepos({ limit: 50 });
    expect(out).toHaveLength(10);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((fetchSpy.mock.calls[0]![0] as string)).toMatch(/page=1/);
  });

  it("paginates when first page is full and limit > PAGE_SIZE", async () => {
    fetchSpy
      .mockImplementationOnce(async () => mockResponse(makeRepoPage(50, 0)))
      .mockImplementationOnce(async () => mockResponse(makeRepoPage(50, 50)))
      .mockImplementationOnce(async () => mockResponse(makeRepoPage(20, 100)));
    const provider = giteaProvider();
    const out = await provider.listRepos({ limit: 200 });
    expect(out).toHaveLength(120);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect((fetchSpy.mock.calls[1]![0] as string)).toMatch(/page=2/);
    expect((fetchSpy.mock.calls[2]![0] as string)).toMatch(/page=3/);
  });

  it("stops at caller-requested limit even mid-page", async () => {
    fetchSpy
      .mockImplementationOnce(async () => mockResponse(makeRepoPage(50, 0)))
      .mockImplementationOnce(async () => mockResponse(makeRepoPage(50, 50)));
    const provider = giteaProvider();
    const out = await provider.listRepos({ limit: 75 });
    expect(out).toHaveLength(75);
    // Two pages fetched (50 + 25 from the second).
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("stops on first non-ok response", async () => {
    fetchSpy
      .mockImplementationOnce(async () => mockResponse(makeRepoPage(50, 0)))
      .mockImplementationOnce(async () => mockResponse({ error: "x" }, 500));
    const provider = giteaProvider();
    const out = await provider.listRepos({ limit: 200 });
    expect(out).toHaveLength(50); // only first page survives
  });

  it("stops when page returns less than PAGE_SIZE (last page)", async () => {
    fetchSpy
      .mockImplementationOnce(async () => mockResponse(makeRepoPage(50, 0)))
      .mockImplementationOnce(async () => mockResponse(makeRepoPage(7, 50)));
    const provider = giteaProvider();
    const out = await provider.listRepos({ limit: 200 });
    expect(out).toHaveLength(57);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // no third call
  });
});
