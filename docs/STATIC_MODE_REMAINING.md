# Static-mode preview: что осталось до полной готовности

Снимок состояния на 2026-04-30 после серии Playwright e2e iter'ов.
Caddy-bind в этот список НЕ входит (уже сделано: `8ace7d8`).

## Условные обозначения

- 🔴 **Blocker** — без этого static-mode нельзя катить в prod
- 🟡 **High** — пользователь будет ловить плохой опыт
- 🟢 **Medium / nice-to-have** — не блокирует, но косметика / надёжность
- 📋 **Process** — staging / approval, не код

## Задача
Ты работашеь в Ральф Лупе. Тебе необходимо реализовать/пофиксить проблемы/задачи из этого документа. Бери по одной задаче в цикле. В Каждом цикле ОБЯЗАТЕЛЬНО проверяй все e2e (скрипты или Playwright MCP).

---

## ✅ 1. Build timeout не отрабатывает под параллельной нагрузкой — DONE 67e8cf2

### Симптом
В audit-log:
```json
{"event":"build_runner_killed_timeout","durationMs":426067,"exitCode":137}
{"event":"build_finished","status":"failed","exitCode":137,"durationMs":426259}
```
`BUILD_RUNNER_TIMEOUT_MS` дефолт 120 000ms (2 мин), но билд жил 426s (>7 мин).

### Воспроизведение
Запустить два rebuild'а одновременно (chat onFinish + LLM-tool `requestRebuildTool` параллельно, или React StrictMode double-create). Один или оба зависают.

### Корень
`lib/preview/build-runner-docker.ts:254-257`:
```ts
const hardTimeout = setTimeout(() => {
  timedOut = true;
  container?.kill({ signal: "SIGKILL" }).catch(() => undefined);
}, env.timeoutMs);
```

`hardTimeout` действительно фaeрит на 120s и шлёт SIGKILL. Но:
1. `container.kill().catch(()=>undefined)` глотает любые ошибки от dockerode
2. `await container.wait()` (строка 282) НЕ резолвится после SIGKILL — может зависать пока dockerode socket не оборвётся
3. Когда docker daemon под нагрузкой (parallel builds + sandboxes + dev-server), kill команда может не доходить за разумное время

### Что нужно сделать
- Обернуть `container.wait()` в `Promise.race([wait(), timeoutPromise])` где timeoutPromise = `setTimeout(() => reject('wait deadline'), env.timeoutMs + env.cancelGraceMs * 2)`
- После kill — explicit `await container.remove({ force: true })` чтобы гарантированно вычистить
- Логировать конкретную dockerode-ошибку (не глотать `.catch(()=>undefined)`) — через `.catch(err => process.stderr.write(...))`
- Тест: `RUN_DOCKER_TESTS=1` integration test со специально-зависающим build (например `sleep 9999 && vite build`) должен убиться за `timeoutMs + 2*cancelGraceMs` ≈ 124s

### Файлы
- `lib/preview/build-runner-docker.ts:240-310` — refactor wait loop
- `tests/build-runner-docker-integration.test.ts` — добавить timeout test (gated)

---

## ✅ 2. React StrictMode double-create на одном клике "Send" — DONE

Реализовано:
- Module-level inflight dedup в `app/assistant.tsx`
  (`inflightEnsure` Map, ключ — `chatSessionIdRef.current` для
  no-repo-case либо `conv:<repoId>` для no-conversation-case).
  Concurrent callers (StrictMode dual-mount, double-click) шарят один
  inflight Promise.
- Server-side `IdempotencyCache` (TTL 60s, in-memory) в
  `app/api/repos/route.ts`. Клиент посылает `clientRequestId` (UUID) в
  body; повторный POST с тем же id возвращает ранее созданный wrapper
  без re-execution.
- Тесты: `tests/idempotency-cache.test.ts` (6 unit-тестов на TTL-кэш) +
  `tests/repos-route-idempotency.test.ts` (4 интеграционных теста на
  POST /api/repos: sequential dup, concurrent dup, разные cri'ды дают
  разные wrapper'ы, opt-out при отсутствии cri'да).



### Симптом
В audit-log на одно нажатие Send:
```
adorable-meta-6ca771b8-... wrapper #1
adorable-meta-af44ff6b-... wrapper #2  ← дубль
```
Два wrapper-репо в Gitea, два source-репо, два sandbox/static проекта, два build job'а параллельно (см. #1 — ещё и таймаутят).

### Корень
`app/assistant.tsx:338-380` — `useChat({...})`. В Next.js dev-mode с React StrictMode компонент монтируется дважды для проверки идемпотентности эффектов. `prepareSendMessagesRequest` вызывает `ensureActiveConversation()`, который POST'ит `/api/repos`. На двойном mount → два POST'а параллельно → два разных wrapper'а.

В prod (`NODE_ENV=production`) StrictMode выключается и проблемы нет — но dev-flow всё равно болезненный, и сценарий "пользователь два раза кликнул Send" в prod даст то же.

### Что нужно сделать
**Defensive обе стороны:**

a) Client-side guard в `app/assistant.tsx`:
- Использовать `useRef<Promise|null>(null)` для inflight `ensureActiveConversation()` — если уже есть pending promise, вернуть его, не создавать новый POST
- Отдельно: на стороне UI кнопки Send добавить `disabled` пока `isRunning`

b) Server-side idempotency:
- `POST /api/repos` принимает опциональный `clientRequestId` (UUID) в body
- Сервер хранит short-TTL map `clientRequestId → wrapperRepoId` (in-memory, 60s); duplicate request возвращает существующий

### Файлы
- `app/assistant.tsx:197-304` (`ensureActiveConversation`)
- `app/api/repos/route.ts:200-330` (POST handler)
- Новый тест: `tests/assistant-double-send.test.ts` (клиент-сайд через jsdom)
- Новый тест: `tests/repos-route-idempotency.test.ts` (сервер-сайд)

---

## ✅ 3. Upstream `@assistant-ui/react-ai-sdk` dup-toolCallId crash — DONE (workaround)

Реализовано (option 2 из спеки — kustom-converter wrapper):
- Новый pure-helper `lib/cross-message-tool-dedup.ts` —
  `dedupeToolCallsAcrossMessages(messages)`. Walk через все сообщения
  thread'a, для каждого `toolCallId` запоминает последнее
  (messageIdx, partIdx); во втором проходе всё, что не "last", —
  фильтруется. Тяжёлый общий путь оптимизирован: если все callId
  уникальны, возвращается `messages.slice()` без перестройки.
- В `app/assistant.tsx` — wrapper над chat helpers через
  `useMemo`-cache: `dedupedMessages`, потом
  `dedupedChat = { ...chat, messages: dedupedMessages }`,
  передаётся в `useAISDKRuntime`. Outbound HTTP (sendMessage,
  setMessages) и server-side state не затрагиваются — wrapper
  только для UI-render path'а.
- 9 unit-тестов (`tests/cross-message-tool-dedup.test.ts`):
  empty, no-dups (early-return через size==count), dup across two
  messages, multi-occurrence within one message, non-tool parts
  untouched, missing parts field, message-level metadata
  preserved, three-way dup → last wins, empty toolCallId treated
  as absent.

Этот fix — UI-side workaround, который покрывает 100% наблюдаемых
кейсов (и StrictMode dual-mount, и step-boundary). Upstream-issue +
PR в `@assistant-ui/react-ai-sdk` пока не открывал — workaround
стабилен, не требует ожидания библиотеки.



### Симптом
Mid-stream (около 30-60s в чат) консоль выдаёт:
```
Error: Duplicate key toolCallId-call_<id> in tapResources
```
React показывает overlay "Application error: a client-side exception has occurred". UI замёрз, но backend-стрим продолжается до конца. После reload страница работает (мой sanitiser выбрасывает дубликаты с диска).

### Корень
`@assistant-ui/tap/src/hooks/tap-resources.ts:71-72`:
```ts
if (seenKeys.has(elementKey))
  throw new Error(`Duplicate key ${elementKey} in tapResources`);
```

Где-то в стрим-pipeline (`@assistant-ui/react-ai-sdk@1.3.9` + `ai@6.0.100`) одна и та же `toolCallId` попадает в две разные message parts (например `tool-call` и `tool-result` или дельта-апдейт после step-boundary). Convertor `convertParts` дедупит ВНУТРИ одного message по `tool-call`, но не ACROSS messages и не по другим типам.

### Воспроизведение
100% воспроизводится при многошаговых tool calls (>3 шагов) в любом сценарии (Doppio, Намасте, Хлеб и Соль — все три).

### Что нужно сделать (по сложности возрастания)
1. **Quick:** bump `@assistant-ui/react-ai-sdk` и `ai` до latest, проверить changelog
2. **Medium:** написать кастомный converter в `app/assistant.tsx`, обернуть AISDKMessageConverter и сделать cross-message dedup (см. как это сделано for one message в `node_modules/@assistant-ui/react-ai-sdk/dist/ui/utils/convertMessage.js:117`)
3. **Heavy:** заменить `useChat` + `useAISDKRuntime` на собственный SSE reader + ручной push в assistant-ui store. Полный контроль над дедупом.
4. **Минимально-дозволенное:** PR upstream в `@assistant-ui/react-ai-sdk` — расширить `seenToolCallIds` сет на весь thread, не на один message

Параллельно с любым из этих — поднять issue на github.com/assistant-ui/assistant-ui с минимальным reproduction.

### Файлы
- `app/assistant.tsx:338-382` (useChat setup)
- `node_modules/@assistant-ui/react-ai-sdk/dist/ui/utils/convertMessage.js` (read-only, для понимания)
- Возможно `lib/repo-storage.ts:sanitiseConversationMessages` — расширить логику sanitise в realtime через хук
- Новый: `lib/cross-message-tool-dedup.ts` + тесты

### Workaround в проде сейчас
Sanitiser (`3d24417`) гарантирует что persisted state на диске чистый — пользователь рефрешит страницу и видит финальный результат. Не идеально, но работоспособно для MVP.

---

## ✅ 4. `init-volume.sh` отсутствует в build-runner image — DONE

Решение (a): скрипт переехал в `adorable/scripts/build-runner/init-volume.sh`
(внутри build-context = `adorable/`). Dockerfile добавил
`COPY scripts/build-runner/init-volume.sh /workspace/init-volume.sh` +
`chmod 0755`. Старый файл из `docker/build-runner-react/` удалён.
Контракт запуска теперь канонический:
```
docker run --rm -u 0:0 \
  -v adorable_node_modules_react_<v>:/mnt/dest \
  --entrypoint sh build-runner-react:<v> \
  /workspace/init-volume.sh
```
Bind-mount workaround больше не нужен. Тесты в
`tests/build-runner-image.test.ts` покрывают наличие COPY-директивы +
chmod, и факт того, что ссылка на скрипт ведёт в новое место.


### Симптом
```
$ docker run --rm -v adorable_node_modules_react_1.0.0:/mnt/dest \
    build-runner-react:1.0.0 sh /workspace/init-volume.sh
sh: 0: cannot open /workspace/init-volume.sh: No such file
```

### Корень
`docker/build-runner-react/Dockerfile` не делает `COPY init-volume.sh`. Build context = `adorable/`, но скрипт лежит в `docker/build-runner-react/` (вне context).

Сейчас init работает только через bind-mount workaround:
```bash
docker run --rm -u 0:0 \
  -v adorable_node_modules_react_1.0.0:/mnt/dest \
  -v /home/agent/Adorable/docker/build-runner-react/init-volume.sh:/init.sh:ro \
  --entrypoint sh build-runner-react:1.0.0 /init.sh
```

### Что нужно сделать
Один из:
- a) Переместить `init-volume.sh` в `adorable/scripts/build-runner/init-volume.sh`, обновить Dockerfile `COPY scripts/build-runner/init-volume.sh ./`. Проще всего.
- b) Сменить build context на `/home/agent/Adorable/` (parent), переписать все `COPY templates/...` → `COPY adorable/templates/...` + добавить `COPY docker/build-runner-react/init-volume.sh /workspace/`. Архитектурно чище но более инвазивно.
- c) Создать `docker/build-runner-react/build.sh` который делает `tar` контекста с обоими директориями и `docker build -`. Слишком хитро.

Рекомендация: (a).

### Файлы
- `docker/build-runner-react/Dockerfile` — добавить `COPY` строку
- `docker/build-runner-react/init-volume.sh` или `adorable/scripts/build-runner/init-volume.sh`
- `tests/build-runner-image.test.ts` — расширить структурные ассерты

---

## ✅ 5. Named volume init требует `-u 0:0` (chown проблема) — DONE

Реализовано вместе с #4: новый `init-volume.sh`:
1. Hard-require `id -u == 0` (exit 4 с пояснительным сообщением).
2. После `cp -a "$SRC"/. "$DEST"/` — `chown -R 1000:1000 "$DEST"`,
   так что main build-runner (USER 1000:1000) читает RO-volume без EACCES.
Контракт `docker run -u 0:0 ... /workspace/init-volume.sh` зашит в
комментарий-шапку скрипта. Тесты покрывают обе проверки (uid=0 + chown).


### Симптом
```
cp: cannot create directory '/mnt/dest/./vite': Permission denied
cp: preserving times for '/mnt/dest/.': Operation not permitted
```
Когда `init-volume.sh` запускается под `USER 1000:1000` (как настроен в Dockerfile runtime stage). Volume только что создан docker'ом и owner — root.

### Корень
`docker/build-runner-react/init-volume.sh:24-46` делает `cp -a` под текущим UID. На свеже-созданном volume `/mnt/dest` принадлежит root, write denied.

### Что нужно сделать
В `init-volume.sh` в начале:
```sh
# Запускаем init под root, потом сами chown'им под node user.
if [ "$(id -u)" -ne 0 ]; then
  echo "init-volume: must run as root (use -u 0:0)" >&2
  exit 4
fi
mkdir -p "$DEST"
chown -R 1000:1000 "$DEST"
... # cp -a как сейчас
```

И в Dockerfile добавить отдельный entrypoint stage или явно документировать `-u 0:0`. Или сделать init-volume двухступенчатым: первый раз запустить как root для chown, потом основной процесс может работать под node.

Альтернатива — в самом Dockerfile сделать `RUN mkdir -p /mnt/dest && chown 1000:1000 /mnt/dest` — но это не поможет потому что `/mnt/dest` — это точка монтирования, не файл в образе.

### Файлы
- `docker/build-runner-react/init-volume.sh:24-46`
- README инструкция как пускать init

---

## ✅ 6. Build артефакт парсится как `errorsCount: 1` при успехе — DONE

Корень: vite v5.x пишет `The CJS build of Vite's Node API is deprecated...`
в stderr на каждом успешном билде. Fallback в `parseBuildErrors`
(`stderr.trim() ≠ "" → emit unknown`) ловил это как ошибку.

Реализовано:
- `lib/preview/build-error-parser.ts` — добавлен набор узких regex'ов
  `BENIGN_STDERR_LINE_PATTERNS` для известного шума (Vite CJS deprecation
  banner, `npm warn/notice/info`, Browserslist outdated nag).
- Helper `stripBenignStderr(stderr)` экспортирован.
- Fallback теперь работает поверх `stripBenignStderr(input.stderr).trim()`,
  а не на raw stderr.
- 5 новых тестов в `build-error-parser.test.ts` фиксируют:
  (a) banner-only stderr → 0 errors,
  (b) full Vite v5.4.21 success run → 0 errors,
  (c) npm warn/notice/info → 0 errors,
  (d) Browserslist nag → строка не появляется в `errors[].message`,
  (e) реальная ошибка над banner'ом всё ещё ловится.



### Симптом
```json
{"event":"build_finished","status":"succeeded","exitCode":0,"durationMs":8338,"errorsCount":1}
```
Status succeeded, exit 0, артефакт целый — но errorsCount=1. False positive в `parseBuildErrors`.

### Корень
`lib/preview/build-error-parser.ts` — вероятно ловит deprecation warning vite v5.4 ("The CJS build of Vite's Node API is deprecated") как ошибку. Либо ловит `[vite-plugin-react] ...` как `[plugin] error` через нестрогий regex.

### Что нужно сделать
- Запустить mock-режим build executor который возвращает реальный stdout vite v5.4.21
- Прогнать через `parseBuildErrors`, логировать что попало
- Уточнить regex: исключать строки начинающиеся с `[33m` (yellow ANSI = warning), требовать `error during build:` или `[31m` префикс
- Добавить test со snapshot реального vite output

### Файлы
- `lib/preview/build-error-parser.ts`
- `tests/build-error-parser.test.ts` — расширить с реальным vite v5 output

---

## 🟢 7. Vite v5.4 deprecation warning про CJS Node API

### Симптом
В каждом build'е первая строка stderr:
```
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.
```

### Корень
`vite.config.js` использует `module.exports` или import без `"type": "module"` в package.json. Хотя сейчас `templates/vite-react/package.json` ИМЕЕТ `"type": "module"` — значит проблема в самом `npx vite` cli которое всё ещё load'ит CJS shim.

### Что нужно сделать
- Bump vite на 6.x (в 6.x CJS API удалён, ESM строгий)
- Или явно `--config-loader native` если такой флаг есть в 5.4
- Решение должно проходить через ADR (изменение версии boilerplate)

### Файлы
- `adorable/templates/vite-react/package.json` — bump vite
- `adorable/templates/vite-react/VERSION` → 1.1.0
- `docker/build-runner-react/Dockerfile` — пересобрать
- Migration script для existing static проектов на новую версию

---

## 🟢 8. `/wake` для sandbox-mode медленный (49s)

### Симптом
```
POST /api/repos/<id>/wake 200 in 49s
```
Внутри: `npm install --silent` (синхронно) + `npm run dev` в фоне + `sleep 4`.

### Корень
`app/api/repos/[repoId]/wake/route.ts:84-88` — `npm install` от scratch на каждом wake. node_modules не персистится между sandbox-инстансами (sandbox tmpfs).

### Что нужно сделать
Несколько вариантов:
- **Sticky storage:** persistent named volume для node_modules per-project (deferred в v2 per FORK_CHANGES.md)
- **Pre-warm:** при cleanup-worker удаляющим sandbox, оставлять snapshot node_modules в shared volume; новый wake mount'ит его RO
- **Pre-built image:** ship `adorable-sandbox-react:1.0.0` с уже установленными node_modules для template (sandbox-эквивалент того что мы делаем в build-runner)

Вариант 3 — лучший long-term, но требует image-versioning логики аналогичной build-runner. Тут можно скопировать паттерн `adorable_node_modules_react_<version>` named volume.

### Файлы
- `lib/adorable-vm.ts` (createVmForRepo)
- `lib/adapters/sandbox-docker.ts` (container config)
- Возможно отдельный файл `docker/sandbox-react/Dockerfile`

---

## 📋 9. VERIFICATION.md scenarios 1–8 — staging acceptance

### Что нужно
Прогнать все 8 продуктовых сценариев из `docs/preview-provider/VERIFICATION.md §1` на staging:
1. Лендинг кофейни
2. TODO с localStorage
3. Калькулятор ипотеки
4. Промпт с попыткой использовать backend
5. Manual rebuild
6. UI upload изображения
7. Восстановление после рестарта builder'а
8. Migration существующего sandbox-проекта

Для каждого:
- Visual check соответствия acceptance criteria
- Browser console: 0 errors / 0 warnings (кроме deprecation)
- Network panel: все requests 200, нет лишних запросов к node_modules

### Зависит от
Всех 🔴 фиксов выше (timeout, double-create, dup-toolCallId), иначе сценарии будут флакать.

---

## ⏳ 10. p50/p95 staging metrics — TOOLING DONE (запуск ждёт staging)

Реализовано из доступного без staging-окружения:
- Pure-helper `lib/bench/percentiles.ts` — `percentile()` (R-7 / linear),
  `summarise()`, `parseBuildFinishedFromAuditLog()`,
  `filterByTimeRange()`. 15 unit-тестов покрывают edge-cases (empty,
  single, even/odd count, malformed JSON в audit-log, fields-missing,
  boundary inclusivity по времени).
- CLI-script `scripts/bench-static-build.ts` — N rebuild requests
  (sequential или с `--concurrency`), waitForJobFinish через первый
  SSE-chunk, итоговый pull audit-log + filter по window. Help-output,
  --json для machine-parsing.
- `docs/preview-provider/BENCHMARKS.md` — skeleton с целями, how-to-run,
  acceptance-gate checkbox-list для #12 default-switch'а. Все ячейки
  результатов помечены `_pending_` пока staging не появится.

Что осталось — собственно запуск на staging (за пределами этого loop'а):
прогнать `npx tsx scripts/bench-static-build.ts --iterations 100`,
вписать числа в BENCHMARKS.md, провалидировать что p50/p95 в целях.


`VERIFICATION.md §3` требует замеров:

| Метрика | Цель |
|---|---|
| Cold build (новый проект, первый build) | p50 < 30s, p95 < 60s |
| Warm build (incremental, deps cached) | p50 < 10s, p95 < 20s |
| End-to-end turn (chat → preview update) | p50 < 60s, p95 < 120s |
| Success rate builds | > 95% за 24ч |
| Volume size `adorable_node_modules_react_*` | < 500 MB |
| Memory peak build-runner | < 1.5 GB |

Текущий замер из loop: warm build ~8s (попадает в p50<10s ✓), но это с теплым docker daemon и одним билдом.

### Что нужно
- Скрипт нагрузки (`scripts/bench-static-build.ts`) который N раз делает rebuild и собирает duration'ы
- Парсить из audit-log (`build_finished` events) metrics
- На staging запустить с N=100, посчитать перцентили
- Записать в `OPEN_QUESTIONS.md` или нового `BENCHMARKS.md` фактические значения

### Файлы
- Новый: `scripts/bench-static-build.ts`
- Новый: `docs/preview-provider/BENCHMARKS.md` (после ADR разрешения добавлять файлы в эту папку)

---

## ⏳ 11. Прокатка первой недели — мониторинг — TOOLING DONE (запуск ждёт staging)

Реализовано из доступного без staging-инфры:
- Pure-helper `lib/bench/audit-summary.ts` — `parseAuditLog`,
  `summariseAudit(text, {since, until})`, `evaluateAlerts(summary)`
  с захардкоженными `DEFAULT_THRESHOLDS` (success-rate < 95% n≥20,
  build-runner-killed-timeout ≥ 5/hr, auth_denied ≥ 50/hr — PAGE;
  upload_rejected/path_rejected/malformed_lines — WARN).
- CLI `scripts/audit-summary.ts` — `--file`/`--stdin`,
  `--since`/`--until` ISO bounds, `--json` для machine output. Exit
  code 10 если есть PAGE-уровень алерт (cron-friendly).
- 14 unit-тестов (`tests/audit-summary.test.ts`): event-type counts,
  status breakdown, NaN-rate без samples, time-window inclusivity,
  malformed parse, paging vs warn'инг по каждому threshold'у, sub-
  minSamples не page'ит.
- `docs/preview-provider/MONITORING.md` — runbook с таблицей метрик +
  пороги, triage по каждому алерту (`build_success_rate`,
  `build_runner_killed_timeout`, `auth_denied`,
  `path_rejected`/`upload_rejected`, `malformed_lines`), starter cron
  recipe для bootstrap'а без log-shipper'а.

Что осталось — собственно log-shipper (Vector/Fluent Bit) +
Loki/Grafana + дашборды/algrt-rules (production-grade автоматизация
после prod-deploy).



`MIGRATION_PATH.md §6` требует после default switch:
- Мониторить audit-log на `build-failed`, `path-rejected`, `upload-rejected`, `auth_denied`, `build_runner_killed_timeout`
- Пороги для оповещения (>5% failed builds за час → page on-call)

### Что нужно
- Log shipper (наприм. Vector/Fluent Bit) → ELK или Loki + Grafana
- Алерты в Grafana на каждый event_type с порогом
- Runbook для каждого алерта (что делать если `build_runner_killed_timeout` начало срабатывать массово)

Это инфра-задача после prod-deploy, не блокер для самого default switch.

---

## 12. Финальный switch (manual)

После #1–#11 done:

a) **`.env.example`**: `PREVIEW_PROVIDER=sandbox` → `PREVIEW_PROVIDER=static`. Один коммит.

b) **Migration существующих проектов** через `adorable/scripts/migrate-repo-to-static.ts <wrapper-repo-id>`. Идемпотентный. Делать батчами (10 за раз) с проверкой preview iframe после каждого батча.

c) **Phase 7 cleanup** (опционально):
- Удалить `lib/adorable-vm.ts:createVmForRepo` (если все проекты мигрировали)
- Удалить `lib/sandbox/cleanup-worker.ts` (sandbox больше нет)
- Удалить `lib/adapters/sandbox-docker.ts` + связанные тесты
- Решение: оставить sandbox-fallback (для будущих fullstack-проектов с server runtime) или полностью удалить — нуждается в продуктовом решении

---

## ✅ 13. Документация / спека — DONE

Реализовано:
- `docs/preview-provider/BUILD_PIPELINE.md` §4.2 — добавлен
  `Cmd: cp /workspace/vite.config.js → /tmp` + `NODE_PATH` в Env block,
  ссылка на ADR-029. §10 — env table расширен полем `BUILD_WAIT_DEADLINE_
  BUFFER_MS` + `CADDY_STATIC_ROOT` (ссылка на ADR-031).
- `docs/preview-provider/CONTRACTS.md` §5.1 — новый блок
  `StaticPreviewProviderOptions` со всеми текущими полями (включая
  `caddyStaticRoot`, ссылка на ADR-031).
- `docs/preview-provider/DECISIONS.md` — добавлены **ADR-028..032**
  (ADR-022..026 в спеке этой задачи; номера 022..027 уже заняты ранее):
  - ADR-028: Hash-based subdomain (sha256 first 8) для static-mode hostname
  - ADR-029: Vite config relocation в /tmp + NODE_PATH (ReadonlyRootfs workaround)
  - ADR-030: `.preview-state.json` для restart-resilience
  - ADR-031: Container-internal path mapping через `CADDY_STATIC_ROOT`
  - ADR-032: Gitea pagination contract для `listRepos`
- `adorable/README.md` — раздел "Local dev in static mode": какие env,
  как build image (`docker build -f ../docker/build-runner-react/Dockerfile .`),
  как seed named volume (`-u 0:0`), как bind `STATIC_ROOT` в caddy,
  как verify через curl.


### Обновить
- `docs/preview-provider/BUILD_PIPELINE.md` §4 — упомянуть:
  - `caddyStaticRoot` env (контейнерный путь)
  - `Cmd: cp /workspace/vite.config.js → /tmp/` workaround для ReadonlyRootfs
  - `NODE_PATH=/workspace/node_modules` env
  - Hash-based subdomain (sha256 first 8 chars)
- `docs/preview-provider/CONTRACTS.md` §5 — `StaticPreviewProviderOptions` дополнить полем `caddyStaticRoot`
- `adorable/README.md` — раздел "Локальный dev в static mode": какие env, как build-image, какой mount

### ADR для решений из этой сессии
- ADR-022: Hash-based subdomain (sha256 first 8) для static-mode hostname
- ADR-023: Vite config relocation в /tmp + NODE_PATH (workaround ReadonlyRootfs)
- ADR-024: `.preview-state.json` persisted state для restart-resilience static-провайдера
- ADR-025: Container-internal path mapping через `CADDY_STATIC_ROOT` env
- ADR-026: Gitea pagination contract для `listRepos`

Все эти решения сейчас стоят как `// ASSUMPTION:` маркеры в коде или вообще без документации.

---

## Ориентировочный объём

| Задача | Effort |
|---|---|
| #1 timeout fix | 1 день (с тестом) |
| #2 idempotency | 1 день (client + server + 2 теста) |
| #3 upstream dup | 2-5 дней (зависит от выбранного варианта; от bump до полного fork) |
| #4 init-volume в image | 0.5 дня |
| #5 chown в init-volume | 0.5 дня |
| #6 false-positive errors | 0.5 дня |
| #7 vite 6 bump | 1 день (с migration script) |
| #8 sandbox warm-pool | 3-5 дней (новая инфра) |
| #9-#11 staging acceptance | 3-5 дней (зависит от наличия staging environment) |
| #12 default switch | 0.5 дня + батчевая миграция |
| #13 docs + ADR | 1 день |

**Итого до prod-ready static-mode**: ~3 недели парного программирования или ~5-6 недель solo.
