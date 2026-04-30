// Pure helper for incident response and acceptance triage:
// summarise an audit JSONL log into actionable counters.
//
// Used by `scripts/audit-summary.ts` and by future automated alerts
// (#11 prokatka-monitoring). Pure — no I/O, no globals — so the
// counting logic is unit-testable on synthetic logs.
//
// Categories tracked separately from the raw event-type histogram
// because they map directly to alert thresholds in MONITORING.md:
//
//   - failure events (build-failed by exitCode!=0, build_runner_killed_timeout)
//   - rejection events (path_rejected, upload_rejected, auth_denied)
//   - lifecycle events (build_started/finished/swap pairs)
//
// All time fields use ISO timestamps from the `ts` column. Events
// without a `ts` are kept in `eventTypeCounts` but excluded from
// time-window filtering.

export interface AuditEntry {
  /** ISO timestamp set by audit-log.ts. May be missing on old/manual entries. */
  ts?: string;
  event?: string;
  /** All other columns kept opaque — readers downcast as needed. */
  [k: string]: unknown;
}

export interface AuditSummary {
  totalLines: number;
  parsedLines: number;
  malformedLines: number;
  eventTypeCounts: Record<string, number>;

  // Lifecycle
  buildsStarted: number;
  buildsFinished: number;
  buildsSucceeded: number;
  buildsFailed: number;
  buildsCancelled: number;
  buildsKilledByTimeout: number;
  /** Fraction in [0,1]; NaN when no builds finished. */
  buildSuccessRate: number;

  // Rejections / security
  pathRejected: number;
  uploadRejected: number;
  authDenied: number;

  // Time bookends — earliest and latest ts in the parsed entries.
  firstTs?: string;
  lastTs?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

export const parseAuditLog = (text: string): AuditEntry[] => {
  const out: AuditEntry[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(parsed)) continue;
    out.push(parsed as AuditEntry);
  }
  return out;
};

// `text` may include malformed lines; we track those separately so
// callers can flag log corruption.
export const summariseAudit = (
  text: string,
  opts: { since?: Date; until?: Date } = {},
): AuditSummary => {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const totalLines = lines.length;

  const sinceMs = opts.since ? opts.since.getTime() : Number.NEGATIVE_INFINITY;
  const untilMs = opts.until ? opts.until.getTime() : Number.POSITIVE_INFINITY;

  let malformedLines = 0;
  const entries: AuditEntry[] = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformedLines++;
      continue;
    }
    if (!isObject(parsed)) {
      malformedLines++;
      continue;
    }
    const entry = parsed as AuditEntry;
    if (entry.ts) {
      const t = new Date(entry.ts).getTime();
      if (Number.isFinite(t) && (t < sinceMs || t > untilMs)) continue;
    } else if (opts.since || opts.until) {
      // Event without a ts can't be placed in window — skip it.
      continue;
    }
    entries.push(entry);
  }

  const eventTypeCounts: Record<string, number> = {};
  let buildsStarted = 0;
  let buildsFinished = 0;
  let buildsSucceeded = 0;
  let buildsFailed = 0;
  let buildsCancelled = 0;
  let buildsKilledByTimeout = 0;
  let pathRejected = 0;
  let uploadRejected = 0;
  let authDenied = 0;
  let firstTs: string | undefined;
  let lastTs: string | undefined;

  for (const e of entries) {
    const evt = typeof e.event === "string" ? e.event : "<unknown>";
    eventTypeCounts[evt] = (eventTypeCounts[evt] ?? 0) + 1;

    if (e.ts) {
      if (firstTs === undefined || e.ts < firstTs) firstTs = e.ts;
      if (lastTs === undefined || e.ts > lastTs) lastTs = e.ts;
    }

    switch (evt) {
      case "build_started":
        buildsStarted++;
        break;
      case "build_finished": {
        buildsFinished++;
        const status = (e as { status?: unknown }).status;
        if (status === "succeeded") buildsSucceeded++;
        else if (status === "cancelled") buildsCancelled++;
        else buildsFailed++;
        break;
      }
      case "build_cancelled":
        // build_cancelled is emitted ON TOP of build_finished{status:cancelled}
        // in some paths, but is ALSO emitted standalone for cancel-before-start.
        // Keep it in eventTypeCounts but don't double-count buildsCancelled —
        // we count finishes, not cancellations-of-other-jobs.
        break;
      case "build_runner_killed_timeout":
        buildsKilledByTimeout++;
        break;
      case "path_rejected":
        pathRejected++;
        break;
      case "upload_rejected":
        uploadRejected++;
        break;
      case "auth_denied":
        authDenied++;
        break;
      default:
        break;
    }
  }

  const buildSuccessRate =
    buildsFinished > 0 ? buildsSucceeded / buildsFinished : Number.NaN;

  return {
    totalLines,
    parsedLines: entries.length,
    malformedLines,
    eventTypeCounts,
    buildsStarted,
    buildsFinished,
    buildsSucceeded,
    buildsFailed,
    buildsCancelled,
    buildsKilledByTimeout,
    buildSuccessRate,
    pathRejected,
    uploadRejected,
    authDenied,
    ...(firstTs ? { firstTs } : {}),
    ...(lastTs ? { lastTs } : {}),
  };
};

// Alert thresholds from MONITORING.md / MIGRATION_PATH.md §6.
// "Should this page on-call?" — yes/no decisions, not raw counts.
export interface AlertThresholds {
  /** Page if buildSuccessRate < this AND buildsFinished >= minSamples. */
  buildSuccessRateMin: number;
  /** Don't fire success-rate alert below this many finished builds (statistical noise). */
  minSamples: number;
  /** Page if buildsKilledByTimeout >= this in the window. */
  killedByTimeoutMax: number;
  /** Page if authDenied >= this in the window (potential brute force). */
  authDeniedMax: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  buildSuccessRateMin: 0.95,
  minSamples: 20,
  killedByTimeoutMax: 5,
  authDeniedMax: 50,
};

export interface AlertEvaluation {
  alerts: Array<{ key: string; severity: "page" | "warn"; message: string }>;
  /** True if any alert is at "page" severity. */
  shouldPage: boolean;
}

export const evaluateAlerts = (
  summary: AuditSummary,
  thresholds: AlertThresholds = DEFAULT_THRESHOLDS,
): AlertEvaluation => {
  const alerts: AlertEvaluation["alerts"] = [];

  if (
    summary.buildsFinished >= thresholds.minSamples &&
    Number.isFinite(summary.buildSuccessRate) &&
    summary.buildSuccessRate < thresholds.buildSuccessRateMin
  ) {
    alerts.push({
      key: "build_success_rate",
      severity: "page",
      message: `success rate ${(summary.buildSuccessRate * 100).toFixed(1)}% < ${(thresholds.buildSuccessRateMin * 100).toFixed(1)}% (${summary.buildsSucceeded}/${summary.buildsFinished} finished)`,
    });
  }

  if (summary.buildsKilledByTimeout >= thresholds.killedByTimeoutMax) {
    alerts.push({
      key: "build_runner_killed_timeout",
      severity: "page",
      message: `${summary.buildsKilledByTimeout} builds killed by hard-timeout (limit ${thresholds.killedByTimeoutMax})`,
    });
  }

  if (summary.authDenied >= thresholds.authDeniedMax) {
    alerts.push({
      key: "auth_denied",
      severity: "page",
      message: `${summary.authDenied} auth_denied events (limit ${thresholds.authDeniedMax}) — investigate brute-force`,
    });
  }

  // Lower-severity warns don't page but show up in summary.
  if (summary.malformedLines > 0) {
    alerts.push({
      key: "malformed_lines",
      severity: "warn",
      message: `${summary.malformedLines} malformed line(s) in audit log`,
    });
  }
  if (summary.uploadRejected > 0) {
    alerts.push({
      key: "upload_rejected",
      severity: "warn",
      message: `${summary.uploadRejected} upload_rejected — usually means bad client uploads, check distribution`,
    });
  }
  if (summary.pathRejected > 0) {
    alerts.push({
      key: "path_rejected",
      severity: "warn",
      message: `${summary.pathRejected} path_rejected — LLM tried to write outside the whitelist`,
    });
  }

  return {
    alerts,
    shouldPage: alerts.some((a) => a.severity === "page"),
  };
};
