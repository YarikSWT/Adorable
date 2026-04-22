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
- **Итерация 9 (2026-04-22):** Phase 3 (Git) kickoff. `lib/adapters/git.ts` интерфейс GitProvider (createRepo с import-URL, getRepo, listRepos, deleteRepo; RepoRef: branches.getDefaultBranch, contents.get, commits.list/create, githubSync.enable/disable). `lib/adapters/git-mock.ts` — in-memory (Map для файлов + commit log), seedFiles/inspect helpers. `lib/adapters/git-gitea.ts` placeholder. `tests/git-contract.test.ts` — 14 тестов: lifecycle, import-bootstrap, commits ordering (asc/desc/limit), base64 round-trip, non-default branch rejection, missing-file errors, githubSync state, listRepos, idempotent delete. 93/93 зелёные (14 новых), build зелёный.

## В работе
Phase 3: Gitea реализация + migration callers.

## Следующее (iter 10)
- `lib/adapters/git-gitea.ts` — полная реализация через Gitea REST API v1. createRepo через POST /orgs/{org}/repos (с import для template). RepoRef.contents.get → GET /repos/{owner}/{repo}/contents/{path}. commits.list/create → git trees API. githubSync.enable → POST /repos/{owner}/{repo}/push_mirrors. Auth через GITEA_TOKEN из env. Опционально интеграция `gitea-js` клиента.
- `GitProvider` singleton по аналогии с sandbox-provider-singleton.
- Замена callers: `repo-storage.ts`, `deployment-status.ts`, `repos/route.ts` → `getGitProvider().getRepo(repoId).commits.list/create/contents.get`.
- Упрощение `identity-session.ts` под Better Auth (уберём Freestyle identities).
