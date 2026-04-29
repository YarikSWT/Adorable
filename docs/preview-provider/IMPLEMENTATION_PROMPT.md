# IMPLEMENTATION_PROMPT.md — Ralph Loop prompt для реализации спеки

Этот файл — **сам промпт**, передаваемый в Ralph Loop через
плагин `ralph-loop:ralph-loop` (slash-команда `/ralph-loop`).
Содержимое блока «Промпт для Ralph Loop» ниже передаётся как
аргумент команды. Промпт самодостаточен: каждая итерация получает
его **целиком и без изменений**, ориентируется по прогрессу через
`IMPLEMENTATION_LOG.md` и продолжает с того места, где предыдущий
итер остановился.

**Принцип Ralph Loop'а**: один и тот же prompt передаётся Claude
многократно. Self-reference достигается **через файлы и git
history**, а не через feedback output → input. Каждая итерация
видит свою прошлую работу в `IMPLEMENTATION_LOG.md` и в коммитах.

Source: <https://ghuntley.com/ralph/>, плагин ralph-loop в Claude Code.

---

## Запуск

### Pre-flight (один раз перед запуском)
1. Прочитать `docs/preview-provider/ASSUMPTIONS.md` — все 🔴 HIGH-
   пункты (H1–H6) уже резолюнуты в ADR-022…ADR-027 (раунд 7,
   2026-04-29). Если хочешь пересмотреть — сделай это **до** старта.
2. Spec-lock: после ревью никаких silent правок
   `docs/preview-provider/`, только через явный ADR с bump'ом.
3. `docs/preview-provider/IMPLEMENTATION_LOG.md` уже создан (пустой
   с описанием формата). Loop сам начнёт писать.
4. Убедиться что текущие тесты зелёные: `cd adorable && pnpm test`.
5. Зафиксировать sanity-snapshot — Playwright MCP прогон
   `tests/landing-flow-e2e.test.ts`-сценария. Скриншоты в
   `verification/screenshots/pre-migration/`.

### Команда запуска

В Claude Code, в директории `/home/agent/Adorable/`:

```
/ralph-loop "<тело промпта из секции ниже>" --max-iterations 120 --completion-promise "SPEC IMPLEMENTATION COMPLETE"
```

Где:
- `--max-iterations 120` — fail-safe лимит. Если за 120 итер не
  достиг Phase 6 — что-то систематически не так, loop остановится
  автоматически.
- `--completion-promise "SPEC IMPLEMENTATION COMPLETE"` — фраза,
  при выводе которой через `<promise>` тег loop корректно
  завершится. См. §«Когда останавливаться» в промпте.

### Отмена loop'а

В любой момент:
```
/cancel-ralph
```

Удалит state-файл `.claude/.ralph-loop.local.md` и остановит цикл.
Текущий итер закончит свою работу до конца.

---

## Промпт для Ralph Loop

Содержимое внутри ``` ``` ниже передаётся как **аргумент команды
`/ralph-loop`**. Каждая итерация получает его целиком без изменений
— self-reference достигается через `IMPLEMENTATION_LOG.md` и git
коммиты, не через diff промпта.

```
Ты реализуешь спеку из `docs/preview-provider/`. Целевая
архитектура — миграция Adorable-форка на static preview через
PreviewProvider адаптер. Sandbox-режим остаётся работоспособным
fallback'ом на каждой итерации.

=== Источники правды (НЕ ПРАВИТЬ во время реализации) ===

- `docs/preview-provider/MIGRATION_PATH.md` — план из 7 фаз, твой
  главный roadmap. Идём строго по фазам, внутри фазы можно
  параллелить чек-листные пункты.
- `docs/preview-provider/CONTRACTS.md` — точные TS-сигнатуры. Не
  отклоняйся от них без явного ADR.
- `docs/preview-provider/BUILD_PIPELINE.md` — операционные детали:
  docker run flags, atomic swap, cancel flow, env-параметры.
- `docs/preview-provider/SECURITY.md` — модель угроз; все митигации
  обязательны.
- `docs/preview-provider/DECISIONS.md` — ADR-журнал, контекст
  каждого решения.
- `docs/preview-provider/ASSUMPTIONS.md` — defaults сессии. Если в
  пре-flight ответы зафиксированы — спека уже отражает финальное
  состояние; этот файл только для справки «почему так».
- `docs/preview-provider/VERIFICATION.md` — acceptance criteria.
  Завершение Phase 6 = весь список зелёный.

Если спека неполная или противоречивая — **не правь её**. Запиши
вопрос в `docs/preview-provider/OPEN_QUESTIONS.md` (новый пункт с
датой) и попроси у пользователя ADR. До его получения — выбери
наиболее консервативный вариант, явно отметь как `// ASSUMPTION:
falling back to X (ADR pending)` в коде.

=== Прогресс-трекинг ===

Файл `docs/preview-provider/IMPLEMENTATION_LOG.md` — журнал
итераций. Формат строки:

  [YYYY-MM-DD HH:MM] phase=<P> task=<id> status=<done|in-progress|blocked> commit=<sha?> note=<short>

Каждый итер:
1. **Прочитай весь `IMPLEMENTATION_LOG.md`** — определи где
   остановились.
2. Найди следующий невыполненный пункт чек-листа в
   `MIGRATION_PATH.md` (Phase by Phase).
3. **Один итер = один атомарный логический шаг**. Размер шага —
   от одного нового файла до одной новой функции. Не пытайся
   охватить весь Phase в один итер.
4. Реализуй шаг, напиши тесты, прогон `pnpm test` в `adorable/`.
5. Если тесты зелёные — сделай commit с понятным сообщением. Если
   красные — фиксь до зелени, не оставляй сломанные тесты.
6. Допиши строчку в `IMPLEMENTATION_LOG.md`. Commit её отдельным
   коммитом (или вместе с кодом).

=== Правила реализации ===

ОБЯЗАТЕЛЬНО:
- Sandbox-режим остаётся работоспособным на каждом коммите. Не
  удаляй sandbox-код «на потом» — это Phase 7, не сейчас.
- Default `PREVIEW_PROVIDER=sandbox` до Phase 6 acceptance.
- Каждый новый файл сопровождается тестом. Контракт-тесты для
  адаптеров, integration-тесты для docker-flow (gated `RUN_DOCKER_TESTS=1`),
  unit-тесты для парсеров и pure-функций.
- Используй существующие паттерны: HMR-safe singleton (`globalThis.__ADORABLE_*__`),
  audit-log (`lib/sandbox/audit-log.ts`), env-resolved factory с lazy
  import (см. `lib/adapters/sandbox.ts` как образец).
- Stop-on-broken-test: если красный тест существовал до твоего
  итера — пометь как pre-existing в IMPLEMENTATION_LOG, не лечи его
  «попутно».
- Никаких mock'ов в production-коде. Mock — отдельный файл
  `*-mock.ts` для тестов.

ЗАПРЕЩЕНО:
- Править `docs/preview-provider/*.md` (кроме `IMPLEMENTATION_LOG.md`
  и `OPEN_QUESTIONS.md`).
- Удалять / переименовывать существующие файлы в `lib/adapters/`
  пока не пройдена соответствующая фаза.
- Push в main / переключать default `PREVIEW_PROVIDER` без явного
  acceptance Phase 6 от пользователя.
- `git commit --no-verify`, `git push --force` (даже на ветке).
- Запускать `pnpm install` для добавления npm-зависимостей в
  `adorable/package.json` без явного ADR. Зависимости Adorable-
  билдера фиксированы; новые требуют решения.

=== Фазы (см. MIGRATION_PATH.md детали) ===

**Phase 0** — подготовка: VERSION, AVAILABLE_DEPS placeholder, env'ы.
Sandbox-snapshot.

**Phase 1** — типы + factory + mock + sandbox-wrapper. Никакой
business-логики, только адаптерный костяк. Контракт-тесты.

**Phase 2** — Dockerfile build-runner'а, обновлённый
templates/vite-react/, ProjectFs impl, preview-static импл (синхронный
билд), parser, расширение proxy-caddy на file_server. Integration-
тесты с Docker.

**Phase 3** — BuildQueue (max 1+1, cancel+replace), SSE endpoint,
upload endpoint, manual rebuild endpoint. Cancel-flow integration
test.

**Phase 4** — wire-up в `chat/route.ts`, `repos/route.ts`,
`create-tools.ts`, `system-prompt.ts`. Capability-driven
ветвление. End-to-end тест за feature flag.

**Phase 5** — migration script для существующих RepoMetadata. Идемпотентный.

**Phase 6** — VERIFICATION.md полный прогон. Метрики p50/p95.
Default switch — отдельный коммит с явной apoval'ом пользователя.
Не делай его автоматически в loop'е.

**Phase 7** — cleanup. Только после явного approval'а.

=== Когда останавливаться (completion-promise механизм) ===

Loop остановится автоматически когда ты выведешь:

  <promise>SPEC IMPLEMENTATION COMPLETE</promise>

Эту фразу выводи **только** когда:
- Все 7 фаз из `MIGRATION_PATH.md` отмечены `done` в
  `IMPLEMENTATION_LOG.md` (либо Phase 7 явно skip'нут пользователем).
- VERIFICATION.md acceptance — все 8 продуктовых сценариев и 10
  инфра-проверок зелёные.
- Метрики Phase 6 (p50/p95 build time, success rate, etc) на staging
  достигнуты (см. VERIFICATION.md §3).
- `cd adorable && pnpm test` — зелёное.

Если упёрлись в blocker до Phase 6 — **не выводи** completion
promise. Вместо этого:

1. Запиши `status=blocked` в `IMPLEMENTATION_LOG.md` с описанием
   причины.
2. Если blocker — HIGH-impact ADR-вопрос: запиши в
   `OPEN_QUESTIONS.md` новый пункт с датой, попроси у пользователя
   ADR. Следующий итер увидит запись и продолжит ждать.
3. Если blocker — красные тесты после ≥3 попыток фикса: запиши
   `status=blocked`, не пытайся дальше. Следующий итер прочитает,
   попробует другой angle.
4. Если blocker — недоступная инфра (docker/gitea): запиши blocked,
   перейди на не-инфра задачу следующей фазы.

Loop сам остановится через `--max-iterations 120` если завис без
прогресса. Это fail-safe.

**Default switch (`PREVIEW_PROVIDER=static`) НЕ делается loop'ом
автоматически** даже после Phase 6 acceptance. Это manual решение
пользователя; loop останавливает работу с promise, дальше — он сам.

=== Что делать на каждом итере (краткий чек-лист) ===

1. `cat docs/preview-provider/IMPLEMENTATION_LOG.md` — где мы.
2. Найди следующий task из `MIGRATION_PATH.md`.
3. Прочитай связанный раздел `CONTRACTS.md` и `BUILD_PIPELINE.md`.
4. Реализуй один шаг.
5. Напиши/обнови тесты.
6. `cd adorable && pnpm test` — должны быть зелёные.
7. Если работа касается Docker/Caddy/Gitea — `pnpm test` с
   соответствующими `RUN_*=1` env'ами.
8. `git status`, `git diff` — посмотри что изменилось.
9. `git add` нужные файлы (не `git add -A`), `git commit` с
   conventional message: `phase-<N>: <task summary>`.
10. Допиши строчку в `IMPLEMENTATION_LOG.md`, commit отдельно
    (или в том же коммите).
11. Конец итера — следующий итер начнёт с шага 1.

=== Стиль коммитов ===

```
phase-<N>: <imperative summary>

<optional body — почему, какие тесты добавлены>

Co-Authored-By: Ralph Loop <noreply@adorable>
```

Примеры:
- `phase-1: add PreviewProvider interface and mock impl`
- `phase-2: implement build-runner Dockerfile + init-volume script`
- `phase-3: BuildQueue with cancel+replace semantics`
- `phase-4: wire chat/route.ts onFinish to buildQueue.enqueue`

=== Если что-то сломалось ===

- **Sandbox e2e красный**: regression. Откатывай свой коммит
  (`git revert HEAD`), чини отдельно, потом продолжай.
- **Docker daemon недоступен**: запиши в `IMPLEMENTATION_LOG`
  как `blocked`, перейди на не-Docker задачу следующей фазы (если
  есть). Не симулируй интеграцию через mock — это вранье.
- **Gitea токен истёк**: `pnpm dev:infra:up`, перерегистрируй
  через `scripts/init-gitea.sh`, обнови `.env`.

=== Completion ===

Когда ВСЕ ниже выполнено:
- Все 7 фаз из MIGRATION_PATH.md помечены `done` в IMPLEMENTATION_LOG.md
  (Phase 7 cleanup может быть skip'нут с пометкой `corrected: phase
  скипнут по решению пользователя`).
- Все 8 продуктовых сценариев и 10 инфра-проверок из VERIFICATION.md
  зелёные.
- Метрики Phase 6 (p50/p95 build time, success rate) достигнуты на
  staging.
- `cd adorable && pnpm test` — зелёное.

Тогда выведи (и только тогда):

  <promise>SPEC IMPLEMENTATION COMPLETE</promise>

Это сигнал loop'у на завершение. Не выводи эту фразу раньше.

=== Готов? Старт. ===

Прочитай `IMPLEMENTATION_LOG.md`, определи следующий шаг, выполни
один атомарный инкремент, протестируй, закоммить, обнови лог.
Один итер — одна работоспособная единица.
```

---

## Формат `IMPLEMENTATION_LOG.md`

Создаётся пустым перед запуском loop'а. Каждый итер дописывает 1
строку в конец. Пример:

```
[2026-04-29 18:32] phase=0 task=create-VERSION-file status=done commit=a1b2c3d note=initial 1.0.0
[2026-04-29 18:38] phase=0 task=add-env-defaults status=done commit=e4f5g6h note=.env.example updated, no behavior change
[2026-04-29 18:44] phase=1 task=preview-interface-types status=done commit=i7j8k9l note=lib/adapters/preview.ts + capabilities consts
[2026-04-29 18:52] phase=1 task=preview-mock-impl status=done commit=m0n1o2p note=tests/preview-contract.test.ts: 12/12 green
[2026-04-29 19:02] phase=2 task=build-runner-Dockerfile status=blocked commit=- note=docker daemon refused; need pnpm-lock review
```

Строки append-only. Никогда не редактируй прошлые строки. Если
ошибся — добавь corrective строчку с тем же task'ом и `status=corrected`.

---

## Полная команда для запуска

В Claude Code, в директории `/home/agent/Adorable/`:

### Шаг 1 — извлечь промпт в файл (один раз)

Запускается через обычный bash (не slash-command), потому что
slash-команда может не уметь делать сложную shell-substitution с
sed:

```bash
sed -n '/^=== Источники правды/,/^Один итер — одна работоспособная единица.$/p' docs/preview-provider/IMPLEMENTATION_PROMPT.md > .ralph-prompt.txt
```

Проверь: `wc -l .ralph-prompt.txt` должно быть ≥200 строк. Файл
`.ralph-prompt.txt` уже добавлен в `.gitignore` (см. ниже).

### Шаг 2 — запустить ralph-loop

```
/ralph-loop "$(cat .ralph-prompt.txt)" --max-iterations 120 --completion-promise "SPEC IMPLEMENTATION COMPLETE"
```

Внимание:
- `"$(cat .ralph-prompt.txt)"` — в двойных кавычках, шелл-подстановка
  передаёт всё содержимое файла как ОДИН аргумент.
- `--completion-promise "SPEC IMPLEMENTATION COMPLETE"` — фраза с
  одиночными пробелами; следи чтобы не было двойных пробелов.
- `--max-iterations 120` — fail-safe лимит.

### Альтернатива — inline-промпт

Если содержимое `.ralph-prompt.txt` поместится в одну командную
строку и IDE поддерживает многострочный paste:

```
/ralph-loop "<вставить содержимое .ralph-prompt.txt>" --max-iterations 120 --completion-promise "SPEC IMPLEMENTATION COMPLETE"
```

Но через файл — надёжнее (длинный промпт не упадёт по argv-лимиту).

### Что НЕ работает

- **Inline `sed` в slash-команде**: `/ralph-loop "$(sed -n '...'docs/...md)" ...`
  — сложная substitution может пропустить пробел / экранирование.
  Сначала **отдельно** запустить sed через bash в `.ralph-prompt.txt`,
  потом `cat` в slash-команде. Простая `cat`-substitution срабатывает
  стабильно.

---

## Что делать если loop остановился

Loop останавливается в трёх случаях:

1. **Auto-stop по completion promise** (`<promise>SPEC IMPLEMENTATION COMPLETE</promise>`)
   — штатное завершение. Phase 6 acceptance пройден. Дальше ручной
   `PREVIEW_PROVIDER=static` switch с product-go-live.

2. **Auto-stop по `--max-iterations 120`** — fail-safe. Loop
   зашёл в тупик. Открой `IMPLEMENTATION_LOG.md`, посмотри последние
   `blocked` записи, пойми где встрял. Перезапуск — та же команда
   `/ralph-loop ...`, loop подхватит с последней строки лога.

3. **Manual `/cancel-ralph`** — пользователь остановил.

Перезапуск (после ручного фикса blocker'а):

```
/ralph-loop "<тот же промпт>" --max-iterations 120 --completion-promise "SPEC IMPLEMENTATION COMPLETE"
```

`--max-iterations` сбрасывается к новому 120, счётчик начинается
заново. Loop читает `IMPLEMENTATION_LOG.md` и продолжает с
последней записи.

---

_Last updated: 2026-04-29._
