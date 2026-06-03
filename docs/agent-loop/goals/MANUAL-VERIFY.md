# Ручная верификация через playwright-mcp

Backend-тесты (vitest/Testcontainers, mock-LLM) НЕ покрывают живой UX-контур. Этот слой
гоняет реальный браузер (playwright-mcp) против запущенного приложения и фиксирует
**артефакты** (скриншоты + network-лог + verify-лог), а не «я проверил».

Гейтит **Phase 3** (bridge/resumable/reconnect) и **Phase 5** (stop/cancel), плюс финальный
E2E-проход перед EXIT. Это ДОПОЛНЕНИЕ к backend-тестам фазы, не замена.

## Предусловия (поднять перед прогоном)

1. `npm run dev:infra:up` → дождаться healthy (`npm run dev:infra:wait`). Должны быть Postgres + Redis (после Phase 1) + Gitea.
2. Воркер + reaper запущены (dev-процесс воркера; в проде — контейнеры из §5.1).
3. `npm run dev` → Next на http://localhost:3000 (или порт из лога).
4. Тестовый юзер залогинен (better-auth, email verified) — иначе /api/chat вернёт 401/403.

Если что-то из этого недоступно в среде → соответствующие сценарии в `external_blocker`,
loop не виснет.

## Артефакты (источник правды верификации)

- Скриншоты: `verification/agent-loop/<scenario-id>.png`
- Network-доказательства + DOM-снимки: `verification/agent-loop/manual-verify-log.md` —
  на каждый сценарий: PASS/FAIL + что наблюдалось (тип ответа POST, инкрементальные чанки,
  статус run, и т.д.).
- Stop hook читает ЭТИ файлы, не слова агента.

## Инструменты playwright-mcp (типовая последовательность)

`browser_navigate` → `browser_snapshot` (DOM/accessibility) → `browser_type`/`browser_click`
(драйв UI) → `browser_wait_for` (дождаться текста/состояния) → `browser_network_requests`
(проверить, что POST /api/chat вернул СТРИМ, не JSON) → `browser_take_screenshot`
(сохранить артефакт) → `browser_tabs` (мульти-подписчик) → `browser_console_messages`
(ошибки клиента).

---

## Чеклист Phase 3 (bridge + resumable + reconnect)

| ID | Сценарий | Как проверить (playwright-mcp) | Артефакт-доказательство |
|---|---|---|---|
| MV-3.1 | Live первый ход из POST | Открыть чат, отправить промпт, `browser_wait_for` на инкрементальное появление текста/tool-parts. `browser_network_requests`: ответ POST /api/chat имеет stream-заголовки (UI_MESSAGE_STREAM_HEADERS), Content-Type НЕ application/json | network-запись + скрин стрима в процессе |
| MV-3.2 | Закрыл вкладку → reconnect | Запустить run; в середине закрыть/перезагрузить вкладку (`browser_navigate` away→back, или `browser_tabs` close); снова открыть переписку → run резюмится через GET /:id/stream, финальный транскрипт с tool-parts отрисован | скрин полного транскрипта + network GET stream |
| MV-3.3 | Несколько подписчиков | `browser_tabs` открыть ту же переписку во 2-й вкладке во время live-run → обе показывают стрим | скрин обеих вкладок |
| MV-3.4 | Завершённый → из Postgres | После completed перезагрузить → история из messages, resume-GET → 204 (нет активного стрима) | скрин + network 204 |

## Чеклист Phase 5 (stop + cancel)

| ID | Сценарий | Как проверить | Артефакт-доказательство |
|---|---|---|---|
| MV-5.1 | Stop в середине | Запустить run, нажать кнопку Stop → стрим останавливается ≤5с, частичный assistant-ответ остаётся виден, run → cancelled | скрин + network POST /stop |
| MV-5.2 | Навигация ≠ stop | В середине run уйти на др. страницу и вернуться (`browser_navigate`) → run НЕ cancelled, стрим резюмируется | скрин продолжения/резюма |
| MV-5.3 | Re-enqueue после cancel | После stop сразу отправить новое сообщение → новый run стартует (проект не залочен) | скрин нового стрима |

## Финальный E2E-проход (перед EXIT)

«Закрыл вкладку — не потерял» сквозняком: POST → подключиться → оборвать → дождаться
завершения воркера → перезагрузить → транскрипт целостный с tool-parts, код в git, usage
записан. Скрин + запись в manual-verify-log.md.

---

## Definition of done (манульный слой)

Слой считается пройденным ТОЛЬКО ЕСЛИ для каждого сценария в `manual-verify-log.md` стоит
PASS с конкретным наблюдением И существует соответствующий `verification/agent-loop/*.png`.
Сценарий без браузера/среды → `external_blocker` с причиной в логе (не молчаливый скип,
не фейк-PASS).
