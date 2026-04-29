# OPEN_QUESTIONS.md — нерешённые вопросы

Сводный список открытых вопросов спек-сессии. Сгруппирован по
тематикам, отмечен приоритет (blocker MVP / post-MVP / longer-term).

Для каждого вопроса — связанный ADR / документ / контекст.

---

## A. Lifecycle и cleanup

### A1. TTL scratch dir по inactivity
**Источник**: ADR-006.
**Приоритет**: post-MVP (default acceptable).
**Вопрос**: какой период разумный — дни / недели?
**Default-предложение**: `SCRATCH_DIR_TTL_DAYS=30`. Перепроверить
после первой недели на staging — анализ disk usage.

### A2. TTL для готовых артефактов `/data/static/<id>/`
**Источник**: BUILD_PIPELINE.md §10.
**Приоритет**: post-MVP.
**Вопрос**: то же что A1, но для `/data/static/<id>/`.
**Default-предложение**: `STATIC_DIR_TTL_DAYS=90` (превью полезен
дольше, пока пользователь о нём помнит).

### A3. `BUILD_HISTORY_LIMIT` дефолт
**Источник**: ADR-004.
**Приоритет**: blocker MVP (нужно дефолт).
**Default-предложение**: `5`. Достаточно для rollback в типичных
случаях; при необходимости platform-engineer может увеличить.

### A4. Размер build-cache при долгих проектах
**Источник**: ADR-016.
**Приоритет**: post-MVP.
**Вопрос**: что делать когда `/data/projects/<id>/.vite/` разрастается
> 1 GB?
**Предложение**: monitor через cleanup-worker, при превышении quota
делать `rm -rf .vite/` и cold-rebuild. Точная quota — после метрик.

---

## B. Concurrency и performance

### B1. Метрика cache hit-rate Vite
**Источник**: BUILD_PIPELINE.md §6.
**Приоритет**: post-MVP.
**Вопрос**: сколько % билдов реально hit'ят cache, сколько cold?
**Подход**: парсить stdout vite на маркер «cache hit» (если есть)
или сравнивать durationMs cold vs warm.

### B2. Целевая метрика incremental build
**Источник**: ADR-009.
**Приоритет**: blocker Phase 6 acceptance.
**Default-предложение**: p50 ≤ 3s, p95 ≤ 5s warm. Если не достигаем —
оптимизация cache strategy.

### B3. Cross-project build concurrency
**Источник**: SECURITY.md §3.10.
**Приоритет**: post-MVP.
**Вопрос**: один пользователь с N проектами может занять N build-
runner'ов.
**Default-предложение**: `BUILD_RUNNER_GLOBAL_CONCURRENCY=unbounded`
на MVP, добавить лимит при появлении проблем.

### B4. Точные таймауты SIGTERM/SIGKILL для cancel
**Источник**: ADR-012.
**Приоритет**: blocker MVP (default fine).
**Default-предложение**: `BUILD_CANCEL_GRACE_MS=2000`. Поведение если
SIGKILL завис: dockerode выдаст exception → status `failed` с
понятной ошибкой.

### B5. Замер реального overhead старта ephemeral контейнера
**Источник**: ADR-005.
**Приоритет**: blocker Phase 2 acceptance.
**Подход**: измерить на нашей машине через `docker run --rm hello`
loop (100 раз). Цель: < 1.5s. Если выше — переоценить ephemeral подход.

---

## C. SSE и UI

### C1. Поведение SSE при рестарте билдера
**Источник**: ADR-011.
**Приоритет**: post-MVP.
**Вопрос**: что показать UI? «Connection lost» или silent reconnect?
**Default-предложение**: client-side EventSource auto-reconnect,
toast «соединение восстановлено» при первом успешном reconnect.

### C2. Поведение overlay при cancel'ed билде
**Источник**: ADR-004 + ADR-012.
**Приоритет**: blocker MVP UX.
**Вопрос**: после `cancelled` сразу показывать «running» (next job)
или интерлюдия «отменён»?
**Default-предложение**: если queued есть → сразу running без
интерлюдии. Иначе → убрать overlay (вернуться к last-good).

### C3. Лимит concurrent SSE подписок per project / per user
**Источник**: SECURITY.md §3.9.
**Приоритет**: post-MVP.
**Вопрос**: сколько одновременных SSE-стримов на projectId? на
userId?
**Default-предложение**: 10 на projectId, 100 на userId (мониторить).

---

## D. UI uploads и assets

### D1. ClamAV для UI uploads
**Источник**: ADR-007.
**Приоритет**: post-MVP.
**Вопрос**: нужен ли антивирус сверх magic-bytes?
**Зависит**: от threat model нашей аудитории. Для MVP — не нужен,
acceptable risk (см. SECURITY.md §3.4).

### D2. SVG `<script>` sanitize
**Источник**: SECURITY.md §3.4.
**Приоритет**: post-MVP.
**Вопрос**: нужно ли фильтровать `<script>` из SVG через DOMPurify
server-side?
**Default-предложение**: не нужно на MVP (self-XSS scope), пересмотр
если делимся preview-URL'ами с третьими лицами как штатное поведение.

---

## E. Boilerplate и зависимости

### E1. Strip'ы в следующем bump'е boilerplate'а
**Источник**: ADR-019, DEPENDENCIES.md §7.
**Приоритет**: post-MVP.
**Кандидаты**:
- `three` (~600KB gzip) — нишевой 3D, оставлять?
- `react-leaflet` без peer `leaflet` — добавить leaflet или strip?
- `react-quill` — известны peer-issues с React 19; стек move на TipTap?
- `moment` — deprecated, дублирует `date-fns` → strip.
- `lodash` (CJS) → `lodash-es` для tree-shaking.

### E2. Toast-библиотеки дублирование
**Источник**: ADR-019, DEPENDENCIES.md §7.
**Приоритет**: post-MVP.
**Вопрос**: оставить `sonner`, `react-hot-toast` или
`@radix-ui/react-toast`?
**Default-предложение**: оставить `sonner` (modern API), strip
остальные в следующем bump'е.

### E3. Lint-step в build pipeline
**Источник**: ADR-019.
**Приоритет**: post-MVP.
**Вопрос**: нужен ли `eslint` step? Если да — возвращаем eslint-deps.
**Default**: не нужен на MVP. LLM редко делает stylistic-issues,
runtime ошибки ловит билд.

### E4. Частота автомиграций boilerplate'а
**Источник**: ADR-008.
**Приоритет**: post-MVP.
**Вопрос**: cron / on-release / manual-only?
**Default-предложение**: manual trigger от platform-team на новую
версию + UI-баннер для каждого пользователя «доступен апдейт».

### E5. Откат на ещё более старую версию boilerplate'а
**Источник**: BOILERPLATE.md §6.
**Приоритет**: longer-term.
**Вопрос**: поддерживаем ли откат `1.2.3 → 1.2.2`?
**Default**: нет, только `current ↔ previous` через ADR-008. Для
истории — pin вручную через platform.

### E6. Тест на сохранение pnpm-симлинков при `cp -a`
**Источник**: ADR-005.
**Приоритет**: blocker Phase 2 acceptance.
**Подход**: shell script + CI gate (см. VERIFICATION.md IC-9).

---

## F. Functions / BaaS интеграция

### F1. Выбор BaaS-провайдера для `functions/` runtime
**Источник**: ADR-021.
**Приоритет**: post-MVP (отдельная сессия).
**Кандидаты**:
- Self-hosted Appwrite — наиболее prominent base44-style.
- Cloudflare Workers — vendor lock-in, но мощно.
- Самописный Deno-host — больше работы, больше control.
- AWS Lambda / Yandex Cloud Functions — vendor.

### F2. `tsc --noEmit functions/**/*.ts` step в build pipeline
**Источник**: ADR-021.
**Приоритет**: post-MVP.
**Вопрос**: нужна ли best-effort валидация типов даже без runtime?
**Default**: не нужна на MVP, добавить если функции реально
исполняются.

### F3. UX для frontend-функций связи на MVP
**Источник**: ADR-021.
**Приоритет**: blocker MVP UX.
**Вопрос**: LLM пишет `fetch('/api/foo')` — что произойдёт?
- (a) 404 от Caddy — пользователь видит молчаливую ошибку.
- (b) Caddy роут на builder, который возвращает «functions runtime
  not configured» json.
- (c) Bot в чате предупреждает: «вы создали функцию, но она ещё не
  работает; подключите BaaS чтобы запустить».

**Default-предложение**: (c) — bot warning при детектировании
`fetch('/api/...')` в `src/`-коде через парсер.

### F4. Multi-tenant isolation в shared BaaS-runtime
**Источник**: SECURITY.md §7.
**Приоритет**: longer-term (с BaaS).

### F5. Secrets management для `Deno.env.get(...)` в functions
**Источник**: SECURITY.md §7.
**Приоритет**: longer-term (с BaaS).

---

## G. Capabilities и provider lifecycle

### G1. Provider deprecation behaviour
**Источник**: ADR-015.
**Приоритет**: longer-term.
**Вопрос**: что если провайдер из metadata больше не существует
(например `static` deprecated)?
**Default-предложение**: fallback на текущий default, audit-log
warning, UI prompt при следующем create.

### G2. Семантика `PREVIEW_PROVIDER_FORCE_SANDBOX` override
**Источник**: MIGRATION_PATH.md §6.
**Приоритет**: blocker Phase 6 (emergency rollback path).
**Вопрос**: force всех в sandbox или только новые? что делать с
existing `provider="static"` в metadata?
**Default-предложение**: force затрагивает только new-create
(metadata pinning остаётся), для существующих — отдельный migration
worker `migrate-static-to-sandbox`.

---

## H. Scaling и infra

### H1. Sticky sessions → S3-compat план масштабирования
**Источник**: ADR-006.
**Приоритет**: longer-term.
**Триггер**: первое появление concurrent user'ов > N (метрика).
**Подход**: load balancer с sticky sessions (consistent hashing на
projectId), позже — S3-compat для scratch (Yandex Object Storage /
MinIO).

### H2. Audit-log переименование
**Источник**: SECURITY.md §6.
**Приоритет**: post-MVP cleanup.
**Вопрос**: `SANDBOX_AUDIT_LOG` env переименовать в
`ADORABLE_AUDIT_LOG` (поскольку покрывает не только sandbox)?
**Default-предложение**: yes, в Phase 7 cleanup.

### H3. Метрика hit-rate AVAILABLE_DEPS suggestions
**Источник**: ADR-018, DEPENDENCIES.md §5.
**Приоритет**: post-MVP.
**Вопрос**: какие модули наиболее часто пытается импортировать LLM
из вне списка? Для расширения synonyms таблицы.
**Подход**: парсить audit-log на `path-rejected` / `import-not-allowed`
events.

---

## I. Compliance и legal

### I1. Полный compliance review для production launch
**Источник**: SECURITY.md §8.
**Приоритет**: longer-term.
**Темы**: ФЗ-152, GDPR (если ЕС-пользователи), DMCA (если share-by-
default), terms of use.

### I2. Privacy для preview URLs
**Источник**: SECURITY.md §3.12.
**Приоритет**: longer-term.
**Вопрос**: добавить аутентификацию на Caddy для preview URLs
(cookie-based)?
**Зависит** от продуктового решения «public share by default» vs
«private + share-link».

---

## J. Документация и migrations root-уровневых файлов

### J1. Migration root-уровневых docs
**Источник**: MIGRATION_PATH.md §7.
**Приоритет**: post-MVP cleanup.
**Действие**: перенести `MIGRATION_PLAN.md`, `STATE.md`, `PROGRESS.md`,
`BLOCKERS.md` в `docs/legacy/` после Phase 6.

### J2. Корневой `SECURITY.md` vs `docs/preview-provider/SECURITY.md`
**Источник**: SECURITY.md §9.
**Приоритет**: post-MVP cleanup.
**Действие**: обновить корневой `SECURITY.md` с поправкой на
PreviewProvider, ссылка на детальный `docs/preview-provider/SECURITY.md`.

---

## K. Backlog (не блокеры, но идеи)

- **Build artifacts CDN** — артефакты не отдаются Caddy напрямую,
  а через CDN (более масштабируемо).
- **Multi-tenant builder** — изолированные builder-instance'ы для
  enterprise-клиентов.
- **Bring your own boilerplate** — пользователь подключает свою
  ветку `templates/`. Сложно из-за security review каждой версии.
- **Live shared editing** — двое пользователей в одном проекте
  одновременно. Конфликты в scratch dir.

---

## Резюме приоритетов

**Blocker MVP (Phase 0–6)**:
- A3 (BUILD_HISTORY_LIMIT default), B2 (целевая метрика incremental
  build), B5 (замер overhead контейнера), C2 (overlay при cancel),
  E6 (тест на pnpm-симлинки), F3 (UX для frontend-functions связи),
  G2 (PREVIEW_PROVIDER_FORCE_SANDBOX семантика).

**Post-MVP (после default switch)**:
- A1, A2, A4, B1, B3, B4, C1, C3, D1, D2, E1, E2, E3, E4, F2, H2, H3,
  J1, J2.

**Longer-term**:
- E5, F1, F4, F5, G1, H1, I1, I2.

**Backlog (idea-stage)**:
- K.

---

_Last updated: 2026-04-28. Закрытые вопросы переносить в DECISIONS.md как ADR'ы._
