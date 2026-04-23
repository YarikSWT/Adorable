# Текущее состояние

**Итерация:** 19 (FORK_MIGRATION_COMPLETE).
**Дата:** 2026-04-23

## Окружение
- Node: v22.22.2 (nvm).
- Docker: 29.4.1, daemon работает.
- npm workspaces.
- `.env` с ключами Z_AI, BETTER_AUTH_SECRET, GITEA_* готовы. Z.ai балансом пополнен.

## Финальный e2e (iter 19) — ✅
Через Playwright MCP на `http://localhost:3000`:
- Home рендерится, API-gate скрыт (hasGlobalKey учитывает Z_AI_API_KEY).
- Промпт "Write a minimal Express server on port 3001 responding 'Hello from GLM'":
  - `POST /api/repos 200` → Gitea repo + Docker sandbox созданы.
  - `POST /api/chat 200 in 108s` — **GLM-5.1 streaming через `lib/adapters/llm.ts`** (z.ai base: api.z.ai/api/coding/paas/v4).
  - Agent iteratively: bash heredoc writeFile server.js → `npm install express --cache /tmp/.npm-cache` → start server в фоне → verify с `node http.get` → "Hello from GLM" получен.
- Второй промпт: `index.html` + node `http.createServer().listen(3000)`.
  - Caddy автоматически имеет route `<sandboxId>.preview.localhost → sandbox:3000`.
  - `curl -H Host:<id>.preview.localhost http://localhost:8080/` → `200` + валидный HTML.
  - Browser-render: `http://<id>.preview.localhost:8080/` отдал heading "Hello from GLM on Caddy via Adorable fork".
- Скриншоты: `verification/screenshots/final-e2e-prod.png` (preview HTML), `final-e2e-home.png`, `final-e2e-chat.png`.

## Фикс iter 19
- `sandbox-docker.ts::create` — `safeRepoTag` теперь обрезается до 28 символов + short hash, чтобы итоговый container name ≤ 63 символов (DNS label limit RFC 1035). Без этого Caddy не мог резолвить upstream по имени. Тесты: 105/105 unit + 9/9 docker security зелёные после фикса.

## Инфра (Phase 1) — готово
- 4 сервиса: `adorable-postgres-app`, `adorable-postgres-gitea`, `adorable-gitea` (1.22.3), `adorable-caddy` (2.8-alpine).
- Gitea UI/API: `http://127.0.0.1:3011`. Caddy Admin API: `http://127.0.0.1:2019`. HTTP:8080, HTTPS:8443.
- Сети: `adorable_infra` (инфра), `adorable_sandboxes` (sandbox'ы + Caddy).

## LLM (Phase 1.5) — готово
- 5 провайдеров в `lib/adapters/llm.ts`. Тесты 17/17.

## Sandbox (Phase 2) — готово
- Docker через dockerode, все 15 ограничений (CPU/Memory/PIDs/ReadonlyRootfs/CapDrop/…/Tmpfs/AuditLog).
- 9/9 security-тестов зелёные на живом Docker.
- Audit log: `/tmp/adorable-sandbox-audit.log` JSON-lines.

## Git (Phase 3) — готово
- GitProvider + gitea-impl, 14 contract + 4 integration tests зелёные.
- Identity упрощена (uuid cookie + in-memory ACL).

## Proxy (Phase 4) — готово
- ProxyProvider + caddy-impl. Sandbox lifecycle hooks: createVmForRepo → addRoute per domain. cleanup-worker cascade → removeSandboxRoutes.
- 9 contract + 6 caddy integration + 3 security tests зелёные.

## Deploy (Phase 5) — [→v2] за scope MVP

## Phase 6 — готово
- freestyle-* удалены из package.json.
- README, FORK_CHANGES.md, SECURITY.md, CI workflow, Kamal config/deploy.yml — есть.
- Final e2e в prod-профиле — ✅ (этот документ).

## Суммарные тесты (после iter 19 фикса)
- 105/105 unit tests (вkl. llm-adapter / sandbox-contract / audit-log / sandbox-docker-config / cleanup-worker / git-contract / proxy-contract / proxy-security).
- 9/9 sandbox-security на живом Docker (gated).
- 4/4 gitea-integration (gated).
- 6/6 caddy-integration (gated).
- `npm run build` зелёный.
