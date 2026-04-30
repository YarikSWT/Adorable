// Pure tests for lib/bench/audit-summary.ts.
//
// Exercises the counter logic and alert thresholds against synthetic
// JSONL audit logs. No I/O, no docker, no live server.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_THRESHOLDS,
  evaluateAlerts,
  parseAuditLog,
  summariseAudit,
} from "@/lib/bench/audit-summary";

const log = (entries: ReadonlyArray<Record<string, unknown>>): string =>
  entries.map((e) => JSON.stringify(e)).join("\n");

describe("parseAuditLog", () => {
  it("returns [] on empty input", () => {
    expect(parseAuditLog("")).toEqual([]);
  });

  it("drops non-JSON / non-object lines", () => {
    const text = [
      "not json",
      JSON.stringify({ event: "build_started", jobId: "j-1" }),
      JSON.stringify(["array", "not", "object"]),
      "{half-json",
    ].join("\n");
    const out = parseAuditLog(text);
    expect(out).toHaveLength(1);
    expect(out[0].event).toBe("build_started");
  });

  it("preserves all opaque columns on parsed entries", () => {
    const text = JSON.stringify({
      event: "custom",
      ts: "2026-04-30T08:00:00Z",
      arbitrary: { nested: 42 },
    });
    const out = parseAuditLog(text);
    expect(out[0].arbitrary).toEqual({ nested: 42 });
  });
});

describe("summariseAudit — counters", () => {
  it("counts event types and lifecycle events", () => {
    const text = log([
      { event: "build_started", jobId: "j-1", projectId: "p-1", ts: "2026-04-30T08:00:00.000Z" },
      { event: "build_finished", jobId: "j-1", projectId: "p-1", status: "succeeded", durationMs: 1200, ts: "2026-04-30T08:00:01.200Z" },
      { event: "build_started", jobId: "j-2", projectId: "p-1", ts: "2026-04-30T08:01:00.000Z" },
      { event: "build_finished", jobId: "j-2", projectId: "p-1", status: "failed", durationMs: 8000, ts: "2026-04-30T08:01:08.000Z" },
      { event: "build_started", jobId: "j-3", projectId: "p-1", ts: "2026-04-30T08:02:00.000Z" },
      { event: "build_runner_killed_timeout", jobId: "j-3", projectId: "p-1", ts: "2026-04-30T08:04:00.000Z" },
      { event: "build_finished", jobId: "j-3", projectId: "p-1", status: "failed", exitCode: 137, durationMs: 120000, ts: "2026-04-30T08:04:00.001Z" },
      { event: "upload_rejected", projectId: "p-1", ts: "2026-04-30T08:05:00.000Z" },
      { event: "path_rejected", projectId: "p-1", ts: "2026-04-30T08:06:00.000Z" },
      { event: "auth_denied", projectId: "p-1", ts: "2026-04-30T08:07:00.000Z" },
    ]);

    const s = summariseAudit(text);
    expect(s.totalLines).toBe(10);
    expect(s.parsedLines).toBe(10);
    expect(s.malformedLines).toBe(0);
    expect(s.buildsStarted).toBe(3);
    expect(s.buildsFinished).toBe(3);
    expect(s.buildsSucceeded).toBe(1);
    expect(s.buildsFailed).toBe(2);
    expect(s.buildsKilledByTimeout).toBe(1);
    expect(s.uploadRejected).toBe(1);
    expect(s.pathRejected).toBe(1);
    expect(s.authDenied).toBe(1);
    expect(s.buildSuccessRate).toBeCloseTo(1 / 3, 5);
    expect(s.firstTs).toBe("2026-04-30T08:00:00.000Z");
    expect(s.lastTs).toBe("2026-04-30T08:07:00.000Z");
  });

  it("returns NaN successRate when no builds finished", () => {
    const text = log([
      { event: "auth_denied", ts: "2026-04-30T08:00:00.000Z" },
    ]);
    const s = summariseAudit(text);
    expect(s.buildsFinished).toBe(0);
    expect(Number.isNaN(s.buildSuccessRate)).toBe(true);
  });

  it("counts cancelled status correctly", () => {
    const text = log([
      { event: "build_finished", jobId: "j", projectId: "p", status: "succeeded", ts: "2026-04-30T08:00:01Z" },
      { event: "build_finished", jobId: "j", projectId: "p", status: "cancelled", ts: "2026-04-30T08:00:02Z" },
    ]);
    const s = summariseAudit(text);
    expect(s.buildsSucceeded).toBe(1);
    expect(s.buildsCancelled).toBe(1);
    expect(s.buildsFailed).toBe(0);
  });

  it("tracks malformedLines for non-parseable input", () => {
    const text = "not json\n{half\n" + JSON.stringify({ event: "build_started" });
    const s = summariseAudit(text);
    expect(s.totalLines).toBe(3);
    expect(s.parsedLines).toBe(1);
    expect(s.malformedLines).toBe(2);
  });

  it("respects since/until time window", () => {
    const text = log([
      { event: "build_finished", jobId: "j-1", projectId: "p", status: "succeeded", ts: "2026-04-30T07:59:59.000Z" },
      { event: "build_finished", jobId: "j-2", projectId: "p", status: "succeeded", ts: "2026-04-30T08:00:30.000Z" },
      { event: "build_finished", jobId: "j-3", projectId: "p", status: "failed", ts: "2026-04-30T08:01:30.000Z" },
    ]);
    const s = summariseAudit(text, {
      since: new Date("2026-04-30T08:00:00.000Z"),
      until: new Date("2026-04-30T08:01:00.000Z"),
    });
    expect(s.buildsFinished).toBe(1);
    expect(s.buildsSucceeded).toBe(1);
    expect(s.buildsFailed).toBe(0);
  });
});

describe("evaluateAlerts", () => {
  const baseSummary = (): ReturnType<typeof summariseAudit> =>
    summariseAudit("");

  it("does not page when there are no signals", () => {
    const evalRes = evaluateAlerts(baseSummary());
    expect(evalRes.shouldPage).toBe(false);
  });

  it("pages on build success rate below threshold (with enough samples)", () => {
    const text = log([
      ...Array.from({ length: 18 }, (_, i) => ({
        event: "build_finished",
        jobId: `j-${i}`,
        projectId: "p",
        status: "succeeded",
        ts: `2026-04-30T08:0${Math.floor(i / 10)}:${(i % 10).toString().padStart(2, "0")}.000Z`,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        event: "build_finished",
        jobId: `f-${i}`,
        projectId: "p",
        status: "failed",
        ts: `2026-04-30T08:1${i}:00.000Z`,
      })),
    ]);
    const s = summariseAudit(text);
    // 18/22 = 81.8% < 95%
    expect(s.buildSuccessRate).toBeLessThan(DEFAULT_THRESHOLDS.buildSuccessRateMin);
    const evalRes = evaluateAlerts(s);
    expect(evalRes.shouldPage).toBe(true);
    expect(evalRes.alerts.find((a) => a.key === "build_success_rate")).toBeDefined();
  });

  it("does NOT page on low success rate when sample count is below minSamples", () => {
    const text = log([
      { event: "build_finished", jobId: "j-1", projectId: "p", status: "failed", ts: "2026-04-30T08:00:00Z" },
      { event: "build_finished", jobId: "j-2", projectId: "p", status: "succeeded", ts: "2026-04-30T08:00:01Z" },
    ]);
    const s = summariseAudit(text);
    expect(s.buildSuccessRate).toBe(0.5);
    const evalRes = evaluateAlerts(s);
    expect(evalRes.shouldPage).toBe(false);
  });

  it("pages on >= killedByTimeoutMax timeouts", () => {
    const text = log(
      Array.from({ length: 5 }, (_, i) => ({
        event: "build_runner_killed_timeout",
        jobId: `j-${i}`,
        projectId: "p",
        ts: `2026-04-30T08:0${i}:00.000Z`,
      })),
    );
    const s = summariseAudit(text);
    const evalRes = evaluateAlerts(s);
    expect(evalRes.shouldPage).toBe(true);
    expect(evalRes.alerts.find((a) => a.key === "build_runner_killed_timeout")).toBeDefined();
  });

  it("warns (not pages) on path/upload rejected", () => {
    const text = log([
      { event: "path_rejected", projectId: "p", ts: "2026-04-30T08:00:00Z" },
      { event: "upload_rejected", projectId: "p", ts: "2026-04-30T08:00:01Z" },
    ]);
    const evalRes = evaluateAlerts(summariseAudit(text));
    expect(evalRes.shouldPage).toBe(false);
    const keys = evalRes.alerts.map((a) => a.key).sort();
    expect(keys).toContain("path_rejected");
    expect(keys).toContain("upload_rejected");
  });

  it("warns when malformed lines are present", () => {
    const evalRes = evaluateAlerts(summariseAudit("garbage\n{half"));
    expect(evalRes.alerts.find((a) => a.key === "malformed_lines")).toBeDefined();
    expect(evalRes.shouldPage).toBe(false);
  });
});
