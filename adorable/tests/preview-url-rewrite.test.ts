// Изоляция логики rewritePreviewPort из app/api/repos/route.ts.
//
// Сам route.ts держит rewritePreviewPort как внутренний хелпер — выносить
// его в отдельный модуль ради теста было бы overkill, поэтому повторяем
// тут шаг-в-шаг ту же реализацию и тестируем семантику. Если route.ts
// меняется — этот файл придётся синхронизировать. Это сознательный
// trade-off: тестировать публичный route handler через mock cookies +
// mock провайдеров слишком тяжело ради одной 20-строчной чистой функции.

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const rewritePreviewPort = (url: string | undefined): string | undefined => {
  if (!url) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.port) return url;
  const envPort =
    process.env["PREVIEW_PUBLIC_PORT"] ?? process.env["CADDY_HTTP_PORT"];
  const port = envPort ? Number.parseInt(envPort, 10) : NaN;
  if (!Number.isFinite(port) || port <= 0) return url;
  const defaultPort = parsed.protocol === "https:" ? 443 : 80;
  if (port === defaultPort) return url;
  parsed.port = String(port);
  return parsed.toString().replace(/\/$/, "");
};

const pristineEnv = { ...process.env };
const cleanup = () => {
  delete process.env.PREVIEW_PUBLIC_PORT;
  delete process.env.CADDY_HTTP_PORT;
};

beforeEach(cleanup);
afterEach(() => {
  cleanup();
  for (const [k, v] of Object.entries(pristineEnv)) {
    if (v !== undefined) process.env[k] = v;
  }
});

describe("rewritePreviewPort", () => {
  it("appends CADDY_HTTP_PORT when URL has no explicit port (dev case)", () => {
    process.env.CADDY_HTTP_PORT = "8080";
    expect(
      rewritePreviewPort("http://abc.preview.localhost"),
    ).toBe("http://abc.preview.localhost:8080");
  });

  it("PREVIEW_PUBLIC_PORT перекрывает CADDY_HTTP_PORT", () => {
    process.env.CADDY_HTTP_PORT = "8080";
    process.env.PREVIEW_PUBLIC_PORT = "9090";
    expect(
      rewritePreviewPort("http://abc.preview.localhost"),
    ).toBe("http://abc.preview.localhost:9090");
  });

  it("does not append when URL already has explicit port", () => {
    process.env.CADDY_HTTP_PORT = "8080";
    expect(
      rewritePreviewPort("http://abc.preview.localhost:1234/"),
    ).toBe("http://abc.preview.localhost:1234/");
  });

  it("does not append when env port equals protocol default (prod 80)", () => {
    process.env.CADDY_HTTP_PORT = "80";
    expect(
      rewritePreviewPort("http://abc.preview.localhost"),
    ).toBe("http://abc.preview.localhost");
  });

  it("does not append when env port equals protocol default (prod 443)", () => {
    process.env.CADDY_HTTP_PORT = "443";
    expect(
      rewritePreviewPort("https://abc.preview.example.com"),
    ).toBe("https://abc.preview.example.com");
  });

  it("falls through when env not set", () => {
    expect(rewritePreviewPort("http://abc.preview.localhost")).toBe(
      "http://abc.preview.localhost",
    );
  });

  it("ignores invalid env port", () => {
    process.env.CADDY_HTTP_PORT = "not-a-number";
    expect(rewritePreviewPort("http://abc.preview.localhost")).toBe(
      "http://abc.preview.localhost",
    );
  });

  it("returns undefined input unchanged", () => {
    expect(rewritePreviewPort(undefined)).toBeUndefined();
  });

  it("returns malformed URL input unchanged", () => {
    process.env.CADDY_HTTP_PORT = "8080";
    expect(rewritePreviewPort("not a url")).toBe("not a url");
  });

  it("dev-command + terminals subdomains get same treatment", () => {
    process.env.CADDY_HTTP_PORT = "8080";
    expect(
      rewritePreviewPort("http://dev-command-abc.preview.localhost"),
    ).toBe("http://dev-command-abc.preview.localhost:8080");
    expect(
      rewritePreviewPort("http://terminals-abc.preview.localhost"),
    ).toBe("http://terminals-abc.preview.localhost:8080");
  });
});
