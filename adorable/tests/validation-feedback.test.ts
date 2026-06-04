// Phase 6 §12.6 — bounded validation feedback (RetryState). Pure logic, so it
// runs in the default suite (no container needed).
//   (c) fix from the 1st attempt: fail → feedback → pass → counter reset;
//   (d) budget-exhausted → "explain to user" (NOT a hard abort);
//   (e) dedup by hash → early escalation;
//   (f) the counter resets after a pass (one counter; stepCount is the SDK's).

import { describe, expect, it } from "vitest";
import {
  RetryState,
  hashError,
  BUDGET_EXHAUSTED_MESSAGE,
} from "@/lib/agent-run/retry-state";

describe("Phase 6 validation feedback (RetryState)", () => {
  it("(c) fix from the first attempt: fail → retry feedback → pass resets the counter", () => {
    const rs = new RetryState();
    const fb = rs.record("tsc", "TS2304: Cannot find name 'foo' at line 3");
    expect(fb.kind).toBe("retry");
    expect(fb.attempt).toBe(1);
    expect(fb.message).toContain("Fix this error");

    rs.pass("tsc"); // validation passed after the fix
    expect(rs.attemptsFor("tsc")).toBe(0); // counter reset
    expect(rs.budgetExhausted("tsc")).toBe(false);
  });

  it("(d) budget-exhausted → explain to user, not abort", () => {
    const rs = new RetryState({ budgetPerCategory: 3 });
    rs.record("build", "error A");
    rs.record("build", "error B");
    rs.record("build", "error C");
    const fourth = rs.record("build", "error D");
    expect(fourth.kind).toBe("explain"); // NOT abort
    expect(fourth.message).toBe(BUDGET_EXHAUSTED_MESSAGE);
    expect(rs.budgetExhausted("build")).toBe(true);
  });

  it("(e) identical errors (same hash) escalate early", () => {
    const rs = new RetryState();
    const first = rs.record("tsc", "TS2304: Cannot find name 'x' at line 10");
    expect(first.duplicate).toBe(false);
    expect(first.level).toBe(1);

    // Same error, different line number — hashes equal → duplicate → escalate.
    const second = rs.record("tsc", "TS2304: Cannot find name 'x' at line 42");
    expect(second.duplicate).toBe(true);
    expect(second.kind).toBe("escalate");
    expect(second.level).toBeGreaterThan(first.level);
  });

  it("(f) hashError normalises away line/col/ids/paths", () => {
    expect(hashError("TS2304 at line 3 in 'src/a.ts'")).toBe(
      hashError("TS2304 at line 99 in 'src/b.ts'"),
    );
    expect(hashError("error one")).not.toBe(hashError("totally different"));
  });

  it("(f) a fresh category after pass gets the full budget again", () => {
    const rs = new RetryState({ budgetPerCategory: 3 });
    rs.record("tsc", "e1");
    rs.record("tsc", "e2");
    rs.pass("tsc"); // resolved
    // counter reset → next failures start from attempt 1 again.
    const again = rs.record("tsc", "new error");
    expect(again.attempt).toBe(1);
    expect(again.kind).toBe("retry");
  });
});
