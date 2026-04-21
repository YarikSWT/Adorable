# Architecture Decision Records (fork)

## ADR-001: Форк, не fork-from-scratch
Не переписываем Adorable с нуля. UI, assistant-ui, agent-логика и streaming работают. Меняем только интеграции.

## ADR-002: Адаптер-паттерн для всех внешних зависимостей
`SandboxProvider`, `GitProvider`, `DeployProvider`, `ProxyProvider`, `LLMProvider`. Каждый имеет mock-реализацию для тестов. Переключение через env (`SANDBOX_PROVIDER`, `GIT_PROVIDER`, `DEPLOY_PROVIDER`, `PROXY_PROVIDER`, `LLM_PROVIDER`).

## ADR-003: Sandbox — Docker + dockerode
Не E2B, не WebContainers, не Daytona. Docker с жёсткими лимитами. Билдер ходит в Docker daemon хоста через `/var/run/docker.sock` (MVP). Для scale — отдельный Docker-host по TCP+TLS.

## ADR-004: 15 обязательных ограничений ресурсов для каждого sandbox
Перечислены в PROMPT.md. Сопровождаются 9 security-тестами. Без любого ограничения sandbox не настроен, Phase 2 не закрывается.

## ADR-005: Gitea, не GitLab
GitLab CE — 4GB RAM. Gitea — ~200MB. Имеет REST API v1 полностью достаточный для нужд Adorable (repos, commits, contents, branches).

## ADR-006: Proxy — Caddy 2, не Traefik
Caddy имеет встроенный Admin API для программного управления. Для AI-билдера со spawn/destroy sandbox'ов это чище чем Docker-labels-based подход Traefik.

## ADR-007: Проброс сокета Docker хоста
Билдер получает Docker daemon через `/var/run/docker.sock`. MVP. На scale — отдельный sandbox-host + TCP+TLS.

## ADR-008: Гибридный dev/prod через compose-профили
`docker-compose.yml` — инфра всегда (Postgres, Gitea, Caddy). `docker-compose.prod.yml` override добавляет билдер. В dev билдер работает локально (быстрый HMR), финальная e2e-верификация — в prod-профиле.

## ADR-009: Префикс `fork:` в коммитах
Для ребейза на upstream.

## ADR-010: Kamal для деплоя билдера (опционально v2)
Ноль overhead, YAML в репо, SSH+Docker. Не Coolify, не k8s.

## ADR-011: Playwright MCP для верификации UI
Каждая UI-задача проверяется через реальный браузер. Скриншот + console + network → VERIFICATION_LOG.md.

## ADR-012: Cleanup-воркер для sandbox
Каждые `SANDBOX_CLEANUP_INTERVAL_SEC` — idle > `IDLE_TIMEOUT_MIN` или возраст > `MAX_LIFETIME_MIN` → kill + remove + `ProxyProvider.removeRoute`.

## ADR-013: Единый audit log
`SANDBOX_AUDIT_LOG` (JSON lines): создание/уничтожение контейнеров + добавление/удаление proxy-роутов + LLM вызовы (по флагу).

## ADR-014: LLM — GLM от Z.ai через адаптер
Целевой рынок Россия. Z.ai API доступен из РФ, оплата картой.
- Основной провайдер: `zai` (через `@ai-sdk/openai-compatible`, endpoint `https://api.z.ai/api/paas/v4`).
- Альтернатива: `openrouter` (через `@openrouter/ai-sdk-provider`).
- Fallback: `anthropic` (`@ai-sdk/anthropic`, для совместимости).
- Модели: `glm-5.1` (main, `LLM_MAIN_MODEL`), `glm-4.5-air` (fast, `LLM_FAST_MODEL`).
- GLM явно заточен под long-horizon agentic workflows → подходит для чата с tool use.

## ADR-015: Идентификация пользователя — Better Auth, не Freestyle identities
Freestyle identity-session заменяется на Better Auth (email+password по умолчанию, OAuth опционально). `BETTER_AUTH_SECRET` уже в `.env`. Per-user репо-разрешения хранятся в app Postgres.

## ADR-016: Хранение метаданных проекта — остаётся в git-репо (wrapper-repo)
Apartheid между `sourceRepoId` (код пользователя) и `wrapperRepoId` (adorable-meta) сохраняется. Wrapper-репо хранится в Gitea. Конверсации, deployment-history, project name — как раньше в JSON-файлах wrapper-репо.

## ADR-017: `npm run` как основной менеджер пакетов
Корневой package.json использует workspaces + npm. PROMPT.md говорит про `pnpm`, но реальность — npm. Совместимость сохраняется: `pnpm run dev:infra:up` работает эквивалентно `npm run dev:infra:up`.
