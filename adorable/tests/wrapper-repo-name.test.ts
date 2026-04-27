// Tests for isWrapperRepoName / stripWrapperPrefix.
//
// Background: ADORABLE_WRAPPER_REPO_PREFIX = "adorable-meta - " (с пробелами),
// но Gitea sanitiz'ит spaces → dashes, поэтому в проде имена приезжают
// как "adorable-meta-..." или "adorable-meta - ..." (если кто-то создал
// через mock или экспортировал raw). Хелперы должны распознавать оба
// формата, иначе wrapper-фильтр в /api/repos GET ничего не находит и
// HomeWelcome grid пуст.

import { describe, it, expect } from "vitest";
import {
  ADORABLE_WRAPPER_REPO_PREFIX,
  isWrapperRepoName,
  stripWrapperPrefix,
} from "@/lib/repo-storage";

describe("isWrapperRepoName", () => {
  it("matches mock-style name with spaces", () => {
    expect(isWrapperRepoName(`${ADORABLE_WRAPPER_REPO_PREFIX}My App`)).toBe(
      true,
    );
  });

  it("matches Gitea-sanitized name (spaces → dashes)", () => {
    expect(isWrapperRepoName("adorable-meta---Mazda-MX-5")).toBe(true);
  });

  it("matches collapsed dashes from heavy sanitization", () => {
    expect(
      isWrapperRepoName("adorable-meta-----------------------Mazda-MX-5"),
    ).toBe(true);
  });

  it("matches plain hyphenated form without trailing whitespace", () => {
    expect(isWrapperRepoName("adorable-meta-foo")).toBe(true);
  });

  it("rejects non-wrapper repos", () => {
    expect(isWrapperRepoName("source-repo")).toBe(false);
    expect(isWrapperRepoName("adorable")).toBe(false);
    expect(isWrapperRepoName("adorable-something-else")).toBe(false);
  });

  it("rejects null/empty", () => {
    expect(isWrapperRepoName(null)).toBe(false);
    expect(isWrapperRepoName("")).toBe(false);
    expect(isWrapperRepoName(undefined)).toBe(false);
  });
});

describe("stripWrapperPrefix", () => {
  it("strips spaces-and-dash prefix", () => {
    expect(
      stripWrapperPrefix(`${ADORABLE_WRAPPER_REPO_PREFIX}Wholesale Flowers`),
    ).toBe("Wholesale Flowers");
  });

  it("strips Gitea-sanitized many-dashes prefix", () => {
    expect(
      stripWrapperPrefix("adorable-meta-----------------------Mazda-MX-5"),
    ).toBe("Mazda-MX-5");
  });

  it("strips minimal hyphenated form", () => {
    expect(stripWrapperPrefix("adorable-meta-foo")).toBe("foo");
  });

  it("returns the name itself for non-wrapper repos", () => {
    expect(stripWrapperPrefix("source-repo")).toBe("source-repo");
  });

  it("returns undefined for empty / nullish", () => {
    expect(stripWrapperPrefix(undefined)).toBeUndefined();
    expect(stripWrapperPrefix(null)).toBeUndefined();
    expect(stripWrapperPrefix("")).toBeUndefined();
  });
});
