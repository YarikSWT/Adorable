# MIGRATION_PATH.md — план перехода с sandbox-only на static + sandbox

Описывает порядок работ для миграции существующего кода форка на
архитектуру PreviewProvider (static как default, sandbox как
fallback). Цель — переезд **без поломки прода** и с возможностью
отката на любой стадии.

Source: все ADR (особенно ADR-008 lifecycle, ADR-015 capabilities pin),
ARCHITECTURE.md, CONTRACTS.md.

---

## 1. Принципы миграции

1. **Параллельная разработка.** Sandbox-режим **остаётся
   работоспособным** на каждом коммите. Не ломаем существующих
   пользователей.
2. **Feature flag-driven rollout.** Default `PREVIEW_PROVIDER=sandbox`
   до момента когда static-режим прошёл VERIFICATION. Затем default
   меняется одной строкой в `.env`.
3. **Адаптерный паттерн уже есть.** Мы добавляем новый адаптер,
   а не переписываем существующие.
4. **Существующие проекты не мигрируют автоматически.** Они остаются
   на `provider: "sandbox"` (через ADR-015 pinning). Новые проекты
   получают новый default. Migration tool — отдельный шаг.
5. **Тесты добавляются одновременно с кодом.** Каждая фаза имеет
   контракт-tests + integration-tests + e2e-acceptance.

---

## 2. Фазы (последовательно, не параллельно)

### Phase 0 — Подготовка (no behavior changes)

Цель: подготовить инфраструктуру без изменения поведения.

- [ ] **Spec lock.** `docs/preview-provider/*.md` ревью и заморозка.
      Любые правки — через ADR с bump'ом (никаких silent fix'ов).
- [ ] **Sanity-snapshot.** Запустить полный текущий e2e
      (`tests/landing-flow-e2e.test.ts` + Playwright MCP) и
      зафиксировать «золотой» baseline. Потом сравниваем.
- [ ] **`.env.example`** добавить новые env'ы (см. BUILD_PIPELINE.md
      §10), все с default'ами совместимыми с sandbox-режимом
      (`PREVIEW_PROVIDER=sandbox`).
- [ ] **Файлы `templates/vite-react/VERSION`** и
      `templates/vite-react/AVAILABLE_DEPS.md` — создать (`VERSION=1.0.0`,
      AVAILABLE_DEPS пустой placeholder).

**Откат**: тривиален — ничего не изменилось в коде.

### Phase 1 — Новые контракты (interfaces + mocks + factory)

Цель: типы и factory PreviewProvider'а появляются, mock работает,
sandbox-impl — тонкая обёртка над текущим кодом.

- [ ] `lib/adapters/preview.ts` — типы из CONTRACTS.md §1–10.
- [ ] `lib/adapters/preview-mock.ts` — минимальный mock для тестов.
- [ ] `lib/adapters/preview-sandbox.ts` — обёртка над текущим
      `lib/adorable-vm.ts` + sandboxProvider, маппит
      `VmRuntimeMetadata → PreviewMetadata`. Capabilities —
      `SANDBOX_CAPABILITIES`.
- [ ] `lib/preview/provider-singleton.ts` — singleton'ы
      (preview + buildQueue stub).
- [ ] `tests/preview-contract.test.ts` — контракт-тесты на mock
      (lifecycle, ref idempotence, capabilities).
- [ ] **НЕ** интегрируем в `repos/route.ts` пока. Bizness-код
      продолжает использовать `createVmForRepo` напрямую.

**Откат**: новые файлы → удалить.

### Phase 2 — Static-impl без queue (синхронный билд)

Цель: получить рабочий end-to-end vite build через ephemeral
docker-runner. Очередь и SSE — следующая фаза.

- [ ] `docker/build-runner-react/Dockerfile` + `init-volume.sh`.
      Сборка образа `build-runner-react:1.0.0` локально. Тест на
      сохранение pnpm-симлинков при `cp -a` в named volume.
- [ ] Расширение `templates/vite-react/`:
      - `package.json` обновить под полный список ADR-019.
      - `pnpm install` локально, commit `pnpm-lock.yaml`.
      - `functions/tsconfig.json` создать.
      - `functions/` папка пустая.
- [ ] `lib/preview/project-fs.ts` — `ProjectFs` impl на node fs
      (whitelist через `isWritablePath`).
- [ ] `lib/adapters/preview-static.ts` — реализация:
      - `create()` — scratch dir + Caddy file_server + первый
        синхронный билд.
      - `build()` — `docker run --rm` с mounts из BUILD_PIPELINE.md §4,
        atomic swap.
      - `destroy()` — `rm -rf` + `removeRoute`.
      - `touch()` — стандартный паттерн.
- [ ] `lib/preview/build-error-parser.ts` — best-effort парсер.
- [ ] `lib/preview/available-deps.ts` — таблица + synonyms (DEPENDENCIES.md §5).
- [ ] `scripts/generate-available-deps.ts` — генератор
      `AVAILABLE_DEPS.md` из `package.json` + synonyms.
- [ ] Расширение `lib/adapters/proxy.ts`:
      - `ProxyRouteTarget` дискриминированный union.
      - `lib/adapters/proxy-caddy.ts` — поддержка `file_server`.
      - `lib/adapters/proxy-mock.ts` — то же.
      - `tests/proxy-contract.test.ts` обновить.
- [ ] Тесты:
      - `tests/preview-static.test.ts` — синхронный билд (через
        `RUN_DOCKER_TESTS=1`).
      - `tests/build-error-parser.test.ts` — корпус примеров stderr.
      - `tests/project-fs.test.ts` — whitelist + traversal.

**Откат**: `PREVIEW_PROVIDER` остаётся sandbox по умолчанию,
никто не вызывает `preview-static`. Удалить файлы безопасно.

### Phase 3 — BuildQueue + SSE + cancel

Цель: асинхронная очередь, отмена, SSE для UI.

- [ ] `lib/preview/build-queue.ts` — реализация ADR-012 (max 1+1,
      cancel+replace, EventEmitter API).
- [ ] `app/api/projects/[id]/build-status/route.ts` — SSE.
- [ ] `app/api/projects/[id]/rebuild/route.ts` — manual rebuild.
- [ ] `app/api/projects/[id]/upload/route.ts` — UI uploads с
      magic-bytes валидацией.
- [ ] Перевод `preview-static.build()` на cancel-aware
      (AbortSignal → `container.kill`).
- [ ] Тесты:
      - `tests/build-queue.test.ts` — все переходы статусов.
      - `tests/preview-static-cancel.test.ts` — SIGTERM/SIGKILL flow.
      - `tests/upload.test.ts` — magic-bytes, size cap, traversal.
      - `tests/sse-build-status.test.ts` — отписка на финале,
        keep-alive.

**Откат**: queue существует но никто её не вызывает (chat/route.ts
ещё не enqueue'ит). API endpoints возвращают 404 для не-static
проектов.

### Phase 4 — Wire orchestration (за feature flag)

Цель: бизнес-код использует PreviewProvider, поведение зависит от
`PREVIEW_PROVIDER` env.

- [ ] `lib/repo-types.ts` — добавить `boilerplateVersion`, `preview {...}`.
- [ ] `app/api/repos/route.ts`:
      - `getPreviewProvider().create({repoId})` вместо
        `createVmForRepo(repoId)`.
      - Записать в metadata `boilerplateVersion`, `preview.{provider, capabilities, createdAt}`.
- [ ] `app/api/chat/route.ts`:
      - `getPreviewProvider()` для определения capabilities.
      - `getSystemPrompt(capabilities)` вместо старого `SYSTEM_PROMPT`.
      - `createTools(opts)` с новой сигнатурой (см. CONTRACTS.md §13).
      - `onFinish` после batch-commit делает
        `getBuildQueue().enqueue(...)` non-blocking — **только если**
        capabilities.manualRebuild (т.е. static-режим). В sandbox —
        старое поведение (никакого build'а, HMR справляется).
- [ ] `lib/system-prompt.ts` — `getSystemPrompt(capabilities)` с
      branching из CONTRACTS.md §14.
- [ ] `lib/create-tools.ts` — новая сигнатура `CreateToolsOptions`,
      pure-fs реализации `list/search/mkdir/move/delete`,
      capability-driven выбор tools.
- [ ] **Default `PREVIEW_PROVIDER=sandbox`** в `.env.example`,
      компонент тестируется через явное `PREVIEW_PROVIDER=static`
      переключение в test-env'ах.
- [ ] Тесты:
      - `tests/landing-flow-e2e.test.ts` адаптировать на новый
        контракт. Параметризовать по env'у.
      - Новый `tests/static-flow-e2e.test.ts` — полный продуктовый
        сценарий (см. VERIFICATION.md).

**Откат**: `PREVIEW_PROVIDER=sandbox` восстанавливает 100% старое
поведение. Все новые компоненты молчат.

### Phase 5 — Migration script для существующих репо

Цель: апгрейд `RepoMetadata` для проектов созданных до Phase 4.

- [ ] `scripts/migrate-repo-metadata.ts`:
      - Пробегается по всем репо в Gitea.
      - Если `RepoMetadata` нет `boilerplateVersion` — set `"1.0.0"`.
      - Если нет `preview` — set
        `{provider: "sandbox", capabilities: SANDBOX_CAPABILITIES, createdAt: now()}`.
      - **Не переключает** на static автоматически.
- [ ] `scripts/migrate-repo-to-static.ts` (manual, per-project):
      - `previewProvider.create({repoId})` для конкретного projectId.
      - Старый sandbox для этого projectId — destroy.
      - Update `RepoMetadata.preview.provider` → "static".
- [ ] Тесты на migration script (в `tests/migrate-*.test.ts`).
- [ ] Документировать в README процесс migration.

**Откат**: migration script идемпотентный; повторный запуск с
правильными env'ами не сломает.

### Phase 6 — Switch default

Цель: новые проекты создаются как static.

- [ ] **Preflight** на staging-инстансе:
      `npx tsx scripts/preflight-static.ts` — проверяет env vars +
      writable directories. Exit code 1 значит fix remediations
      перед flip'ом. Расширяемое — checks для docker/caddy/gitea
      добавляются по мере доступа к staging-инфре.
- [ ] **Полный VERIFICATION run** (см. VERIFICATION.md). Все
      acceptance-tests должны быть зелёными при
      `PREVIEW_PROVIDER=static`.
- [ ] **Замер метрик** на staging через
      `scripts/bench-static-build.ts`:
      - p50/p95 build time → заполнить BENCHMARKS.md
      - p50/p95 turn end-to-end (chat → preview update)
      - Success rate билдов
      - Size of `node_modules` named volume
- [ ] Поменять `.env.example` default → `PREVIEW_PROVIDER=static`.
      Production deploy (через Kamal) подхватит на следующем
      releas'е.
- [ ] **Прокатка**: первая неделя — `scripts/audit-summary.ts` через
      cron'у каждые 5 минут (см. MONITORING.md cron sample), exit
      code 10 → pager. Тюнинг порогов через `--success-rate-min`
      etc. без редеплоя.

**Откат**: вернуть `PREVIEW_PROVIDER=sandbox` в env, retag image,
redeploy. Существующие проекты с `provider: "static"` в metadata
останутся на static (capabilities pinned, ADR-015) — они лучше всего
останутся в работе. Новые проекты опять будут sandbox.

### Phase 7 — Cleanup (опционально)

Цель: убрать мёртвый код **только если ясно что sandbox не нужен**.

- [ ] **Не удаляем** sandbox-режим. Он fallback для отладки и
      будущих fullstack-проектов.
- [ ] Удалить **только** мёртвый legacy-код:
      - `seedSandboxFromTemplate` / `seedSandboxFromSourceRepo` из
        `template-seeder.ts` если они переехали в `preview-sandbox.ts`
        и больше нигде не вызываются.
      - Старые root-уровневые `MIGRATION_PLAN.md`, `STATE.md`,
        `PROGRESS.md`, `BLOCKERS.md` — перенести в `docs/legacy/` или
        удалить.

---

## 3. Risks & rollback strategies

| Phase | Риск                                              | Rollback                                |
|-------|---------------------------------------------------|------------------------------------------|
| 0     | Spec неясная при start                            | Спек-сессия повторяется                  |
| 1     | Сломанный contract → mock-tests красные           | Revert files в Phase 1                   |
| 2     | Build-runner image не собирается / симлинки сломаны | Revert образа, пользоваться sandbox     |
| 2     | Vite build даёт неожиданные ошибки               | Расширить tests/build-error-parser, не блокирует MVP |
| 3     | Queue race conditions                             | Disable static в env                     |
| 4     | onFinish enqueue ломает chat stream               | env-rollback к sandbox                   |
| 5     | Migration script портит существующие metadata    | Идемпотентность + dry-run mode перед apply |
| 6     | Production p95 build time неприемлем              | env-rollback; оптимизация cache strategy |

---

## 4. Test matrix по фазам

| Phase | Unit | Contract | Integration (RUN_*) | E2E |
|-------|------|----------|---------------------|-----|
| 0     | —    | —        | sanity               | golden |
| 1     | preview-mock | preview-contract | — | — |
| 2     | parser, fs, isWritable | preview-static | RUN_DOCKER_TESTS | — |
| 3     | build-queue | sse-status | RUN_DOCKER_TESTS | — |
| 4     | system-prompt branching, createTools | — | RUN_DOCKER_TESTS, RUN_GITEA_TESTS, RUN_CADDY_TESTS | static-flow-e2e |
| 5     | migrate-script | — | RUN_GITEA_TESTS | dry-run + apply |
| 6     | — | — | full | full + Playwright MCP |

---

## 5. Что параллелизуется внутри фазы

Фазы строго последовательны (порядок зависимостей). Внутри фазы
несколько работ можно делать параллельно:

- **Phase 2**: Dockerfile + boilerplate update + project-fs +
  preview-static + parser — четыре независимых трека.
- **Phase 3**: build-queue + SSE + uploads + cancel-flow — три трека.
- **Phase 4**: orchestration + create-tools + system-prompt — три трека.

---

## 6. Минимальный smoke-flag для отката

В builder process'е:

```ts
// lib/preview/provider-singleton.ts (псевдокод)
export const getPreviewProvider = async () => {
  const fallback = process.env["PREVIEW_PROVIDER_FORCE_SANDBOX"];
  if (fallback === "1") {
    // emergency rollback — игнорировать env PREVIEW_PROVIDER, всех в sandbox
    return createPreviewProvider({providerOverride: "sandbox"});
  }
  // обычная логика
  ...
};
```

Это даёт production-incident-mode: одна env-переменная, перезапуск
билдера → static-проекты переключаются на sandbox-fallback (через
ADR-015 это **не должно** случаться автоматически, потому что
metadata pinned; но flag даёт emergency override для случая когда
static катастрофически сломан).

В `OPEN_QUESTIONS.md`: семантика этого override (force всех в sandbox
или только новые? что делать с metadata.preview.provider="static"
при force?).

---

## 7. Связь с существующими root-уровневыми документами

| Root-документ                | Действие при миграции                          |
|------------------------------|------------------------------------------------|
| `MIGRATION_PLAN.md` (Phase 0–6 sandbox-only) | Перевести в `docs/legacy/`. Эта спек заменяет |
| `FORK_CHANGES.md`            | Дополнить: PreviewProvider добавлен            |
| `SECURITY.md` (root)         | Дополнить: secticn про static (или ссылка на `docs/preview-provider/SECURITY.md`) |
| `STATE.md`, `PROGRESS.md`    | Перенести в `docs/legacy/`                     |
| `README.md`                  | Раздел «PreviewProvider» с быстрым стартом     |

---

_Last updated: 2026-04-28._
