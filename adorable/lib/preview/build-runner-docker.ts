// Default BuildExecutor — dockerode-backed.
//
// Phase 2 stub: дефолтный executor, который дёргается через
// `getDefaultBuildExecutor()` в lib/adapters/preview-static.ts. Реальный
// container.create + container.wait + log-streaming + cancel-via-signal
// лендят следующей итерацией Phase 2.
//
// Тесты `preview-static-build` передают свой mock executor через
// StaticPreviewProviderOptions.buildExecutor — поэтому они не зависят
// от docker daemon. Этот стаб нужен только когда работает production
// без override (= Phase 6 acceptance).

import type {
  BuildExecutor,
  BuildExecutorInput,
  BuildExecutorResult,
} from "@/lib/adapters/preview-static";

export const createDockerBuildExecutor = (): BuildExecutor => ({
  async runBuild(opts: BuildExecutorInput): Promise<BuildExecutorResult> {
    void opts;
    return {
      exitCode: -1,
      stdout: "",
      stderr:
        "build-runner-docker: dockerode integration not implemented yet — Phase 2 follow-up iter.",
      cancelled: false,
      timedOut: false,
      durationMs: 0,
    };
  },
});
