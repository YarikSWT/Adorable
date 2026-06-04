// Bounded validation feedback (спец v2.1 §8) — NOT an unbounded retry loop.
//
// On a validation failure the validate tool feeds the model an escalating hint
// (per-category budget). Identical errors (same hash) escalate EARLY. When the
// budget is exhausted the tool stops returning errors and returns "explain to
// the user" — the model plays out its finish step with an explanation instead of
// being hard-aborted (the run still completes). Step counting is the SDK's
// `result.steps` (one counter), never a parallel incrementStep.

export interface RetryStateConfig {
  /** Failures allowed per category before "explain to user" (default 3). */
  budgetPerCategory?: number;
}

export type FeedbackKind = "retry" | "escalate" | "explain";

export interface ValidationFeedback {
  kind: FeedbackKind;
  /** 1-based attempt number for this category. */
  attempt: number;
  /** Escalation level 1..3. */
  level: 1 | 2 | 3;
  /** Was this an identical (deduped) error → early escalation? */
  duplicate: boolean;
  /** The message to feed back to the model. */
  message: string;
}

/** Normalise an error so cosmetic differences (line/col, paths, ids) hash equal. */
export function hashError(error: string): string {
  return error
    .toLowerCase()
    .replace(/\d+/g, "#") // line/col numbers, ids
    .replace(/['"`].*?['"`]/g, "'…'") // quoted literals / paths
    .replace(/\s+/g, " ")
    .trim();
}

const ESCALATION: Record<1 | 2 | 3, string> = {
  1: "Fix this error and try again:",
  2: "Still failing. Here are the related files — review them and fix the root cause:",
  3: "Repeated failure. Revert your last change and rewrite this part from scratch:",
};

export const BUDGET_EXHAUSTED_MESSAGE =
  "Validation budget exhausted. Do NOT keep trying — finish your turn and " +
  "explain to the user what is still broken and what you tried.";

export class RetryState {
  private readonly budget: number;
  private readonly attempts = new Map<string, number>();
  private readonly hashCounts = new Map<string, number>();

  constructor(config: RetryStateConfig = {}) {
    this.budget = config.budgetPerCategory ?? 3;
  }

  /** Record a validation failure; returns the feedback to send the model. */
  record(category: string, errorText: string): ValidationFeedback {
    const hash = hashError(errorText);
    const seen = this.hashCounts.get(hash) ?? 0;
    const duplicate = seen > 0;
    this.hashCounts.set(hash, seen + 1);

    const attempt = (this.attempts.get(category) ?? 0) + 1;
    this.attempts.set(category, attempt);

    // Budget exhausted → explain (NOT abort).
    if (attempt > this.budget) {
      return {
        kind: "explain",
        attempt,
        level: 3,
        duplicate,
        message: BUDGET_EXHAUSTED_MESSAGE,
      };
    }

    // Identical error → jump a level (early escalation).
    const base = Math.min(attempt, 3) as 1 | 2 | 3;
    const level = (duplicate ? Math.min(base + 1, 3) : base) as 1 | 2 | 3;
    return {
      kind: duplicate ? "escalate" : "retry",
      attempt,
      level,
      duplicate,
      message: `${ESCALATION[level]}\n${errorText}`,
    };
  }

  /** A passed validation resets the category counter (fresh budget next time). */
  pass(category: string): void {
    this.attempts.delete(category);
  }

  attemptsFor(category: string): number {
    return this.attempts.get(category) ?? 0;
  }

  budgetExhausted(category: string): boolean {
    return (this.attempts.get(category) ?? 0) > this.budget;
  }
}
