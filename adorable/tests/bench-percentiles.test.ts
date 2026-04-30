// Pure unit tests for the bench helpers in lib/bench/percentiles.ts.
//
// Why this matters before staging: the bench script will run on
// production-sized N (≥100). If the percentile math is wrong, the
// staging numbers we report will be wrong — and acceptance gates in
// MIGRATION_PATH.md §6 will be checked against bad data.

import { describe, expect, it } from "vitest";

import {
  filterByTimeRange,
  parseBuildFinishedFromAuditLog,
  percentile,
  summarise,
  type BuildFinishedSample,
} from "@/lib/bench/percentiles";

const sample = (overrides: Partial<BuildFinishedSample> = {}): BuildFinishedSample => ({
  jobId: "j-1",
  projectId: "p-1",
  status: "succeeded",
  exitCode: 0,
  durationMs: 1_000,
  errorsCount: 0,
  ts: "2026-04-30T08:00:00.000Z",
  ...overrides,
});

describe("percentile", () => {
  it("returns NaN for empty input", () => {
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });

  it("returns the only sample for n=1", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 100)).toBe(42);
  });

  it("matches numpy linear-interpolation on a known sequence", () => {
    // For [1,2,3,4,5,6,7,8,9,10]:
    //   p50 = 5.5, p90 = 9.1, p95 = 9.55, p99 = 9.91
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(xs, 50)).toBeCloseTo(5.5, 5);
    expect(percentile(xs, 90)).toBeCloseTo(9.1, 5);
    expect(percentile(xs, 95)).toBeCloseTo(9.55, 5);
    expect(percentile(xs, 99)).toBeCloseTo(9.91, 5);
  });

  it("works regardless of input order (sorts internally)", () => {
    expect(percentile([10, 1, 5, 7, 3], 50)).toBe(5);
  });

  it("returns min for p<=0 and max for p>=100", () => {
    expect(percentile([5, 9, 1, 3, 7], 0)).toBe(1);
    expect(percentile([5, 9, 1, 3, 7], 100)).toBe(9);
  });
});

describe("summarise", () => {
  it("returns NaN-fields for empty input", () => {
    const s = summarise([]);
    expect(s.count).toBe(0);
    expect(Number.isNaN(s.p50)).toBe(true);
    expect(s.successCount).toBe(0);
    expect(s.failureCount).toBe(0);
  });

  it("computes per-stat breakdown of successes vs failures", () => {
    const xs = [
      sample({ durationMs: 1000, status: "succeeded" }),
      sample({ durationMs: 2000, status: "succeeded" }),
      sample({ durationMs: 5000, status: "failed", exitCode: 1 }),
      sample({ durationMs: 8000, status: "failed", exitCode: 137 }),
    ];
    const s = summarise(xs);
    expect(s.count).toBe(4);
    expect(s.successCount).toBe(2);
    expect(s.failureCount).toBe(2);
    expect(s.successRate).toBeCloseTo(0.5, 5);
    expect(s.min).toBe(1000);
    expect(s.max).toBe(8000);
    expect(s.mean).toBe(4000);
    // p50 for [1000,2000,5000,8000] (even count) = midpoint = 3500
    expect(s.p50).toBeCloseTo(3500, 5);
  });

  it("treats non-succeeded statuses as failures", () => {
    const xs = [
      sample({ status: "succeeded" }),
      sample({ status: "cancelled" }),
      sample({ status: "failed" }),
    ];
    const s = summarise(xs);
    expect(s.successCount).toBe(1);
    expect(s.failureCount).toBe(2);
  });
});

describe("parseBuildFinishedFromAuditLog", () => {
  it("returns [] for empty input", () => {
    expect(parseBuildFinishedFromAuditLog("")).toEqual([]);
  });

  it("extracts only build_finished events from mixed audit log", () => {
    const log = [
      JSON.stringify({ event: "build_started", jobId: "j-1", projectId: "p-1" }),
      JSON.stringify({
        event: "build_finished",
        jobId: "j-1",
        projectId: "p-1",
        status: "succeeded",
        exitCode: 0,
        durationMs: 8338,
        errorsCount: 0,
        ts: "2026-04-30T08:00:01.000Z",
      }),
      JSON.stringify({ event: "upload_rejected", projectId: "p-1" }),
      JSON.stringify({
        event: "build_finished",
        jobId: "j-2",
        projectId: "p-1",
        status: "failed",
        exitCode: 137,
        durationMs: 426259,
        errorsCount: 1,
      }),
    ].join("\n");

    const out = parseBuildFinishedFromAuditLog(log);
    expect(out).toHaveLength(2);
    expect(out[0].jobId).toBe("j-1");
    expect(out[0].status).toBe("succeeded");
    expect(out[1].status).toBe("failed");
    expect(out[1].exitCode).toBe(137);
  });

  it("silently drops malformed JSON lines", () => {
    const log = [
      "not json at all",
      JSON.stringify({
        event: "build_finished",
        jobId: "j-1",
        projectId: "p-1",
        status: "succeeded",
        exitCode: 0,
        durationMs: 1000,
        errorsCount: 0,
      }),
      "{half-json",
      "",
    ].join("\n");
    const out = parseBuildFinishedFromAuditLog(log);
    expect(out).toHaveLength(1);
    expect(out[0].jobId).toBe("j-1");
  });

  it("drops events missing required fields", () => {
    const log = [
      JSON.stringify({ event: "build_finished", jobId: "" }),
      JSON.stringify({
        event: "build_finished",
        jobId: "j-1",
        projectId: "p-1",
        status: "succeeded",
        exitCode: 0,
        durationMs: "not a number",
      }),
    ].join("\n");
    expect(parseBuildFinishedFromAuditLog(log)).toEqual([]);
  });
});

describe("filterByTimeRange", () => {
  it("includes events at the boundary inclusively", () => {
    const xs = [
      sample({ ts: "2026-04-30T08:00:00.000Z", jobId: "j-1" }),
      sample({ ts: "2026-04-30T08:00:30.000Z", jobId: "j-2" }),
      sample({ ts: "2026-04-30T08:01:00.000Z", jobId: "j-3" }),
    ];
    const since = new Date("2026-04-30T08:00:00.000Z");
    const until = new Date("2026-04-30T08:01:00.000Z");
    const out = filterByTimeRange(xs, since, until);
    expect(out.map((s) => s.jobId)).toEqual(["j-1", "j-2", "j-3"]);
  });

  it("excludes events outside the window", () => {
    const xs = [
      sample({ ts: "2026-04-30T07:59:59.000Z", jobId: "before" }),
      sample({ ts: "2026-04-30T08:00:30.000Z", jobId: "in" }),
      sample({ ts: "2026-04-30T08:01:00.001Z", jobId: "after" }),
    ];
    const since = new Date("2026-04-30T08:00:00.000Z");
    const until = new Date("2026-04-30T08:01:00.000Z");
    const out = filterByTimeRange(xs, since, until);
    expect(out.map((s) => s.jobId)).toEqual(["in"]);
  });

  it("excludes events without a ts field", () => {
    const xs = [
      sample({ ts: undefined, jobId: "no-ts" }),
      sample({ ts: "2026-04-30T08:00:30.000Z", jobId: "with-ts" }),
    ];
    const out = filterByTimeRange(
      xs,
      new Date("2026-04-30T08:00:00.000Z"),
      new Date("2026-04-30T08:01:00.000Z"),
    );
    expect(out.map((s) => s.jobId)).toEqual(["with-ts"]);
  });
});
