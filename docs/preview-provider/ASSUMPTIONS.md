# ASSUMPTIONS.md — что я решил без твоего явного подтверждения

В ходе спек-сессии я делал defaults и эвристические выборы, которые
ты не подтверждал явно. Этот документ сводит их в одно место для
ревью. Каждый пункт — кандидат либо на confirm («да, оставить»),
либо на новый ADR с твоим решением, либо на правку.

Группировка по уровню риска:
- 🔴 **HIGH** — если решение неверное, придётся перепроектировать.
- 🟡 **MEDIUM** — настраиваемо параметром / поправимо без редизайна.
- 🟢 **LOW** — косметика / именование / форматирование.

Source: проверка против всех документов спек-сессии.

---

## ✅ Резолюция HIGH-вопросов (раунд 7, 2026-04-29)

| Вопрос | Решение | ADR |
|--------|---------|-----|
| H1 | Идемпотентен — повторный `create({repoId})` возвращает existing | ADR-022 |
| H2 | Preheat build + `seed/` placeholder под `current` | ADR-023 |
| H3 | Разрешаем `*.ts/*.tsx` в `src/` — Vite сам процессит | ADR-024 |
| H4 | Promote-flow нужен — `published` симлинк + второй URL | ADR-025 |
| H5 | Честный gate в system-prompt'е | ADR-026 |
| H6 | Wording placeholder OK на MVP, A/B тесты после | ADR-027 |

Все 🔴 HIGH вопросы закрыты. Можно переходить к Phase 0 spec lock'у
и запуску Ralph Loop'а.

---

## 🔴 HIGH-impact допущения (закрытые, для истории)

### H1. `PreviewProvider.create()` идемпотентен по `repoId`
**Где**: CONTRACTS.md §5, ARCHITECTURE.md §4.
**Что я допустил**: повторный вызов `create({repoId})` с тем же
ID **не** создаёт дубликат, а возвращает существующее
`PreviewMetadata`. Это влияет на UX и обработку crash recovery.
**Альтернатива**: throw'ить ошибку «already exists», заставлять
caller'а сначала проверять или вызывать `ref()`.
**Confirm нужен**: да или нет.

### H2. Initial build preheat при `create()`
**Где**: ARCHITECTURE.md §4 (Phase create flow), MIGRATION_PATH.md.
**Что я допустил**: при создании проекта сразу `buildQueue.enqueue()`
с `reason: "initial"` — пользователь моментально видит preview без
ожидания первого LLM-turn'а.
**Альтернатива**: первый билд только после первого LLM-turn'а; до
этого Caddy отдаёт пустой template index.html через `current` симлинк
(который указывает на template-as-is).
**Confirm нужен**: текущий вариант повышает sequencing-сложность
(scratch создан, билд запущен, до завершения нет artifact, что
показывает Caddy?). Возможно проще: симлинк `current` создаётся
сразу, указывает на minimum static (`templates/vite-react/public/` +
prebuilt index.html в build-runner image), первый build нужен только
когда LLM что-то напишет.

### H3. Whitelist `src/**` запрещает `*.ts/*.tsx`
**Где**: ADR-007 (раунд 6), CONTRACTS.md §9.
**Что я допустил**: ADR-013 → JSX-only в `src/` → пишем regexp
который **отвергает** `.ts/.tsx`. Если LLM попытается — `path-not-writable`.
**Альтернатива**: разрешить `.ts/.tsx` в `src/`, но при билде они
будут процессированы как JS через Vite (Vite это умеет даже без
TS-конфига).
**Риск текущего**: LLM натренирован на TS — может постоянно создавать
`Foo.tsx`, получать reject, тратить токены на retry. UX страдает.
**Confirm нужен**: жёсткий reject или silent transcode `.tsx` → `.jsx`?

### H4. Single static-роут на проект (без production / staging)
**Где**: ARCHITECTURE.md §3.5, ADR-014.
**Что я допустил**: один URL `<projectId>.preview.<base>` показывает
последний successful build. Никакого «production» URL отдельно от
«preview».
**Альтернатива**: два URL — `preview-<id>.<base>` (последний билд)
и `<id>.<base>` (после явного «promote» / «publish»). Существующий
форк имеет `app/api/repos/[repoId]/promote/route.ts` — этот API
существует.
**Confirm нужен**: убираем promote-flow совсем для static, или
сохраняем (тогда два артефакта — `current` и `published` симлинки)?

### H5. Functions хранятся в Gitea но не запускаются
**Где**: ADR-021.
**Что я допустил**: на MVP пользователь может писать `functions/foo.ts`,
файл коммитится в Gitea, но **никакой UX-индикации** что «функция
не работает». Ожидание: BaaS-интеграция в будущем.
**Альтернатива**: явный gate — если LLM пытается создать
`functions/`-файл, system-prompt отговаривает («это не работает на
MVP, скажите пользователю чтобы дождался»). Менее flexible но
честнее по UX.
**Confirm нужен**: честный gate в system-prompt или silent allow с
дальнейшей активацией?

### H6. ARCHITECTURE CONSTRAINT exact wording
**Где**: ADR-010, CONTRACTS.md §14.
**Что я допустил**: текст блока в system-prompt. Это
непосредственно определяет качество LLM-генерации (она читает этот
блок при каждом турне).
**Альтернатива**: иное wording, иной порядок секций, иной набор
NOT AVAILABLE / use cases.
**Confirm нужен**: финальный текст требует A/B-теста на реальных
промптах. На сейчас — рабочий placeholder, требует tuning.

---

## 🟡 MEDIUM-impact допущения

### M1. Default'ы env-переменных
**Где**: BUILD_PIPELINE.md §10.

| Env                          | Default я выбрал | Альтернативы            |
|------------------------------|------------------|--------------------------|
| `BUILD_RUNNER_MEMORY`        | 2 GiB            | 1 / 4 GiB                |
| `BUILD_RUNNER_CPUS`          | 2                | 1 / 4                    |
| `BUILD_RUNNER_PIDS`          | 512              | 256 / 1024               |
| `BUILD_RUNNER_TIMEOUT_MS`    | 120000 (2 мин)   | 60000 / 300000           |
| `BUILD_CANCEL_GRACE_MS`      | 2000             | 1000 / 5000              |
| `BUILD_LOG_MAX_BYTES`        | 16384 (16 KB)    | 8192 / 32768             |
| `BUILD_HISTORY_LIMIT`        | 5                | 3 / 10                   |
| `SCRATCH_DIR_TTL_DAYS`       | 30               | 7 / 60 / 90              |
| `STATIC_DIR_TTL_DAYS`        | 90               | 30 / 180 / unbounded     |

**Confirm нужен**: окей-default'ы или пересмотреть.

### M2. `BuildOptions.reason` enum-значения
**Где**: CONTRACTS.md §5.
**Что я допустил**: `"turn-finished" | "manual" | "initial" | "migration"`.
**Альтернатива**: другой набор (например `"auto" | "manual"` без
дальнейшей детализации).
**Использование**: попадает в audit-log, влияет на capability check
(see ADR-001).
**Confirm нужен**: реально 4 типа триггера или меньше?

### M3. `BuildJobStatus` имена, особенно `"superseded"`
**Где**: CONTRACTS.md §6, ADR-012.
**Что я допустил**: `queued | running | succeeded | failed | cancelled | superseded`.
`superseded` — мой термин для «был queued, заменён следующим enqueue».
**Альтернатива**: `replaced` / `evicted` / `dropped`. Семантически
эквивалентно.
**Confirm нужен**: ОК с именем или предпочесть другое?

### M4. `RepoMetadata.preview.migrationStatus` enum
**Где**: CONTRACTS.md §12.
**Что я допустил**: `"ok" | "needs-review" | "migrating"`.
**Альтернатива**: больше состояний (`"failed"`, `"rolled-back"`).
**Confirm нужен**: достаточно трёх или нужны ещё?

### M5. `BuildOptions.skipCurrentSwap` для миграционных билдов
**Где**: CONTRACTS.md §5, ADR-008.
**Что я допустил**: при миграционных билдах сначала прогоняется
`build({skipCurrentSwap: true})` для валидации, потом — нормальный
билд с swap.
**Альтернатива**: миграционный билд сразу со swap'ом, при failure
откат на `previous`.
**Confirm нужен**: «двухпроходный» или «однопроходный с rollback»?

### M6. Network name `adorable_build` отдельная от `adorable_sandboxes`
**Где**: BUILD_PIPELINE.md §4, SECURITY.md §3.3, ADR-005.
**Что я допустил**: build-runner и sandbox-режим — **разные** Docker
networks. `adorable_build` — internal-only (no upstream). У sandbox
есть internet (для npm install в legacy режиме).
**Альтернатива**: использовать существующую `adorable_sandboxes` для
обоих, но с разными per-container network policies.
**Confirm нужен**: ОК с двумя сетями или унифицировать?

### M7. `PreviewProviderName` поддерживает `"sandbox"` синоним к `"docker"`
**Где**: CONTRACTS.md §10.
**Что я допустил**: `normalizeProviderName` маппит `"docker"` →
`"sandbox"`. Это для совместимости с тем что `SandboxProvider`
называется так.
**Альтернатива**: только `"sandbox"`, никакого синонима.
**Confirm нужен**: оставить fallback на `"docker"` или нет?

### M8. UI-upload chat-event опциональный
**Где**: ADR-007, CONTRACTS.md §16.
**Что я допустил**: при upload бинаря — emit chat event («загружен
файл foo.png»). Но «опционально» — каждая реализация может решить.
**Альтернатива**: обязательный event (LLM всегда знает) или
обязательно отсутствует (LLM узнаёт только через listFilesTool).
**Confirm нужен**: обязательно / опционально / отсутствует?

### M9. `previewProvider.getProjectFs(projectId)` метод
**Где**: CONTRACTS.md §5.
**Что я допустил**: добавил метод чтобы createTools мог получать
`ProjectFs` через провайдера. Это означает что fs-объект — часть
PreviewProvider'а.
**Альтернатива**: `ProjectFs` создаётся отдельно (не часть
provider'а), createTools получает его через DI.
**Confirm нужен**: правильное место для fs-объекта?

### M10. Manual rebuild endpoint `POST /api/projects/:id/rebuild`
**Где**: CONTRACTS.md §17.
**Что я допустил**: пустое тело, response `{jobId, status}`. Тип
запроса POST.
**Альтернатива**: `PUT` (idempotent), или body с reason'ом
(`{reason: "manual" | "test"}` для UI debugging).
**Confirm нужен**: HTTP-семантика OK?

---

## 🟢 LOW-impact допущения

### L1. Имена новых файлов / директорий
**Где**: CONTRACTS.md §19.
**Что я допустил**:
- `lib/preview/build-queue.ts`, `lib/preview/build-error-parser.ts`,
  `lib/preview/available-deps.ts`, `lib/preview/project-fs.ts`,
  `lib/preview/provider-singleton.ts`.
- `app/api/projects/[id]/build-status/route.ts`.
- `docker/build-runner-react/Dockerfile`.
**Альтернатива**: иные имена / структура.
**Confirm нужен**: косметика, можно переименовать в реализации.

### L2. `buildId` формат `${ISO8601}-${shortHash}`
**Где**: BUILD_PIPELINE.md §4.1.
**Что я допустил**: например `2026-04-29T14-22-08Z-a3f1`.
**Альтернатива**: только uuid, или `<projectId>-<seq>`.
**Confirm нужен**: косметика; ISO даёт правильную лексикографическую
сортировку для GC.

### L3. `PREVIEW_PROVIDER_FORCE_SANDBOX` имя env
**Где**: MIGRATION_PATH.md §6.
**Что я допустил**: длинное имя для emergency override.
**Альтернатива**: `FORCE_SANDBOX`, `EMERGENCY_FALLBACK_PROVIDER`.
**Confirm нужен**: косметика.

### L4. Acceptance метрики Phase 6
**Где**: VERIFICATION.md §3.
**Что я допустил**: p50 ≤ 5s cold, p95 ≤ 10s cold; ≥ 95% success rate.
**Альтернатива**: иные числа (зависят от железа staging'а).
**Confirm нужен**: эти target'ы реалистичны для нашей нагрузки?

### L5. 8 продуктовых сценариев в VERIFICATION
**Где**: VERIFICATION.md §1.
**Что я допустил**: «Coffee Shop», «TODO», «Калькулятор ипотеки», и
другие конкретные примеры.
**Альтернатива**: иной набор сценариев под целевую аудиторию.
**Confirm нужен**: отражает ли реальный use-case типичного пользователя?

### L6. SemVer bump rules table в BOILERPLATE.md §3
**Где**: BOILERPLATE.md §3.
**Что я допустил**: какие именно изменения patch / minor / major.
**Альтернатива**: иной маппинг.
**Confirm нужен**: соответствует ли product-team ожиданиям?

### L7. Рекомендация удалить `moment`, `lodash` (cjs), `react-quill`,
`react-leaflet` без `leaflet`, `three` в OPEN_QUESTIONS
**Где**: OPEN_QUESTIONS.md E1, DEPENDENCIES.md §7.
**Что я допустил**: эти 5 пакетов — кандидаты на strip следующим
bump'ом.
**Альтернатива**: оставить. Особенно `three` если product-team
видит активное использование 3D.
**Confirm нужен**: реально ли strip'ать или хотим оставить?

### L8. Примеры в `LIMITATIONS.md` user-facing messages
**Где**: LIMITATIONS.md §1.
**Что я допустил**: конкретный текст диалогов / FAQ.
**Альтернатива**: иные формулировки (продуктовое решение для UX).
**Confirm нужен**: финальный copy — отдельная задача с UX-командой.

### L9. RU-compliance заметки
**Где**: SECURITY.md §8.
**Что я допустил**: упоминание ФЗ-152 без проверки реальных
обязательств; ОРКД "не применимо" без юр. ревью.
**Альтернатива**: detailed legal review с юристом.
**Confirm нужен**: на MVP — placeholder, перед production-launch
обязателен полный compliance review.

### L10. Audit-log событий список
**Где**: SECURITY.md §6, BUILD_PIPELINE.md §9.
**Что я допустил**: ~9 типов событий с конкретными полями.
**Альтернатива**: иной список / иные поля.
**Confirm нужен**: для observability достаточно или избыточно?

---

## Что делать с этим списком

1. **HIGH-секция (H1–H6)** — явные вопросы, на которые должен быть
   твой ответ до Phase 0 spec lock'а. Каждый ответ может породить
   новый ADR (или подтверждение текущего default'а как ADR).
2. **MEDIUM-секция (M1–M10)** — большинство решается параметром или
   небольшой правкой контракта. Можно подтвердить блоком («все ок»)
   или итеративно.
3. **LOW-секция (L1–L10)** — косметика. Confirm-by-default; правки в
   реализации.

После твоей ревизии — открытые вопросы остаются в `OPEN_QUESTIONS.md`,
подтверждённые становятся ADR'ами / inline-комментариями в спеке.

---

_Last updated: 2026-04-29._
