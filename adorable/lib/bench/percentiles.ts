// Pure helpers for benchmark analysis.
//
// Used by `scripts/bench-static-build.ts` to compute p50/p95/p99 from
// build durations and to extract `build_finished` events from an audit
// log file. Pure (no I/O) so percentile math is unit-testable without
// running a real benchmark — and so the script's logic is verifiable
// before we burn staging time on a 100-iteration run.

export interface BuildFinishedSample {
  jobId: string;
  projectId: string;
  status: string;
  exitCode: number;
  durationMs: number;
  errorsCount: number;
  /** ISO timestamp from the audit log line. */
  ts?: string;
}

// Linear-interpolation percentile (R-7 / Excel default). Equivalent to
// numpy.percentile with the `linear` interpolation method.
//
// Returns NaN for an empty input — caller should special-case the
// "no samples" presentation rather than printing "NaN ms".
export const percentile = (
  samples: readonly number[],
  p: number,
): number => {
  if (samples.length === 0) return Number.NaN;
  if (p <= 0) return samples.reduce((a, b) => Math.min(a, b), samples[0]!);
  if (p >= 100) return samples.reduce((a, b) => Math.max(a, b), samples[0]!);

  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const frac = rank - lo;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
};

export interface PercentileSummary {
  count: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** Arithmetic mean — useful when comparing tail vs body of distribution. */
  mean: number;
  successCount: number;
  failureCount: number;
  /** Fraction in [0,1]; NaN when count is 0. */
  successRate: number;
}

export const summarise = (
  samples: readonly BuildFinishedSample[],
): PercentileSummary => {
  if (samples.length === 0) {
    return {
      count: 0,
      min: Number.NaN,
      p50: Number.NaN,
      p95: Number.NaN,
      p99: Number.NaN,
      max: Number.NaN,
      mean: Number.NaN,
      successCount: 0,
      failureCount: 0,
      successRate: Number.NaN,
    };
  }

  const durations = samples.map((s) => s.durationMs);
  const successCount = samples.filter((s) => s.status === "succeeded").length;
  const failureCount = samples.length - successCount;

  return {
    count: samples.length,
    min: percentile(durations, 0),
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    max: percentile(durations, 100),
    mean: durations.reduce((a, b) => a + b, 0) / durations.length,
    successCount,
    failureCount,
    successRate: successCount / samples.length,
  };
};

// Parse a JSONL audit log (one event per line) and return only
// `build_finished` events. Robust against:
//   - blank lines
//   - lines that aren't valid JSON
//   - JSON objects with no `event` field or a different event type
// Bad lines are silently dropped — the bench script's job is to report
// percentiles, not validate log integrity.
export const parseBuildFinishedFromAuditLog = (
  text: string,
): BuildFinishedSample[] => {
  const out: BuildFinishedSample[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const obj = parsed as Record<string, unknown>;
    if (obj["event"] !== "build_finished") continue;

    const jobId = typeof obj["jobId"] === "string" ? obj["jobId"] : "";
    const projectId =
      typeof obj["projectId"] === "string" ? obj["projectId"] : "";
    const status = typeof obj["status"] === "string" ? obj["status"] : "";
    const exitCode =
      typeof obj["exitCode"] === "number" ? obj["exitCode"] : Number.NaN;
    const durationMs =
      typeof obj["durationMs"] === "number" ? obj["durationMs"] : Number.NaN;
    const errorsCount =
      typeof obj["errorsCount"] === "number" ? obj["errorsCount"] : 0;
    if (!jobId || !projectId || !status || !Number.isFinite(durationMs)) {
      continue;
    }
    const ts = typeof obj["ts"] === "string" ? obj["ts"] : undefined;
    out.push({
      jobId,
      projectId,
      status,
      exitCode,
      durationMs,
      errorsCount,
      ...(ts ? { ts } : {}),
    });
  }
  return out;
};

// Filter samples to events whose `ts` falls within [since, until]. Used
// by the bench script so that pre-existing build_finished events from
// before the bench run don't pollute the stats. Inclusive bounds.
export const filterByTimeRange = (
  samples: readonly BuildFinishedSample[],
  since: Date,
  until: Date,
): BuildFinishedSample[] => {
  const sinceMs = since.getTime();
  const untilMs = until.getTime();
  return samples.filter((s) => {
    if (!s.ts) return false;
    const t = new Date(s.ts).getTime();
    if (!Number.isFinite(t)) return false;
    return t >= sinceMs && t <= untilMs;
  });
};
