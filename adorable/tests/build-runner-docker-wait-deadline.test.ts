// Verifies the wait-deadline race introduced in the build-runner.
//
// Background: dockerode's container.wait() can hang indefinitely when
// the daemon is overloaded — even after kill SIGKILL has been sent.
// In production we observed durationMs=426067 (>7 min) for a build with
// BUILD_RUNNER_TIMEOUT_MS=120000 (2 min). The fix is a Promise.race
// between wait() and a hard deadline; if the deadline fires we
// force-remove the container and synthesise an exit=-1/timedOut=true
// result so the queue can move on.
//
// This test stubs a Docker client where wait() never resolves, asserts
// the executor returns within (timeoutMs + 2*cancelGraceMs + 5s) and
// that container.remove({force:true}) was called exactly once.

import { describe, expect, it, vi } from "vitest";
import type Docker from "dockerode";
import { PassThrough } from "node:stream";

import { createDockerBuildExecutor } from "@/lib/preview/build-runner-docker";

interface FakeContainer {
  attach: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  wait: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  modem: { demuxStream: (s: unknown, o: unknown, e: unknown) => void };
}

const buildFakeDocker = (containerOverrides: Partial<FakeContainer> = {}) => {
  const fakeContainer: FakeContainer = {
    attach: vi.fn(async () => new PassThrough()),
    start: vi.fn(async () => undefined),
    // Default: wait() hangs forever (the bug we are fixing).
    wait: vi.fn(() => new Promise(() => {})),
    kill: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    modem: {
      // demuxStream is sync — just close the consumer pipes immediately
      // so the BoundedBuffer flushes.
      demuxStream: (_s, o, e) => {
        (o as PassThrough).end();
        (e as PassThrough).end();
      },
    },
    ...containerOverrides,
  };
  const fakeDocker = {
    createContainer: vi.fn(async () => fakeContainer),
  } as unknown as Docker;
  return { fakeDocker, fakeContainer };
};

const baseInput = {
  projectId: "proj-deadline",
  buildId: "b-1",
  scratchDir: "/tmp/scratch",
  artifactDir: "/tmp/artifact",
  boilerplateVersion: "1.0.0",
};

describe("build-runner-docker — wait deadline race", () => {
  it("force-removes the container when wait() exceeds the deadline", async () => {
    const { fakeDocker, fakeContainer } = buildFakeDocker();
    const exec = createDockerBuildExecutor({
      docker: fakeDocker,
      envOverride: {
        // Tiny values so the test runs fast.
        timeoutMs: 30,
        cancelGraceMs: 10,
        waitDeadlineBufferMs: 50,
      },
    });

    const startedAt = Date.now();
    const res = await exec.runBuild({ ...baseInput });
    const elapsed = Date.now() - startedAt;

    expect(res.timedOut).toBe(true);
    expect(res.exitCode).toBe(-1);
    expect(fakeContainer.remove).toHaveBeenCalledTimes(1);
    expect(fakeContainer.remove).toHaveBeenCalledWith({ force: true });
    // Bounded by deadline (30 + 2*10 + 50 = 100ms) plus scheduler slack.
    expect(elapsed).toBeLessThan(2_000);
    // Definitely longer than the soft hardTimeout that fired SIGKILL.
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });

  it("happy path: wait() resolves normally, no force-remove", async () => {
    const { fakeDocker, fakeContainer } = buildFakeDocker({
      wait: vi.fn(async () => ({ StatusCode: 0 })),
    });
    const exec = createDockerBuildExecutor({
      docker: fakeDocker,
      envOverride: { timeoutMs: 60_000, cancelGraceMs: 1_000 },
    });

    const res = await exec.runBuild({ ...baseInput });

    expect(res.timedOut).toBe(false);
    expect(res.cancelled).toBe(false);
    expect(res.exitCode).toBe(0);
    expect(fakeContainer.remove).not.toHaveBeenCalled();
  });

  it("kill failures are logged to stderr, not swallowed silently", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const { fakeDocker, fakeContainer } = buildFakeDocker({
        wait: vi.fn(() => new Promise(() => {})),
        kill: vi.fn(async () => {
          throw new Error("daemon overloaded");
        }),
      });
      const exec = createDockerBuildExecutor({
        docker: fakeDocker,
        envOverride: {
          timeoutMs: 30,
          cancelGraceMs: 10,
          waitDeadlineBufferMs: 50,
        },
      });
      await exec.runBuild({ ...baseInput });
      expect(fakeContainer.kill).toHaveBeenCalled();
      // The error from kill must surface in stderr so operators can
      // see WHY the daemon was unhappy.
      const written = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(written).toMatch(/daemon overloaded/);
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
