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
