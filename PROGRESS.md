# Прогресс

## Сделано
- **Итерация 1 (2026-04-21):** Phase 0 инвентаризация + Phase 1 инфра. FREESTYLE_INVENTORY.md, ANTHROPIC_INVENTORY.md, STATE.md, MIGRATION_PLAN.md, decisions.md (17 ADR). docker-compose.yml (4 сервиса + 2 сети), docker-compose.prod.yml, Dockerfile, scripts/dev-infra.sh, scripts/init-gitea.sh, Caddy init config, README переписан.
- **Итерация 2 (2026-04-22):** Phase 1.5 LLM-адаптер. `lib/adapters/llm.ts` + `llm-mock.ts` + `tests/llm-adapter.test.ts` (17 тестов). Рефактор `lib/llm-provider.ts` → тонкая обёртка над `createLLM()`. Бизнес-код без прямых `@ai-sdk/anthropic`. Build зелёный.
- **Итерация 3 (2026-04-22):** Phase 2 интерфейс sandbox + mock + контрактные тесты. `lib/adapters/sandbox.ts` (SandboxProvider: create/ref/destroy/list; SandboxHandle: exec/fs/devServer/domains/ports/status). `sandbox-mock.ts` (in-memory FS, scripted exec, seedFiles/setExecHandler/inspect helpers для тестов). `sandbox-docker.ts` stub. `tests/sandbox-contract.test.ts` — 16 тестов. 33/33 green. Build зелёный.
- **Итерация 4 (2026-04-22):** Phase 2 audit-log. `lib/sandbox/audit-log.ts` — append-only JSON-lines, typed events (sandbox_created/destroyed/exec/fs_write/cleanup + proxy_route_added/removed), auto mkdir, serialized parallel writes, strict/non-strict режимы, env `SANDBOX_AUDIT_LOG`, shared singleton. `tests/audit-log.test.ts` — 10 тестов, 43/43 green. Build зелёный.
- **Итерация 5 (2026-04-22):** Phase 2 sandbox-docker. Установлены `dockerode@^4`, `tar-stream@^3`, `@types/dockerode`, `@types/tar-stream`. `lib/adapters/sandbox-docker-config.ts` — pure config builder, все 15 ограничений в HostConfig/ContainerConfig + валидация (rejects host/bridge net, root user, invalid CPU). `lib/adapters/sandbox-docker.ts` — dockerode-based SandboxProvider: ensureVolume, create (container + start + audit), ref (inspect), destroy (stop+remove+volume+audit), list (label filter), exec (Exec API + 8-byte stream демукс), fs (getArchive/putArchive через tar-stream). `tests/sandbox-docker-config.test.ts` — 21 unit-тест, покрыты все 15 ограничений явно. Fixed discriminated union in audit-log (DistributiveOmit) to preserve variant-specific fields. 67/67 green, build зелёный.
- **Итерация 6 (2026-04-22):** Phase 2 cleanup-worker. `lib/sandbox/cleanup-worker.ts` — sweeper через `provider.list()`: TTL (maxLifetimeMin, createdAt) + idle (idleTimeoutMin, через `touch(sandboxId)` API). Optional `proxyProvider.removeSandboxRoutes()` cascade, swallow proxy errors. Singleton + start/stop/sweepOnce. Injectable clock. `tests/cleanup-worker.test.ts` — 11 тестов. 78/78 green.
- **Итерация 7 (2026-04-22):** 9 security-тестов зелёные. Workspace переведён на tmpfs.
- **Итерация 8 (2026-04-22):** SandboxProvider singleton + callers migration. 79/79.
- **Итерация 9 (2026-04-22):** Phase 3 kickoff. GitProvider + mock + 14 contract tests. 93/93.
- **Итерация 10 (2026-04-22):** Gitea реализация. `lib/adapters/git-gitea.ts` через Gitea REST API v1 (плоский fetch-клиент, без дополнительных зависимостей). createRepo: POST /user/repos (auto_init) или POST /repos/migrate (если import URL); RepoRef.branches.getDefaultBranch: GET /repos/{owner}/{repo}; contents.get: GET /repos/{owner}/{repo}/contents/{path}?ref=... (base64 decode); commits.list: GET /repos/{owner}/{repo}/commits?limit=N (поддержка asc/desc локально); commits.create: batch POST /repos/{owner}/{repo}/contents с автоматическим пробингом existing sha для решения create/update; githubSync.enable: POST /repos/{owner}/{repo}/push_mirrors, disable: DELETE по mirror. repoId = "{owner}/{repo}" (full_name). `tests/git-gitea-integration.test.ts` — 4 теста (create+default branch, multi-file commit+read, update existing file, idempotent delete) все зелёные против живого Gitea 1.22.3. Gitea port перенесён на 3011 (claudecodeui занимает 3001).

## В работе
Phase 3: замена callers на GitProvider.

## Следующее (iter 11)
- `lib/git/provider-singleton.ts` — singleton GitProvider для callers (по аналогии с sandbox singleton).
- Замена `freestyle.git.repos.ref()` в `repo-storage.ts`, `deployment-status.ts`, `repos/route.ts`, `promote/route.ts` на `(await getGitProvider()).getRepo(repoId)`.
- Замена `freestyle.git.repos.create()` в `repos/route.ts` на `provider.createRepo({...})`.
- Упрощение `identity-session.ts` (пока оставим как thin wrapper вокруг cookie, уберём Freestyle identities).
- `repo-storage.ts` — committer email `adorable@freestyle.sh` → `adorable@localhost`.
