# BOILERPLATE.md — структура и lifecycle шаблона

Описывает что лежит в `adorable/templates/vite-react/` (на MVP — единственный
шаблон, см. ADR-002), какие файлы фиксированы, как их обновлять и как
шаблон версионируется.

Состав npm-зависимостей — `DEPENDENCIES.md`. Здесь — про **структуру**
и **lifecycle**.

Source: ADR-002 (React-only), ADR-008 (versioning + migration worker),
ADR-013 (JSX-only).

---

## 1. Структура `templates/vite-react/`

```
adorable/templates/vite-react/
├── VERSION                          ⭐ семантическая версия "1.2.3"
├── package.json                     ⭐ ФИКС — состав deps зашит сюда
├── pnpm-lock.yaml                   ⭐ ФИКС — пересоздаётся вместе с deps
├── vite.config.js                   ⭐ ФИКС — конфиг билда
├── tailwind.config.js               ⭐ ФИКС — preset Tailwind
├── postcss.config.js                ⭐ ФИКС
├── jsconfig.json                    ⭐ ФИКС — alias "@/" → src/, JSX (для Vite)
├── functions/tsconfig.json          ⭐ ФИКС — TS конфиг для functions/ (ADR-021)
├── index.html                       ⭐ ФИКС — корневой HTML, точка входа Vite
├── .gitignore                       ⭐ ФИКС — node_modules/dist/.vite
├── README.md                        ⭐ ФИКС — пользовательская документация шаблона
├── AVAILABLE_DEPS.md                ⭐ ГЕНЕРАТ — для system-prompt'а LLM
├── public/                          ⚙️ MIXED — стартовые ассеты, юзер дополняет
│   └── (минимум, например favicon.svg)
├── src/                             ✏️ USER — LLM пишет JSX (ADR-013)
│   ├── main.jsx                     ✏️ инит React, монтирует App
│   ├── App.jsx                      ✏️ корневой компонент + react-router
│   ├── index.css                    ✏️ Tailwind directives + кастомные стили
│   ├── pages/                       ✏️ страницы router'а
│   │   └── Home.jsx
│   ├── components/                  ✏️ кастомные компоненты + UI-примитивы
│   │   └── ui/                      ✏️ shadcn-style примитивы (button, input, ...)
│   └── lib/                         ✏️ утилиты
│       └── utils.js                 ✏️ cn() helper
└── functions/                       ✏️ USER — LLM пишет TypeScript edge-handler'ы
    └── (пусто на MVP, добавляются по запросу пользователя)
```

Легенда:
- ⭐ **ФИКС** — файл фиксирован шаблоном, LLM не может писать
  (whitelist в ADR-007). Меняется только через version bump шаблона.
- ⚙️ **MIXED** — стартовое содержимое из шаблона, но юзер/LLM
  дополняет (UI-upload + writeFileTool с whitelist'ом расширений).
- ✏️ **USER** — LLM пишет сюда свободно, в рамках whitelist расширений.

---

## 2. Что копируется куда при `PreviewProvider.create()`

Поток (см. `BUILD_PIPELINE.md` §4 для деталей):

```
PreviewProvider.create({repoId}):
  1. mkdir -p /data/projects/<repoId>/{src,public,functions,.vite,.cache}
  2. cp -r templates/vite-react/src/*       → /data/projects/<repoId>/src/
  3. cp -r templates/vite-react/public/*    → /data/projects/<repoId>/public/
  4. mkdir functions/                       (на MVP пуст; tsconfig.json
                                             остаётся в build-runner image)
  5. RepoMetadata.boilerplateVersion = read VERSION файл
```

**Не копируются** в scratch dir:
- `package.json`, `pnpm-lock.yaml` — лежат в build-runner image на
  `/workspace/`. LLM их не видит, не должен трогать.
- `vite.config.js`, `tailwind.config.js`, `postcss.config.js`,
  `jsconfig.json`, `functions/tsconfig.json`, `index.html` — то же
  самое, в образе.
- `node_modules/` — в named volume `adorable_node_modules_react_<v>`.
- `.gitignore`, `README.md` — для git-репо в Gitea, попадают в репо
  через `seedTemplateRepo()` (см. `lib/template-seeder.ts`).
- `VERSION`, `AVAILABLE_DEPS.md` — meta, для платформы.

LLM **видит**: `/workspace/src/`, `/workspace/public/`,
`/workspace/functions/`. Всё остальное — «инфраструктура, не трогай»
(whitelist в ADR-007).

**`functions/` не входит в build-runner mounts** — `vite build` не
билдит TS-функции. Они хранятся в scratch + Gitea, исполняются
будущим BaaS-рантаймом (ADR-021).

---

## 3. VERSION файл

```
templates/vite-react/VERSION
```

Содержимое — одна строка с семантической версией:
```
1.2.3
```

Связь:
- Docker-образ: `build-runner-react:1.2.3`
- Named volume: `adorable_node_modules_react_1_2_3`
  (точки заменяются на `_` для совместимости с Docker volume naming)
- `RepoMetadata.boilerplateVersion = "1.2.3"` для проектов,
  созданных на этой версии

### Когда поднимать какой компонент

| Изменение                                             | Bump        |
|-------------------------------------------------------|-------------|
| Patch-обновление зависимости (1.2.3 → 1.2.4)         | patch       |
| Добавление новой зависимости / удаление неиспользуемой| minor       |
| Breaking change Vite/React/Tailwind majo r            | major       |
| Любое изменение `vite.config.js` / структуры src/    | minor       |
| Структурное изменение `package.json` (например strip TS) | major   |
| Косметика в README                                    | патч        |

Жёсткое правило: **любое изменение** version-bump'ит boilerplate.
Никаких «тихих» правок — иначе расходится с
`adorable_node_modules_react_<v>` volume и build-runner image.

---

## 4. AVAILABLE_DEPS.md — для LLM-промпта

Файл генерируется из `package.json` + ручной таблицы synonyms
(`adorable/lib/preview/available-deps.ts`). Это **production artifact**,
коммитится вместе с шаблоном, попадает в LLM system-prompt
(ADR-010, ARCHITECTURE CONSTRAINT блок).

Формат:

```markdown
# AVAILABLE DEPENDENCIES — boilerplate v1.2.3

This is the COMPLETE list of npm packages available in this project.
Do NOT import packages that are not listed here — the build will fail.

## UI primitives (Radix)
- @radix-ui/react-dialog
- @radix-ui/react-dropdown-menu
- @radix-ui/react-popover
- ... (полный список с кратким описанием каждого)

## State / forms
- react-hook-form  — form state management
- @hookform/resolvers — integrate with zod
- zod  — schema validation
- @tanstack/react-query — server state, fetch caching

## Styling helpers
- clsx, class-variance-authority, tailwind-merge
- tailwindcss-animate

## Icons
- lucide-react

## Routing
- react-router-dom v6

## Charts / data viz
- recharts

## Animation
- framer-motion

## ... (см. DEPENDENCIES.md для группировки)

## NOT AVAILABLE (suggestions)
- `axios` → use built-in `fetch`
- `lodash.debounce` → use `lodash` (full package is installed) or write inline
- `react-query` (v3) → use `@tanstack/react-query` (v5)
- Any backend framework (express, fastify) → not supported, see LIMITATIONS.md
```

Генератор живёт в `scripts/generate-available-deps.ts` (npm-task
`pnpm gen:available-deps`) и запускается перед commit'ом нового
boilerplate-bump. Тип-проверка генерации — gate в CI.

---

## 5. Lifecycle версий boilerplate (ADR-008)

```
[Релиз новой версии шаблона]
      │
      ▼
[1] Platform engineer редактирует templates/vite-react/{...}
[2] Bump'ит VERSION (1.2.3 → 1.3.0)
[3] Запускает pnpm gen:available-deps (обновляет AVAILABLE_DEPS.md)
[4] Запускает pnpm gen:boilerplate-image (Dockerfile + init-volume.sh)
[5] CI собирает build-runner-react:1.3.0
[6] CI создаёт adorable_node_modules_react_1_3_0 named volume
    (через init-контейнер с cp -a, см. ADR-005)
[7] Commit + tag boilerplate@1.3.0
      │
      ▼
[Migration trigger]
[8] Platform-engineer запускает migration worker через
    pnpm migrate:boilerplate --from=1.2.x --to=1.3.0 [--batch-size=N]
      │
      ▼
[Миграционный воркер]
для каждого проекта в партии (rate-limited):
  - tag в metadata: migrationStatus = "migrating"
  - vite build с новой версией (skipCurrentSwap=true) — пред-валидация
  - if success: skipCurrentSwap=false rebuild с реальным swap
                metadata.boilerplateVersion = "1.3.0"
                metadata.migrationStatus = "ok"
  - if fail:    metadata.migrationStatus = "needs-review"
                в UI баннер пользователю
                артефакт current не трогается (старый остаётся)
```

### Manual upgrade

UI показывает: «ваш проект использует boilerplate 1.2.3, доступна 1.3.0».
Кнопка «Обновить» → `POST /api/projects/<id>/migrate-boilerplate`
делает то же что воркер, но для одного проекта.

---

## 6. Rollback при неудачной миграции

`metadata.migrationStatus = "needs-review"` — это сигнал что текущая
версия артефакта (`current`) не была обновлена, проект показывает
старый билд с прошлой версии boilerplate'а. Платформа НЕ снимает
этот статус автоматически — нужен ручной review:

1. Platform-engineer / пользователь смотрит логи миграции
   через `getBuildLogsTool` или web-консоль.
2. Если ошибка очевидна и LLM может её исправить — пользователь
   делает chat-турн «исправь это».
3. После успешного manual rebuild — `migrationStatus` сбрасывается
   на `"ok"`, `boilerplateVersion` обновляется.

Откат на ещё более старую версию boilerplate'а (`1.2.3 → 1.2.2`):
не поддерживается на MVP. Если нужно — ручная миграция платформой
с pin на старый image. Open question.

---

## 7. Правила хранения и upgrade

### Когда **можно** молча трогать `templates/vite-react/`?
Никогда. Любое изменение требует bump VERSION + регенерацию
`AVAILABLE_DEPS.md` + пересборку image + регенерацию named volume.

### Когда требуется ручное вмешательство?
Каждый bump — ручная операция platform-engineer'а. Frequency
автомиграций — `OPEN_QUESTIONS.md` (default: вручную, по-проектно).

### Что **запрещено** помещать в шаблон?
- Секреты, ключи, токены (даже dummy).
- Конкретные user-данные.
- Большие бинарные файлы (>1 MB) — для них UI-upload в scratch dir.
- TypeScript (см. ADR-013, до явного revoke).

---

## 8. Связь с уже существующим кодом

### `lib/template-seeder.ts`

Существующий модуль уже умеет:
- `resolveTemplateDir()` — env-override `ADORABLE_TEMPLATE_DIR`.
- `walkTemplate()` — обход с IGNORED_ENTRIES (`node_modules`,
  `dist`, `.git`).
- `seedTemplateRepo()` — заливка в Gitea при создании репо.
- `seedSandboxFromTemplate()` / `seedSandboxFromSourceRepo()` —
  заливка в живой sandbox; нужно только для sandbox-режима.

После миграции:
- `seedTemplateRepo()` остаётся как есть.
- `seedSandboxFromTemplate()` / `seedSandboxFromSourceRepo()`
  переезжают в `lib/preview/preview-sandbox.ts` — они нужны только
  sandbox-режиму.
- Появляется новый `seedScratchDirFromTemplate()` (или просто
  inline в `previewProvider.create()`) — копирует `src/` и `public/`
  в `/data/projects/<id>/`. Это «упрощённая» версия — только эти две
  директории, остальное в build-runner image.
- IGNORED_ENTRIES расширяется: `node_modules`, `dist`, `.git`,
  `.DS_Store`, `.vite`, `.cache`, `pnpm-lock.yaml`, `package.json`,
  `vite.config.*`, `tailwind.config.*`, `postcss.config.*`,
  `jsconfig.json`, `tsconfig.json`, `functions/tsconfig.json`,
  `index.html`, `VERSION`, `AVAILABLE_DEPS.md`. Всё что НЕ копируется
  в scratch dir (см. §2) — игнор'ится.

---

## 9. Будущие шаблоны (Vue, Svelte) — placeholder

Когда (если) пройдём через ADR-002 revoke и добавим вторую framework:
```
adorable/templates/
├── vite-react/         (обновляется как сейчас)
└── vite-vue/           (новая структура — VERSION, package.json, ...)
```

`PREVIEW_PROVIDER` останется static, добавится поле
`framework: "react" | "vue"` в `RepoMetadata`. Это аддитивный
breaking change через bump major-версии всех существующих
boilerplate'ов одновременно (или через миграционный gate).

Сейчас об этом не думаем — на MVP только React.

---

_Last updated: 2026-04-27._
