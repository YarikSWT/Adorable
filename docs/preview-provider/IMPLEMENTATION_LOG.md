# IMPLEMENTATION_LOG.md — журнал итераций Ralph Loop'а

Append-only лог. Каждый итер дописывает 1 строку в конец после
успешного выполнения шага. Никогда не редактируй прошлые строки —
если ошибка, добавляй corrective строку с тем же task'ом и
`status=corrected`.

## Формат

```
[YYYY-MM-DD HH:MM] phase=<P> task=<id> status=<done|in-progress|blocked|corrected> commit=<sha?> note=<short>
```

## Допустимые phases

- `phase=0` — Подготовка (sanity, env defaults, VERSION).
- `phase=1` — Контракты + mock + sandbox-wrapper.
- `phase=2` — Static impl без queue (синхронный билд).
- `phase=3` — BuildQueue + SSE + uploads + cancel.
- `phase=4` — Wire orchestration с feature flag.
- `phase=5` — Migration script для existing repos.
- `phase=6` — Acceptance run (VERIFICATION.md).
- `phase=7` — Cleanup (только после явного approval).

## Допустимые statuses

- `done` — завершён, тесты зелёные, коммит сделан.
- `in-progress` — итер идёт, не закончился (multi-iter task).
- `blocked` — упёрлись (HIGH ADR-вопрос / docker недоступен / 3+
  fix attempts провалились).
- `corrected` — предыдущая запись с тем же task'ом ошибочна, эта
  заменяет.

## Записи

[2026-04-29 10:33] phase=0 task=boilerplate-version-files status=done commit=e01e8e0 note=created templates/vite-react/VERSION (1.0.0) + AVAILABLE_DEPS.md placeholder; tests green
[2026-04-29 10:34] phase=0 task=env-example-additions status=done commit=f64f6fe note=added PREVIEW_PROVIDER (default=sandbox) + build-runner/queue/upload/scratch envs from BUILD_PIPELINE §10
[2026-04-29 10:38] phase=0 task=sanity-snapshot status=done note=baseline = 13 files passed / 4 skipped, 160 tests passed / 20 skipped (no docker/gitea/caddy infra in loop env)
[2026-04-29 10:38] phase=1 task=preview-types-and-factory status=done commit=b34791c note=lib/adapters/preview.ts (CONTRACTS §1-10 types + factory) + throwing stubs for mock/static/sandbox; tsc clean; tests green
[2026-04-29 10:41] phase=1 task=preview-mock-and-contract-tests status=done commit=230fcb9 note=in-memory MockPreviewProvider with lifecycle/idempotence/capabilities/ProjectFs + 13 contract tests; 173/20 (was 160/20)
[2026-04-29 10:43] phase=1 task=preview-sandbox-wrapper status=done commit=9e839c2 note=SandboxPreviewProvider wraps adorable-vm + sandboxProvider, build()=stub-success (HMR), shell-backed ProjectFs adapter; 177/20
[2026-04-29 10:45] phase=1 task=provider-singleton status=done commit=9df0209 note=lib/preview/provider-singleton.ts (HMR-safe getPreviewProvider + getBuildQueue stub) + 6 tests; 183/20. Phase 1 complete.
[2026-04-29 10:47] phase=2 task=isWritablePath-whitelist status=done commit=62afcb9 note=lib/preview/project-fs.ts pure isWritablePath + explainNonWritable (CONTRACTS §9) + 48 tests; 231/20
[2026-04-29 10:50] phase=2 task=node-fs-project-fs status=done commit=34227f8 note=createNodeFsProjectFs(rootDir) impl with safeJoin + whitelist + recursive list/search; 25 tests; 256/20
[2026-04-29 10:53] phase=2 task=available-deps-table status=done commit=35cc988 note=lib/preview/available-deps.ts with BOILERPLATE_DEPS sets + SYNONYMS map + classifyMissingModule(); 14 tests; 270/20
[2026-04-29 10:56] phase=2 task=build-error-parser status=done commit=0fac192 note=lib/preview/build-error-parser.ts (parseBuildErrors + parseBuildWarnings) covering module-not-found / import-not-allowed / syntax / transform / config / unknown fallback; 18 tests; 288/20
[2026-04-29 11:00] phase=2 task=proxy-route-target-union status=done commit=061cb1c note=ProxyRouteTarget union (upstream|static) added to proxy.ts back-compat; resolveRouteTarget helper; caddy/mock updated to populate target; 11 tests; 299/20
[2026-04-29 11:03] phase=2 task=build-runner-dockerfile status=done commit=20bdd50 note=docker/build-runner-react/{Dockerfile,init-volume.sh} (node:22-slim, USER 1000:1000, npm-based — ASSUMPTION pending ADR for pnpm); 11 structural tests; 310/20
[2026-04-29 11:04] phase=2 task=functions-tsconfig status=done commit=129a298 note=templates/vite-react/functions/{tsconfig.json,.gitkeep} (ES2022 strict, WebWorker lib, noEmit) + 6 tests; 316/20
[2026-04-29 11:07] phase=2 task=caddy-file-server status=done commit=6d0db9f note=Caddy file_server impl for static-target routes (subroute + try_files+rewrite+file_server); parseInfoFromRoute reconstructs static target; 3 shape tests; 319/20
[2026-04-29 11:10] phase=2 task=preview-static-lifecycle status=done commit=45f31f0 note=StaticPreviewProvider create/destroy/touch/getProjectFs working (scratch+static dirs, placeholder current symlink, Caddy route, NodeFsProjectFs); build()=stub failed; 12 tests; 331/20
[2026-04-29 11:14] phase=2 task=preview-static-build-orchestration status=done commit=7e8cad6 note=build() orchestration via injectable BuildExecutor — atomic symlink swap, build-error-parser, history GC, cancel cleanup; dockerode executor stubbed; 9 tests; 340/20
[2026-04-29 11:17] phase=2 task=generate-available-deps status=done commit=4d4cffc note=generateAvailableDepsMarkdown helper + scripts/generate-available-deps.ts CLI; regenerated AVAILABLE_DEPS.md (real content from package.json + SYNONYMS); 7 tests; 347/20
[2026-04-29 11:21] phase=2 task=dockerode-build-executor status=done commit=32ecdc2 note=createDockerBuildExecutor with full BUILD_PIPELINE §4.2 mounts/limits/hardening + cancel/timeout/log-bounded buffers; 10 unit tests + RUN_DOCKER_TESTS-gated integration; 356/22. Phase 2 complete.
[2026-04-29 11:25] phase=3 task=build-queue status=done commit=514ede8 note=in-memory BuildQueue (max 1+1 cancel+replace) + singleton wired through getPreviewProvider().build(); 12 build-queue tests + singleton test rewrite; 368/22
[2026-04-29 11:28] phase=3 task=rebuild-endpoint status=done commit=2f23b5c note=POST /api/projects/[id]/rebuild — identity check + manualRebuild capability + buildQueue.enqueue; 3 tests; 371/22
[2026-04-29 11:30] phase=3 task=sse-build-status status=done commit=2d59a5b note=GET /api/projects/[id]/build-status SSE stream — initial snapshot + queue.subscribe + keep-alive + abort cleanup; 4 tests; 375/22
[2026-04-29 11:34] phase=3 task=upload-endpoint status=done commit=280e2db note=upload-validator (magic-bytes detector + filename sanitiser + validateUpload) + POST /api/projects/[id]/upload route writing to /data/projects/<id>/public/; 28+6 tests; 409/22. Phase 3 complete.
[2026-04-29 11:37] phase=4 task=repo-metadata-preview-fields status=done commit=3b29edb note=RepoMetadata gains optional boilerplateVersion + preview block (CONTRACTS §12); read/write round-trip + back-compat for old repos; 4 tests; 413/22
[2026-04-29 11:40] phase=4 task=system-prompt-branch status=done commit=d349adb note=getSystemPrompt(capabilities) splits into SANDBOX_SYSTEM_PROMPT (= existing, alias kept) + new STATIC_SYSTEM_PROMPT with ARCHITECTURE CONSTRAINT/NOT AVAILABLE/file-tools-only workflow (ADR-010); 13 tests; 426/22
[2026-04-29 11:44] phase=4 task=create-static-tools status=done commit=c369692 note=lib/create-static-tools.ts — capability-driven LLM tools for static mode (read/write/replace/append/list/search/mkdir/move/delete via ProjectFs + requestRebuildTool/getBuildLogsTool via BuildQueue); 13 tests; 439/22
[2026-04-29 11:48] phase=4 task=repos-route-pin-metadata status=done commit=79f5814 note=app/api/repos/route.ts pins boilerplateVersion + preview block from getPreviewProvider() on initialMetadata; readBoilerplateVersion helper with cache + ADORABLE_TEMPLATE_DIR override; sandbox flow untouched; 5 tests; 444/22
[2026-04-29 11:51] phase=4 task=chat-route-build-trigger status=done commit=95d4d9a note=chat/route.ts uses getSystemPrompt(capabilities) + onFinish non-blocking buildQueue.enqueue when shouldEnqueueAfterTurn(capabilities)=true; capabilities pinned from metadata.preview with provider-fallback; sandbox flow byte-equivalent; 4 tests; 448/22
[2026-04-29 11:53] phase=4 task=landing-flow-e2e-pinned-metadata status=done commit=64adce9 note=existing landing-flow-e2e extended with assertions on boilerplateVersion + preview block (round-trip validation through real repos+chat POST flow); 448/22 (same count, more asserts)
[2026-04-29 11:59] phase=4 task=chat-route-tools-branch status=done commit=f927a53 note=chat/route.ts branches tools by capabilities.shellAccess (createVmTools vs createStaticTools); mock-provider factory respects PREVIEW_PROVIDER env so e2e tests can choose sandbox/static semantics with one env var; landing-flow updated to PREVIEW_PROVIDER=sandbox + new pinned-provider assertions; 448/22
[2026-04-29 12:02] phase=4 task=static-flow-e2e status=done commit=79290a7 note=repos POST branches by provider name (sandbox=createVmForRepo legacy / static+mock=previewProvider.create); chat onFinish enqueue now keys on sourceRepoId; new tests/static-flow-e2e.test.ts (3 tests) verifies STATIC pinning, queue enqueue+succeeded, and no-sandbox-lifecycle; 451/22. Phase 4 complete.
[2026-04-29 12:04] phase=5 task=migrate-metadata-helper status=done commit=03f4d2b note=lib/preview/migrate-metadata.ts pure migrateRepoMetadata() backfills boilerplateVersion + preview block (sandbox snapshot by default); idempotent, returns same ref when no change, never overwrites existing provider; 9 tests; 460/22
[2026-04-29 12:07] phase=5 task=migrate-metadata-runner-cli status=done commit=7ccd110 note=runMetadataMigration(provider, ...) + scripts/migrate-repo-metadata.ts CLI (--dry-run --limit -h); per-repo error isolation; respects dry-run; ignores non-wrapper repos; 8 tests; 468/22
[2026-04-29 12:09] phase=5 task=migrate-repo-to-static status=done commit=17fd618 note=lib/preview/migrate-to-static.ts per-project sandbox→static helper (destroy sandbox + staticProvider.create + reshape metadata) + CLI scripts/migrate-repo-to-static.ts; idempotent; 4 tests; 472/22
[2026-04-29 12:11] phase=5 task=migration-readme status=done commit=e730d4e note=adorable/README.md gains "Preview Provider migration (Phase 5)" section covering both CLIs (bulk backfill + per-project sandbox→static); 472/22 (doc-only). Phase 5 complete.
[2026-04-29 12:13] phase=6 task=ic2-atomic-swap status=done commit=9b32fed note=tests/atomic-swap.test.ts (2 tests) — VERIFICATION IC-2: 25 swaps with concurrent reader, zero bad reads / ENOENTs; previous symlink chain integrity; 474/22
[2026-04-29 12:15] phase=6 task=ic8-available-deps-sync status=done commit=168e6c4 note=tests/available-deps-sync.test.ts — IC-8 gate: regenerated AVAILABLE_DEPS.md must match committed file byte-for-byte (drift between package.json/SYNONYMS and committed doc fails test); 475/22
[2026-04-29 12:17] phase=6 task=ic4-sse-keepalive-cleanup status=done commit=33e7769 note=tests/ic4-sse-keepalive-cleanup.test.ts (2 tests) — IC-4: keep-alive comment within configurable SSE_KEEP_ALIVE_MS interval, abort request → stream closed + queue listener properly removed; 477/22
[2026-04-29 12:19] phase=6 task=ic5-cancel-midflight status=done commit=c726189 note=tests/ic5-cancel-midflight.test.ts (2 tests) — IC-5: queue.cancel triggers executor signal abort, status=cancelled, artifact removed; re-enqueue cancels+promotes through static provider end-to-end; 479/22
[2026-04-29 12:21] phase=6 task=acceptance-status-summary status=blocked note=10/10 infra-checks COVERED locally (IC-1 unit-config,IC-2 atomic-swap,IC-3 build-queue,IC-4 sse-keepalive-cleanup,IC-5 cancel-midflight,IC-6 build-history-gc in preview-static-build,IC-7 migrate-runner,IC-8 available-deps-sync,IC-9 dockerfile-script structural,IC-10 system-prompt). 8/8 product scenarios + p50/p95/staging metrics REQUIRE staging (real LLM+Caddy+Docker+Gitea). Documented in OPEN_QUESTIONS.md §L1+L2. Phase 6 acceptance gate is human-driven from here.
[2026-04-29 12:27] phase=6 task=build-queue-audit-log status=done commit=49b70e2 note=AuditEvent extended with build_enqueued/started/finished/cancelled variants (BUILD_PIPELINE §9); BuildQueue accepts optional auditLogger; production singleton wires getSharedAuditLogger; 6 tests covering each event + queueDepth + reason discrimination; 485/22
[2026-04-29 12:30] phase=6 task=static-auto-commit status=done commit=7c40f40 note=lib/preview/auto-commit-project-fs.ts walks ProjectFs.list+readTextFile+gitProvider.commits.create; chat/route.ts onFinish branches sandbox=autoCommitWorkspace / static=autoCommitProjectFs; closes the static-mode "files lost between turns" gap; 5 tests; 490/22
[2026-04-29 12:36] phase=6 task=upload-audit-rejected status=done commit=4c2ae01 note=upload_rejected AuditEvent variant + upload route writes one event per 400-class rejection (SECURITY.md §6); reason matches UploadValidationErr discriminator; 5 tests covering every reason + success no-emit; 495/22
[2026-04-29 12:41] phase=6 task=preview-static-audit-swap-gc status=done commit=38f1997 note=build_swap (with previousBuildId) + build_gc (with deletedBuilds[]) audit events emitted from preview-static.build() (BUILD_PIPELINE §9); auditLogger defaults to getSharedAuditLogger(); 4 tests; 499/22
[2026-04-29 12:44] phase=6 task=build-runner-killed-timeout-audit status=done commit=95504f2 note=SECURITY §6 — preview-static.build() emits build_runner_killed_timeout when execResult.timedOut=true (BUILD_RUNNER_TIMEOUT_MS hit, container SIGKILL'd); 1 test; 500/22
[2026-04-29 12:46] phase=6 task=rebuild-sse-cancel-replace-e2e status=done commit=0a50696 note=VERIFICATION scenario 5 — e2e through rebuild route + SSE route: rapid double-click triggers queue cancel+replace; SSE observes running/cancelled (A) + queued/running/succeeded (B); 1 test; 501/22
[2026-04-29 12:50] phase=6 task=path-rejected-audit status=done commit=41c92e5 note=SECURITY §6 — createStaticTools logs path_rejected event when LLM tool call hits whitelist (write/remove/rename/mkdir to non-writable path or with traversal); 5 tests; 506/22
[2026-04-29 12:56] phase=6 task=auth-denied-audit-and-flush status=done commit=974c1e0 note=auth_denied AuditEvent + 403 wired in rebuild/sse/upload routes (4 tests); AuditLogger.flush() for deterministic test reads — replaces setTimeout-tick pattern across all audit tests (build-queue + create-static-tools + preview-static + upload + auth-denied); flake fixed; 510/22 stable across 7 runs
[2026-04-29 13:19] phase=6 task=boilerplate-migration-audit status=done commit=d90d836 note=boilerplate_migration AuditEvent emitted from runMetadataMigration (bulk run summary + dryRun) and migrateRepoToStatic (per-project changed=1 / no-op skipped=1); CLIs auto-wire getSharedAuditLogger; 4 tests; 514/22 stable. All SECURITY §6 events now wired.
