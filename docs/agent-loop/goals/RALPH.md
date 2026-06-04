# Ralph-loop контракт — agent-loop backend (Phase 0→6)

Один автономный ralph-loop вместо 7 ручных `/goal`. Состояние живёт на диске в
[`ralph-state.json`](./ralph-state.json) (ledger), детальные критерии каждой фазы —
в `goal-N-*.md`. Loop читает ledger + нужный goal-файл каждой итерацией, не из контекста.

## Запуск — скопировать и вставить в промпт

```
/ralph-loop Прочитай docs/agent-loop/goals/RALPH.md и выполняй его как контракт, фазы 0-6 спеки agent-loop. Источник правды по прогрессу docs/agent-loop/goals/ralph-state.json: читай в начале каждой итерации, переписывай в конце, состояние в контексте не держи. Каждой итерацией выбирай activePhase по requires-gate из ledger, открывай её goal-N файл за детальными критериями, читай поле lastIterationFailureLog и правь реальные ошибки. Фазы 3 и 5 плюс финал верифицируй через playwright-mcp по docs/agent-loop/goals/MANUAL-VERIFY.md, артефакты клади в verification/agent-loop. Соблюдай LOOP GUARD и EXIT WHEN из RALPH.md. Верь только артефактам, не словам. --max-iterations 40 --completion-promise "RALPH-LOOP COMPLETE per RALPH.md EXIT WHEN phases 0-6 done, npm test and npm run build exit 0, manual-verify pass, ralph-report.md written"
```

- `--max-iterations 40` — hard-ceiling на уровне самого loop (дублирует `loop.maxIterations` в ledger).
- `--completion-promise "…"` — loop выйдет, ТОЛЬКО когда выведешь `<promise>…</promise>` с этой строкой, а это допустимо лишь когда она буквально истинна (= наш EXIT WHEN). Раньше выводить нельзя, даже если кажется «застряли».

> ⚠ **Промпт без shell-метасимволов.** Slash-команда `/ralph-loop` подставляет аргументы в bash и **eval'ит строку целиком**. Поэтому в промпте НЕЛЬЗЯ `( ) | * ! $ < > & ; \`` и непарные кавычки — иначе `syntax error near unexpected token '('`. Вся детализация (со скобками, пайпами, глобами) живёт в RALPH.md/ledger, а промпт — только короткий указатель на них.

Перед запуском проверь permission-allowlist и наличие Docker/браузера (см. секции ниже).

---

```markdown
# RALPH-LOOP CONTRACT — AGENT-LOOP BACKEND

## OBJECTIVE
Имплементировать серверную часть agent-loop из docs/agent-loop/0-agent-loop-backend-core-design.md (спека v2.1), фазы 0–6, итеративно и автономно. Каждая единица работы добивается до одной из 4 корзин; ничего не теряется, ничего не фейкается.

## SOURCE OF TRUTH (на диске, НЕ в контексте)
- Прогресс/корзины/попытки: `docs/agent-loop/goals/ralph-state.json` (ledger). Читать в НАЧАЛЕ итерации, писать в КОНЦЕ.
- Детальные SUCCESS CRITERIA фазы N: `docs/agent-loop/goals/goal-N-*.md` (поле `file` в ledger).
- Протокол ручной верификации (playwright-mcp) для фаз 3/5 и финала: `docs/agent-loop/goals/MANUAL-VERIFY.md`. Артефакты → `verification/agent-loop/`.
- Лог ошибок прошлой итерации: `loop.lastIterationFailureLog` в ledger — следующая итерация бьёт по РЕАЛЬНЫМ ошибкам оттуда, не по гипотезам.

## ВЫБОР РАБОТЫ НА ИТЕРАЦИЮ (фазовый gate)
1. Прочитать ledger. Кандидаты = фазы со `status` != `done`, у которых ВСЕ `requires` уже `done`.
2. Взять кандидата с наименьшим `id` → это `activePhase`. Работать ТОЛЬКО над ним.
3. Phase 0 — особая: её результат — бинарный вердикт. Записать `loop.phase0Verdict` = "GREEN"|"RED". Phase 3 (requires [0,1,2]) реализуется по ветке этого вердикта (см. PRECONDITION в goal-3).
4. Внутри фазы: открыть её goal-файл, прогнать её success-команду, разнести непройденные единицы по корзинам.

## SUCCESS CRITERIA (артефакты, не со слов) — критерий фазы «done»
Фаза N = `done`, когда выполнено ВСЁ из её goal-N-файла:
- её скоуп-тест(ы) `npx vitest run tests/...` → exit 0 (из adorable/);
- `npm run build` → exit 0; регрессия `npm test` → exit 0;
- для фаз с `manualVerify` в ledger (3, 5): прогнан playwright-mcp по docs/agent-loop/goals/MANUAL-VERIFY.md, все MV-сценарии = PASS с артефактами `verification/agent-loop/*.png` + записью в `manual-verify-log.md` (либо external_blocker с причиной, если нет браузера/среды);
- сумма корзин фазы = `unitsTotal`, ни одной единицы вне 4 корзин.
Только командный exit / файл/скриншот на диске / запись в ledger как доказательство. НЕ «я сделал».

## OUTCOME TAXONOMY (на каждую единицу — ровно одна; ledger.units[])
- fixed             — работает, доказано живым прогоном (не стаб, не 200-OK)
- ack_stale         — легитимно нельзя сейчас; с доказательством в коммите
- abandoned         — сознательно вне скоупа; залогировано
- external_blocker  — нет Docker/Testcontainers / Redis/реестр недоступны / баг upstream-пакета
Запрещено: пустой стаб как fixed. Запрещено: единица вне 4 корзин.

## EXIT WHEN
Все фазы 0–6 в ledger имеют `status` = `done` (каждая единица в терминальной корзине; все `fixed` подтверждены exit 0 их команды) AND фазы 3 и 5 имеют `manualVerify` = `pass` (или `external_blocker`) AND финальный E2E playwright-mcp проход «закрыл вкладку — не потерял» = PASS с артефактом AND агрегатно `npm test` exit 0 AND `npm run build` exit 0.
На выходе: записать финальный отчёт в `docs/agent-loop/goals/ralph-report.md` (таблица фаза→корзины, список ack_stale/external_blocker с причинами, ссылки на verification/agent-loop/*.png) и ОСТАНОВИТЬ loop.

## LOOP GUARD
- Hard ceiling: `loop.maxIterations` = 40. Достигнут → стоп + отчёт.
- Retry ceiling: `loop.retryCeilingPerCategory` = 3 попытки на КАТЕГОРИЮ ошибки на единицу. Единица, упёршаяся в потолок, переводится в ack_stale/external_blocker и ИСКЛЮЧАЕТСЯ из будущих итераций — 4-й раз тот же подход не гонять.
- Anti-thrash: итерация без чистого прогресса (нет перехода корзины И нет нового коммита) → `loop.stall`++. При `stall` = `maxStall` (2) → стоп + отчёт.
- В конце КАЖДОЙ итерации: инкремент `loop.iteration`, обновить `phases[].buckets`/`status`, `units[]`, `loop.lastIterationFailureLog`. Коммит на каждый переход корзины с причиной в сообщении.

## HARD CONSTRAINTS
- One repo, one loop: не запускать второй ralph-loop или /goal в этом репо параллельно (интерливятся коммиты, гонка ledger).
- 0 регрессий на уже-зелёных тестах (`npm test` exit 0 на каждой итерации перед записью «done»).
- Phase 7 (polish) — ВНЕ скоупа loop (нет CI-гейта). Не трогать.

## ITERATIVE PASSES
- Каждая итерация = один проход по `activePhase`: читать lastIterationFailureLog → бить по реальным ошибкам → прогнать команду → разнести по корзинам → записать ledger.
- НЕ один большой upfront-анализ: короткие проходы, учащиеся на логе предыдущего.

## DEFINITION OF DONE (что читает Stop hook)
Клир ТОЛЬКО ЕСЛИ: ledger показывает все фазы 0–6 `done` AND `npm test`+`npm run build` exit 0 AND ralph-report.md записан AND ни одной единицы вне таксономии. Иначе — продолжать loop; при достижении любого guard-потолка — честно добить остаток в fail-корзины, записать отчёт, остановиться.
```

---

## Где состояние и как читать

- **Ledger:** `docs/agent-loop/goals/ralph-state.json` — единственный источник правды по прогрессу. Схема в самом файле (`_schema`, `_buckets`). Loop читает его в начале каждой итерации и переписывает в конце.
- **Критерии фаз:** `goal-0-spike.md … goal-6-quota-usage.md` — детальные SUCCESS CRITERIA и ассерты. Loop открывает нужный по полю `phases[].file`.
- **Финальный отчёт:** `docs/agent-loop/goals/ralph-report.md` (создаётся на выходе).

## Loop guard — числа

| Параметр | Значение | Где в ledger |
|---|---|---|
| Hard ceiling итераций | 40 | `loop.maxIterations` |
| Retry на категорию ошибки | 3 | `loop.retryCeilingPerCategory` |
| Stall-стоп | 2 | `loop.maxStall` |
| Фазовый порядок | requires-gate | `phases[].requires` |

## ⚠ Permission allowlist (проверить ДО запуска)

Headless ralph-loop встанет на любом permission-промпте, который не может ответить.
Allowlist должен покрывать команды контракта:

- `Bash(npm test)`, `Bash(npm run build)`, `Bash(npm run db:generate)`
- `Bash(npx vitest run *)`
- `Bash(docker compose config)`, `Bash(docker compose *)` (если поднимаешь Testcontainers/инфру)
- `Bash(git add *)`, `Bash(git commit *)`, `Bash(git checkout *)` (коммит на переход корзины)
- `Bash(grep *)`, `Bash(mkdir *)`, и запись в `docs/agent-loop/goals/*` (ledger/report)
- `Bash(npm run dev:infra:up)`, `Bash(npm run dev:infra:wait)`, запуск `npm run dev`/воркера (для manual-verify)
- playwright-mcp инструменты (`mcp__playwright__*`) + запись в `verification/agent-loop/*` (скриншоты/лог)

Известная острая грань: deny-форма `! "path"` НЕ матчит bare-path allow-паттерны — проверь, что build/test/git реально покрыты, иначе loop стопорится на промпте.

## Docker + браузер — обязательны

- Интеграционные тесты (§12) идут на Testcontainers (Postgres+Redis). Без Docker
  соответствующие единицы уходят в `external_blocker`.
- Manual-verify (фазы 3/5 + финал) требует **playwright-mcp + запущенные app+worker+infra**
  (см. предусловия в MANUAL-VERIFY.md). Без браузера/среды MV-сценарии → `external_blocker`
  с причиной в `manual-verify-log.md`.
Loop не зависнет в любом случае, но без Docker/браузера фазы 3/5 не закроются как `fixed`.
