# Preview Provider — спека миграции

Спека миграции Adorable-форка с Docker-VM-based превью на статические
превью через фиксированный Vite-boilerplate (base44-style).

Сессия проведена 2026-04-27 / 2026-04-28 в формате архитектурного
соавторства. Реализация — отдельная задача, см. `MIGRATION_PATH.md`.

---

## Навигация

### Старт
1. **`ARCHITECTURE.md`** — общая картина: компоненты, потоки, границы.
2. **`DECISIONS.md`** — ADR-журнал (21 решение): что и почему выбрано.

### Контракты и реализация
3. **`CONTRACTS.md`** — точные TypeScript-сигнатуры всех новых типов.
4. **`BUILD_PIPELINE.md`** — поток билда в деталях: docker run, atomic
   swap, cancel, error parser, env-параметры.
5. **`BOILERPLATE.md`** — структура `templates/vite-react/`,
   версионирование, lifecycle migration воркера.
6. **`DEPENDENCIES.md`** — список зависимостей (60+ пакетов из base44),
   синонимы для парсера ошибок, strip-обоснования.

### Безопасность и план
7. **`SECURITY.md`** — модель угроз, что становится проще vs sandbox,
   12 классов атак с митигациями.
8. **`MIGRATION_PATH.md`** — план перехода (7 фаз) с rollback'ами.
9. **`LIMITATIONS.md`** — границы static-режима, user-facing
   сообщения.

### Проверки и нерешённое
10. **`VERIFICATION.md`** — продуктовые сценарии + инфра-проверки +
    метрики Phase 6.
11. **`OPEN_QUESTIONS.md`** — 30+ открытых вопросов с приоритетами.
12. **`ASSUMPTIONS.md`** — defaults и эвристические выборы спек-сессии,
    кандидаты на confirm/новый ADR. **Прочитать перед spec lock'ом**.

### Контекст
- **`CURRENT_STATE.md`** — снимок репо на старте сессии (для
  верификации архитектурных решений против реального кода).
- **`research/example-base44/`** — оригинальный base44-шаблон,
  использован как референс для ADR-019 списка зависимостей.

---

## Ключевые решения одной строкой

| ADR | Что                                                            |
|-----|----------------------------------------------------------------|
| 001 | Build trigger: end-of-turn LLM + manual rebuild                |
| 002 | MVP: только React, без multi-framework                         |
| 003 | LLM toolset: dynamic по capabilities                           |
| 004 | Iframe: last-good + UI overlay, atomic symlink swap            |
| 005 | Build-runner: ephemeral container + RO node_modules volume     |
| 006 | File flow: scratch dir + Map + commit per turn, single-instance |
| 007 | Assets: LLM пишет text+whitelist, UI грузит бинари             |
| 008 | Boilerplate: версионирование + миграционный воркер партиями    |
| 009 | Long sessions: остаёмся на static, build-cache                 |
| 010 | Capability tier: explicit ARCHITECTURE CONSTRAINT в промпте    |
| 011 | Build orchestration: in-memory queue + SSE                     |
| 012 | Concurrency: cancel + replace, max 1 running + 1 queued        |
| 013 | JSX в `src/`, TS в `functions/`                                |
| 014 | Public URL: `PreviewMetadata` с опц. terminalUrls              |
| 015 | Capabilities: hybrid — provider declares, RepoMetadata pins    |
| 016 | Build-cache: подкаталог в scratch dir                          |
| 017 | Метод имени: `PreviewProvider.create()`                        |
| 018 | BuildResult: structured errors + raw stdout/stderr с size cap  |
| 019 | Состав deps: battery-included из base44 без eslint/baseline    |
| 020 | `example/` → `docs/preview-provider/research/example-base44/`  |
| 021 | `functions/` директория: TS, не билдится на MVP, BaaS позже    |

---

## Что дальше

1. **Spec lock** — фриз `docs/preview-provider/*.md` после ревью.
2. **Phase 0** из `MIGRATION_PATH.md` — sanity-snapshot.
3. **Phase 1–6** — реализация с feature flag по плану.
4. **Phase 6 acceptance** — VERIFICATION.md метрики.

Реализация — отдельная сессия. Здесь только спека.

---

_Spec session conducted 2026-04-27 / 2026-04-28._
