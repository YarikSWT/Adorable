# VERIFICATION.md — как проверить что новая архитектура работает

Документ описывает **acceptance criteria** для миграции на static-
режим. Делится на (а) продуктовые сценарии «промпт → рабочий сайт»
и (б) инфра-проверки.

Source: ARCHITECTURE.md, BUILD_PIPELINE.md, CONTRACTS.md.

Стиль: формат BDD-сценариев, чтобы можно было использовать как
spec для тестов и как чек-лист ручной проверки через Playwright MCP.

---

## 1. Продуктовые сценарии

Все сценарии запускаются с `PREVIEW_PROVIDER=static`, свежесозданным
проектом и LLM в режиме z.ai/glm-5.1.

### Scenario 1: Лендинг кофейни

**Дано**: пользователь авторизован, открыта домашняя страница.

**Действие**:
1. Создать проект «Coffee Shop».
2. Промпт: «Сделай минималистичный лендинг для кофейни с hero-секцией,
   меню (3 позиции с ценами), формой обратной связи, и подвалом с
   адресом».

**Ожидание**:
- POST /api/repos → 200, в Gitea появился репо `coffee-shop` с
  initial commit (template).
- POST /api/chat → стрим LLM. LLM использует writeFileTool как
  минимум для `src/pages/Home.jsx`, `src/components/...` (минимум
  3-5 file writes).
- onFinish: один git commit с changes; `buildQueue.enqueue`.
- SSE `/build-status`: queued → running → succeeded в течение
  5–15 секунд.
- Caddy на `<projectId>.preview.localhost:8080` отдаёт HTML 200.
- В preview видно: hero (с заголовком о кофе), 3 позиции меню с
  ценами, форма (несколько input + submit), footer с адресом.
- Tailwind работает: классы `text-amber-*`, `bg-stone-*` etc
  отрендерены.
- React-router работает: `/` отдаёт лендинг.

**Acceptance**:
- Visual check ≥ 4 из 4 секций видны.
- Network: 0 запросов к нашему `node_modules` (RO volume не
  лезет в браузер); все ассеты из `<id>.preview.localhost:8080/`.
- Browser console: 0 errors, 0 warnings (acceptable: deprecation
  warnings от Tailwind/React).

### Scenario 2: TODO-приложение с localStorage

**Дано**: то же.

**Действие**:
1. Промпт: «TODO-приложение с возможностью добавить, отметить
   выполненной, удалить задачу. Сохранение в localStorage».

**Ожидание**:
- LLM пишет `src/pages/Home.jsx` с компонентом TODO.
- Использует `useState` + `useEffect` + `localStorage.{get,set}Item`.
- Build → succeeded.
- Iframe: можно добавить task → видно в списке, refresh страницы →
  task всё ещё там (localStorage), удалить → исчезает.

**Acceptance**:
- Список ≥ 3 task'ов добавляется и сохраняется через reload.
- DevTools Application → localStorage содержит наши данные.

### Scenario 3: Калькулятор ипотеки

**Дано**: то же.

**Действие**:
1. Промпт: «Калькулятор ипотеки: ввод суммы, ставки, срока, на
   выходе ежемесячный платёж и общая переплата. Используй красивый
   slider и output cards».

**Ожидание**:
- LLM использует `@radix-ui/react-slider` (доступен в boilerplate'е,
  ADR-019).
- Build succeeded.
- Iframe: три slider'а, output два числа, реактивно меняется при
  изменении любого slider'а.

**Acceptance**:
- Поведение: ввод суммы 5_000_000, ставка 12%, срок 20 — выводится
  ежемесячный платёж близкий к 55_000 ± 5%.
- Иconки `lucide-react` есть (например 🏠 / 💰).

### Scenario 4: Промпт с попыткой использовать backend

**Дано**: свежий проект.

**Действие**:
1. Промпт: «Сделай страницу с формой регистрации, сохраняй пользователей
   в базе и присылай email».

**Ожидание (acceptance criteria для ARCHITECTURE CONSTRAINT)**:
- LLM **не** пишет server-код. Видит ARCHITECTURE CONSTRAINT в
  system-prompt'е.
- Один из приемлемых ответов: предложить форму в UI с placeholder'ом
  «реальное сохранение требует backend — мы покажем mockup; для
  настоящего сохранения подключите BaaS»; или просто localStorage.
- Build → succeeded (никакого `import express` etc).
- Если LLM вдруг попыталась — `getBuildLogsTool` возвращает
  `import-not-allowed` с suggestion'ом из synonyms-таблицы.

### Scenario 5: Manual rebuild

**Дано**: проект с готовым preview.

**Действие**:
1. Пользователь жмёт «Rebuild» в UI.

**Ожидание**:
- POST /api/projects/:id/rebuild → 200 с jobId.
- SSE: queued → running → succeeded.
- iframe.location.reload() — пользователь видит тот же контент
  (нет файловых изменений), но build-id обновился (DevTools Network:
  source-map URLs или etag поменялись).

**Acceptance**:
- Билд в UI занимает < 5 с (тёплый cache).
- Click дважды подряд (debounce 500мс) — второй клик игнорируется.
- Click через 600мс — второй билд cancel'ит первый, в SSE есть
  событие `cancelled`.

### Scenario 6: UI upload изображения

**Дано**: проект с готовым preview.

**Действие**:
1. Пользователь drag-and-drop'ом грузит `coffee-bean.jpg` (200KB).

**Ожидание**:
- POST /api/projects/:id/upload → 200 с `{path: "/coffee-bean.jpg", ...}`.
- Файл в `/data/projects/<id>/public/coffee-bean.jpg`.
- В чате эвент «загружен файл `coffee-bean.jpg`».
- Промпт: «Используй coffee-bean.jpg в hero-секции».
- LLM пишет `<img src="/coffee-bean.jpg">`.
- Build succeeded → preview показывает изображение.

**Acceptance**:
- Файл реально доступен по `<id>.preview.localhost:8080/coffee-bean.jpg`.
- Размер upload'а 6 MB → 400 «size-exceeded».
- Файл `evil.exe` переименованный в `cute.png` → 400
  «magic-bytes-mismatch».

### Scenario 7: Восстановление после рестарта builder'а

**Дано**: проект в работе, в Map накоплены 5 file-write'ов внутри
текущего turn'а.

**Действие**:
1. `kill -9 <builder-pid>` (симуляция краха).
2. Запустить builder снова.
3. Открыть проект в UI.

**Ожидание**:
- Scratch dir на диске не потерян (durability per ADR-006).
- В Gitea — последний committed snapshot (накопленные но не committed
  изменения **потеряны** — это known trade-off ADR-006).
- Manual rebuild через UI работает: scratch dir содержит то, что было
  до crash'а (минус последний un-committed turn).

**Acceptance**:
- Preview всё ещё доступен (артефакт `current` из прошлого
  successful build'а).
- Никаких corrupted-файлов.

### Scenario 8: Migration существующего sandbox-проекта

**Дано**: проект, созданный в sandbox-режиме. `RepoMetadata.preview.provider = "sandbox"`.

**Действие**:
1. Platform-engineer запускает `pnpm migrate:repo-to-static <projectId>`.

**Ожидание**:
- Sandbox этого проекта — destroy.
- Создаётся scratch dir, копируется `src/` и `public/` из template'а
  (или через `seedSandboxFromSourceRepo`-эквивалент, gitea checkout).
- `previewProvider.create()` → static.
- Первый `vite build` → succeeded.
- `RepoMetadata.preview.provider` → "static".

**Acceptance**:
- Preview URL тот же (`<projectId>.preview.<base>`).
- Контент preview совпадает с тем, что был в sandbox'е.

---

## 2. Инфра-проверки

### IC-1: Build-runner spawn + isolation

**Test**: `tests/preview-static-isolation.test.ts` (gated `RUN_DOCKER_TESTS=1`).

```
Запустить build-runner для тестового проекта.
Проверить через docker inspect:
  - HostConfig.ReadonlyRootfs == true
  - HostConfig.NetworkMode == "adorable_build"
  - HostConfig.Memory == BUILD_RUNNER_MEMORY
  - HostConfig.PidsLimit == BUILD_RUNNER_PIDS
  - HostConfig.CapDrop contains "ALL"
  - HostConfig.SecurityOpt contains "no-new-privileges:true"
  - User == "1000:1000"
  - Binds: node_modules :ro, src :ro, public :ro, .vite :rw, dist :rw
```

### IC-2: Atomic swap

**Test**: `tests/atomic-swap.test.ts`.

```
Создать /data/static/<id>/builds/A/index.html с content "A".
ln -s builds/A current.
Параллельно:
  Thread 1: бесконечно читать /data/static/<id>/current/index.html
  Thread 2: создать builds/B/index.html "B", swap current → B (atomic).
Thread 1 НИКОГДА не должен прочитать частичный или несуществующий файл.
```

### IC-3: BuildQueue concurrency

**Test**: `tests/build-queue.test.ts` (mock build implementation).

```
enqueue(P1) → running(P1)
enqueue(P1) → P1 running cancel'ится, P2 queued
enqueue(P1) → P2 заменяется P3 (superseded SSE event), P1 cancel в процессе
после завершения P1 → P3 promote'ится в running
```

### IC-4: SSE keep-alive + reconnect

**Test**: `tests/sse-build-status.test.ts`.

```
Подписаться на /build-status.
Запустить build.
Получить queued → running → succeeded events.
Через 30 с keep-alive event приходит.
Disconnect клиента → server cleanup'ит подписку (нет leak'а).
```

### IC-5: Cancel mid-flight

**Test**: `tests/preview-static-cancel.test.ts` (gated `RUN_DOCKER_TESTS=1`).

```
Запустить build-runner с долгим сценарием (write 1000 файлов).
Спустя 0.5 с послать cancel.
Проверить:
  - container.kill SIGTERM послан
  - через BUILD_CANCEL_GRACE_MS послан SIGKILL (если SIGTERM не помог)
  - status === "cancelled"
  - artifactDir удалена (`fs.exists` returns false)
```

### IC-6: Build history GC

**Test**: `tests/build-history-gc.test.ts`.

```
BUILD_HISTORY_LIMIT=3
Запустить 5 успешных build'ов.
Проверить что builds/ содержит ровно 3 директории — последние 3.
current и previous симлинки указывают на корректные директории.
```

### IC-7: Migration script idempotency

**Test**: `tests/migrate-repo-metadata.test.ts`.

```
Создать N репо с разными metadata states (no preview, partial, full).
Запустить migrate-repo-metadata.
Все репо имеют валидное metadata.
Запустить ещё раз — никаких изменений.
Запустить с искусственно повреждённым metadata — миграция чинит.
```

### IC-8: AVAILABLE_DEPS sync gate

**Test**: CI gate.

```
git diff templates/vite-react/package.json
если изменился — должен изменился AVAILABLE_DEPS.md
если нет — fail CI
```

### IC-9: pnpm symlink integrity in named volume

**Test**: shell script запускается при init-volume.

```
cp -a node_modules/* /target/
walk /target, для каждого symlink проверить существование target.
Если broken → exit 1.
```

### IC-10: ARCHITECTURE CONSTRAINT в system-prompt

**Test**: unit-test.

```
const prompt = getSystemPrompt(STATIC_CAPABILITIES);
expect(prompt).toContain("ARCHITECTURE CONSTRAINT");
expect(prompt).toContain("This project runs as a static SPA");
expect(prompt).not.toContain("npm install <pkg>");

const sandboxPrompt = getSystemPrompt(SANDBOX_CAPABILITIES);
expect(sandboxPrompt).not.toContain("ARCHITECTURE CONSTRAINT");
expect(sandboxPrompt).toContain("npm install");
```

---

## 3. Метрики Phase 6 acceptance

Перед switch default → static нужно зафиксировать на staging:

| Метрика                        | Цель                              |
|--------------------------------|-----------------------------------|
| p50 cold build time            | ≤ 5 секунд                        |
| p95 cold build time            | ≤ 10 секунд                       |
| p50 warm build time (с cache)  | ≤ 3 секунды                       |
| p95 warm build time            | ≤ 5 секунд                        |
| Build success rate             | ≥ 95% на типичных промптах        |
| Build cancel correctness       | 100% — никогда стайл-resource leak |
| SSE event latency (running → received UI) | ≤ 1 секунда           |
| Atomic swap correctness        | 100% — никогда не виден частичный артефакт |
| `node_modules` named volume size | ≤ 1 GB (на текущий ADR-019 список) |
| Build-runner memory peak       | ≤ 1.5 GB (при limit 2 GB)         |

Если метрика не достигнута — Phase 6 откладывается, идём на
оптимизацию (build cache strategy, parallel chunks, etc).

---

## 4. Manual smoke-test через Playwright MCP

После каждого мажорного изменения архитектуры — ручной прогон
через Playwright MCP:

```
1. Открыть http://localhost:3000
2. Создать проект "smoke-test"
3. Промпт: "Сделай страницу 'Hello' с большим заголовком"
4. Дождаться SSE succeeded
5. Открыть iframe (или новую вкладку с preview URL)
6. Скриншот — должен быть «Hello» большими буквами
7. Промпт: "Поменяй цвет на красный"
8. Дождаться второго SSE succeeded
9. Скриншот — теперь красный
10. Click Rebuild button
11. Дождаться SSE
12. Те же визуальные результаты
```

Скриншоты складываются в `verification/screenshots/preview-provider/`
по schemate `<scenario>-<step>.png`.

---

## 5. Что НЕ верифицируется в этой спеке

- Performance под нагрузкой (concurrent users >10) — отдельная
  load-test сессия, post-MVP.
- BaaS-интеграция / functions/ runtime — отдельная сессия.
- A/B test product metrics (success rate generation, time to first
  preview) — продуктовая аналитика, post-MVP.
- Multi-tenancy isolation — нужно если планируется shared instance,
  на MVP single-tenant per builder.

---

_Last updated: 2026-04-28._
