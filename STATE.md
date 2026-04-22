# Текущее состояние

**Итерация:** 15 завершена, идёт 16 (blocked — требуется пополнение Z.ai баланса для финального промис-критерия)
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
- **Готово (iter 9, Phase 3 start):** GitProvider интерфейс + in-memory mock + placeholder gitea + 14 contract-тестов.
- **Готово (iter 10):** Gitea REST API v1 реализация + 4 интеграционных теста.
- **Готово (iter 11):** callers мигрированы на GitProvider + identity упрощена.
- **Готово (iter 12):** ProxyProvider interface + mock + Caddy impl + 6 live integration-тестов.
- **Готово (iter 13):** Phase 4 lifecycle wiring + 3 security тестов. 105/105.
- **Готово (iter 14):** Phase 6 docs + cleanup package.json.
- **Готово (iter 15):** CI workflow `.github/workflows/test.yml` (unit + gated integration). `config/deploy.yml` Kamal-шаблон для самого билдера с accessories. Playwright MCP final e2e — infra up, dev server up через `sg docker`, browser загрузил home → ввёл prompt → POST /api/repos 200 (Gitea + Docker sandbox созданы) → навигация на project-страницу → POST /api/chat 200 → **Z.ai вернул 429 insufficient balance**. `verification/screenshots/final-e2e-prod.png` сделан. Фиксы по ходу: `/api/api-key` hasGlobalKey учитывает Z_AI_API_KEY, sandbox-docker.ts sanitизирует repoId для docker-имени. Всё кроме фактической генерации GLM работает. `BLOCKERS.md` записано.
- **Следующее (iter 16+):** либо пополнение Z.ai аккаунта (external action, не код), либо переключение `LLM_PROVIDER=openrouter` с валидным OPENROUTER_API_KEY → повторить e2e и финализировать промис.

## Суммарные тесты
- `tests/llm-adapter.test.ts` — 17 тестов.
- `tests/sandbox-contract.test.ts` — 16 тестов.
- `tests/audit-log.test.ts` — 10 тестов.
- `tests/sandbox-docker-config.test.ts` — 22 теста (обновлены под tmpfs).
- `tests/cleanup-worker.test.ts` — 11 тестов.
- `tests/sandbox-security.test.ts` — 9 тестов (gated `RUN_DOCKER_TESTS=1`, на живом Docker).
- `tests/git-contract.test.ts` — 14 тестов (mock).
- `tests/git-gitea-integration.test.ts` — 4 теста (gated `RUN_GITEA_TESTS=1`, на живом Gitea).
- `tests/proxy-contract.test.ts` — 9 тестов (mock).
- `tests/proxy-caddy-integration.test.ts` — 6 тестов (gated `RUN_CADDY_TESTS=1`, на живом Caddy).
- `tests/proxy-security.test.ts` — 3 теста (sandbox lifecycle sync + admin api expectation).
- **Всего:** 105/105 без внешних сервисов + 9/9 на Docker + 4/4 на Gitea + 6/6 на Caddy (gated).
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
