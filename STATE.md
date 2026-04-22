# Текущее состояние

**Итерация:** 9 завершена, идёт 10
**Дата:** 2026-04-22

## Окружение
- Node: v22.22.2 (nvm).
- Docker: 29.4.1, daemon работает.
- npm workspaces.
- `.env` с ключами Z_AI, BETTER_AUTH_SECRET, GITEA_* готовы.

## Инфра (Phase 1) — готово
- 4 сервиса: `adorable-postgres-app`, `adorable-postgres-gitea`, `adorable-gitea` (1.22.3), `adorable-caddy` (2.8-alpine).
- Gitea UI/API: `http://127.0.0.1:3001`. Caddy Admin API: `http://127.0.0.1:2019`. HTTP:8080, HTTPS:8443.
- Сети: `adorable_infra` (инфра), `adorable_sandboxes` (sandbox'ы + Caddy).

## LLM (Phase 1.5) — готово
- 5 провайдеров в `lib/adapters/llm.ts`. Тесты 17/17.

## Sandbox (Phase 2) — в работе
- **Готово (iter 3):** `lib/adapters/sandbox.ts` интерфейс, `sandbox-mock.ts` in-memory реализация, `sandbox-docker.ts` заглушка, `tests/sandbox-contract.test.ts` 16 тестов.
- **Готово (iter 4):** `lib/sandbox/audit-log.ts` — structured JSON-lines. Event types: sandbox_created, sandbox_destroyed, sandbox_exec, sandbox_fs_write, sandbox_cleanup, proxy_route_added/removed. Serialized promise-chain. Env `SANDBOX_AUDIT_LOG`. 10 тестов.
- **Готово (iter 5):** `sandbox-docker-config.ts` (чистый билдер, все 15), `sandbox-docker.ts` (dockerode create/ref/destroy/list/exec/fs). 21 unit-тест.
- **Готово (iter 6):** `lib/sandbox/cleanup-worker.ts` + 11 тестов.
- **Готово (iter 7):** все 9 security-тестов зелёные (workspace tmpfs).
- **Готово (iter 8):** callers мигрированы на SandboxProvider. Singleton + touch API.
- **Готово (iter 9, Phase 3 start):** `lib/adapters/git.ts` интерфейс + `lib/adapters/git-mock.ts` (in-memory FS + commit log) + `lib/adapters/git-gitea.ts` placeholder + `tests/git-contract.test.ts` (14 тестов). Контракт близок к Freestyle git API: createRepo {name?, import?}, getRepo, listRepos, deleteRepo, RepoRef{branches.getDefaultBranch, contents.get, commits.list/create, githubSync.enable/disable}.
- **Следующее (iter 10):** `lib/adapters/git-gitea.ts` полная реализация: создание репо через Gitea admin API, пуш файлов, push-mirror для githubSync. Или сразу замена callers (repo-storage.ts, deployment-status.ts, repos/route.ts) на адаптер с mock — можно тестить до gitea-reality.
- **После:** Phase 4 (Caddy proxy), Phase 5 (Kamal — опц), Phase 6 (SECURITY.md + FORK_CHANGES.md + final e2e), удаление freestyle deps.

## Суммарные тесты
- `tests/llm-adapter.test.ts` — 17 тестов.
- `tests/sandbox-contract.test.ts` — 16 тестов.
- `tests/audit-log.test.ts` — 10 тестов.
- `tests/sandbox-docker-config.test.ts` — 22 теста (обновлены под tmpfs).
- `tests/cleanup-worker.test.ts` — 11 тестов.
- `tests/sandbox-security.test.ts` — 9 тестов (gated `RUN_DOCKER_TESTS=1`, на живом Docker).
- `tests/git-contract.test.ts` — 14 тестов (mock).
- **Всего:** 93/93 без Docker + 9/9 на Docker (gated).
- `npm run build` — зелёный (NODE_OPTIONS=--max-old-space-size=4096 из-за Next 16 Turbopack).

## Что сделано
- Phase 0: инвентаризация.
- Phase 1: compose + Caddy + Gitea + scripts + README.
- Phase 1.5: LLM-адаптер (5 провайдеров) + 17 тестов.
- Phase 2: SandboxProvider interface + mock + docker impl + audit-log + cleanup-worker + 9 security-тестов (все зелёные на живом Docker).

## Открытые риски/заметки
- `freestyle-sandboxes` всё ещё в deps; callers (adorable-vm.ts, create-tools.ts, chat/route.ts, repos/route.ts) всё ещё используют Freestyle — задача iter 8.
- StorageOpt.size требует overlay2 + xfs/btrfs. На текущем хосте (ext4) не применяется, опционально.
- Для CI security-тестов нужен self-hosted runner с Docker-демоном (GitHub Actions hosted runners поддерживают docker).
