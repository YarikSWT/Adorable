# DEPENDENCIES.md — npm-зависимости boilerplate'а

Этот документ описывает **продукт**, а не настройку. Состав
зависимостей определяет какие приложения вообще можно сгенерировать
через нашу платформу. Изменение списка — продуктовое решение
platform-team, не техническая правка.

Source: ADR-002 (React-only), ADR-013 (JSX-only),
ADR-018 (build error parser), ADR-019 (battery-included из base44).

---

## 1. Категории зависимостей

Для удобства навигации, генерации `AVAILABLE_DEPS.md` и обучения
LLM. Категории живут в `adorable/lib/preview/available-deps.ts`
как struct'ура с метаданными (id, label, packages[], use-cases[]).

| Категория        | Использование                                            |
|------------------|----------------------------------------------------------|
| Core React        | Сам React + DOM-рендер                                  |
| Routing           | Client-side routing                                      |
| UI primitives     | Radix-set для shadcn-style кнопок, диалогов, и т.д.     |
| Styling helpers   | clsx / cva / tailwind-merge / tailwindcss-animate       |
| Icons             | lucide-react                                             |
| Forms             | react-hook-form + zod                                    |
| Server state      | @tanstack/react-query                                    |
| Data viz          | recharts                                                 |
| Animation         | framer-motion                                            |
| Date              | date-fns + react-day-picker (+moment как legacy)         |
| Carousel          | embla-carousel-react                                     |
| DnD               | @hello-pangea/dnd                                        |
| Maps              | react-leaflet (+leaflet добавить — TODO)                 |
| Editor            | react-quill (TipTap не входит — open question)           |
| Notifications     | sonner + react-hot-toast (дублирует — выбрать)           |
| Toast (Radix)     | @radix-ui/react-toast (дублирует sonner/hot-toast)       |
| Markdown          | react-markdown                                           |
| 3D                | three                                                    |
| PDF               | jspdf, html2canvas                                       |
| ZIP               | jszip                                                    |
| Effects           | canvas-confetti                                          |
| Drawer            | vaul                                                     |
| Themes            | next-themes (для darkmode toggle в SPA)                  |
| Payments          | @stripe/react-stripe-js + @stripe/stripe-js              |
| OTP input         | input-otp                                                |
| Resizable         | react-resizable-panels                                   |
| CMD palette       | cmdk                                                     |
| Misc utils        | lodash, uuid                                             |

---

## 2. Полный список dependencies

```json
{
  "@hello-pangea/dnd": "^17.0.0",
  "@hookform/resolvers": "^4.1.2",
  "@radix-ui/react-accordion": "^1.2.3",
  "@radix-ui/react-alert-dialog": "^1.1.6",
  "@radix-ui/react-aspect-ratio": "^1.1.2",
  "@radix-ui/react-avatar": "^1.1.3",
  "@radix-ui/react-checkbox": "^1.1.4",
  "@radix-ui/react-collapsible": "^1.1.3",
  "@radix-ui/react-context-menu": "^2.2.6",
  "@radix-ui/react-dialog": "^1.1.6",
  "@radix-ui/react-dropdown-menu": "^2.1.6",
  "@radix-ui/react-hover-card": "^1.1.6",
  "@radix-ui/react-label": "^2.1.2",
  "@radix-ui/react-menubar": "^1.1.6",
  "@radix-ui/react-navigation-menu": "^1.2.5",
  "@radix-ui/react-popover": "^1.1.6",
  "@radix-ui/react-progress": "^1.1.2",
  "@radix-ui/react-radio-group": "^1.2.3",
  "@radix-ui/react-scroll-area": "^1.2.3",
  "@radix-ui/react-select": "^2.1.6",
  "@radix-ui/react-separator": "^1.1.2",
  "@radix-ui/react-slider": "^1.2.3",
  "@radix-ui/react-slot": "^1.1.2",
  "@radix-ui/react-switch": "^1.1.3",
  "@radix-ui/react-tabs": "^1.1.3",
  "@radix-ui/react-toast": "^1.2.2",
  "@radix-ui/react-toggle": "^1.1.2",
  "@radix-ui/react-toggle-group": "^1.1.2",
  "@radix-ui/react-tooltip": "^1.1.8",
  "@stripe/react-stripe-js": "^3.0.0",
  "@stripe/stripe-js": "^5.2.0",
  "@tanstack/react-query": "^5.84.1",
  "canvas-confetti": "^1.9.4",
  "class-variance-authority": "^0.7.1",
  "clsx": "^2.1.1",
  "cmdk": "^1.0.0",
  "date-fns": "^3.6.0",
  "embla-carousel-react": "^8.5.2",
  "framer-motion": "^11.16.4",
  "html2canvas": "^1.4.1",
  "input-otp": "^1.4.2",
  "jspdf": "^4.0.0",
  "jszip": "^3.10.1",
  "lodash": "^4.17.21",
  "lucide-react": "^0.475.0",
  "moment": "^2.30.1",
  "next-themes": "^0.4.4",
  "react": "^18.2.0",
  "react-day-picker": "^8.10.1",
  "react-dom": "^18.2.0",
  "react-hook-form": "^7.54.2",
  "react-hot-toast": "^2.6.0",
  "react-leaflet": "^4.2.1",
  "react-markdown": "^9.0.1",
  "react-quill": "^2.0.0",
  "react-resizable-panels": "^2.1.7",
  "react-router-dom": "^6.26.0",
  "recharts": "^2.15.4",
  "sonner": "^2.0.1",
  "tailwind-merge": "^3.0.2",
  "tailwindcss-animate": "^1.0.7",
  "three": "^0.171.0",
  "uuid": "^9.0.0",
  "vaul": "^1.1.2",
  "zod": "^3.24.2"
}
```

## 3. Полный список devDependencies

```json
{
  "@types/node": "^22.13.5",
  "@types/react": "^18.2.66",
  "@types/react-dom": "^18.2.22",
  "@vitejs/plugin-react": "^4.3.4",
  "autoprefixer": "^10.4.20",
  "postcss": "^8.5.3",
  "tailwindcss": "^3.4.17",
  "typescript": "^5.8.2",
  "vite": "^6.1.0"
}
```

`typescript` и `@types/*` нужны для TypeScript-функций в
`functions/**/*.ts` (ADR-013 раунд 6, ADR-021). На MVP build-runner
их не использует — `vite build` идёт только по `src/` (JSX). Они
здесь для (а) IDE-typecheck'а functions, (б) будущего BaaS-deploy
конвейера.

---

## 4. Strip'нуто (с обоснованием)

См. ADR-019. Кратко:

- **`eslint*` + `globals`** — нет lint-этапа в build pipeline.
- **`baseline-browser-mapping`** — Vite сам определяет browserslist.

---

## 5. Synonyms таблица для парсера ошибок

ADR-018 ввёл `BuildErrorCode = "import-not-allowed"` с поле
`suggestion?: string`. Источник правды для подсказок:
`adorable/lib/preview/available-deps.ts`.

```ts
export const SYNONYMS: Record<string, {
  available?: string;       // что есть на замену
  reason: string;           // почему нет
  suggestion: string;       // готовый текст для LLM
}> = {
  "axios": {
    available: "fetch",
    reason: "Used global fetch is preferred for static SPAs.",
    suggestion: "Use the built-in `fetch` API instead of axios.",
  },
  "express": {
    reason: "No server runtime in static SPAs.",
    suggestion: "This project is a static SPA — no Express server. Connect to the managed BaaS for backend functionality.",
  },
  "fastify": {
    reason: "No server runtime in static SPAs.",
    suggestion: "This project is a static SPA — no Fastify. Connect to the managed BaaS for backend functionality.",
  },
  "next": {
    reason: "Adorable uses Vite, not Next.js.",
    suggestion: "Use Vite + react-router-dom for routing instead of Next.js.",
  },
  "react-query": {
    available: "@tanstack/react-query",
    reason: "react-query was renamed to @tanstack/react-query in v4.",
    suggestion: "Import from `@tanstack/react-query` (v5 is installed).",
  },
  "@tanstack/query-core": {
    available: "@tanstack/react-query",
    reason: "Use the React-specific package, not the core.",
    suggestion: "Import from `@tanstack/react-query`.",
  },
  "lodash-es": {
    available: "lodash",
    reason: "We have CJS lodash; ESM variant is not installed.",
    suggestion: "Import from `lodash` (e.g. `import { debounce } from 'lodash'`).",
  },
  "dayjs": {
    available: "date-fns",
    reason: "We standardized on date-fns.",
    suggestion: "Use `date-fns` instead of dayjs.",
  },
  "luxon": {
    available: "date-fns",
    reason: "We standardized on date-fns.",
    suggestion: "Use `date-fns` instead of luxon.",
  },
  "mongodb": {
    reason: "No database drivers in static SPAs.",
    suggestion: "This project is a static SPA — no DB. Use the managed BaaS for persistent data.",
  },
  "pg": {
    reason: "No database drivers in static SPAs.",
    suggestion: "This project is a static SPA — no DB. Use the managed BaaS for persistent data.",
  },
  // ... другие частые ошибки добавляются итеративно
};
```

При билд-ошибке `Could not resolve "axios"`:
1. Парсер находит соответствие `axios` в `SYNONYMS`.
2. Создаёт `BuildError`:
   ```
   {
     code: "import-not-allowed",
     missingModule: "axios",
     message: "Module 'axios' is not allowed in this project.",
     suggestion: "Use the built-in `fetch` API instead of axios.",
     ...
   }
   ```
3. LLM получает структурированную ошибку через `getBuildLogsTool` и
   может сразу заменить `axios` на `fetch`.

Если в `SYNONYMS` нет соответствия — `code: "module-not-found"`,
без suggestion. Парсер также не должен помечать `import-not-allowed`
если модуль на самом деле должен быть в boilerplate'е (тогда это
системная ошибка — мисс-сборка volume, например). Проверка:
модуль в `package.json` deps → если да и всё равно «not found» →
`code: "unknown"` с raw stderr.

---

## 6. Стратегия выбора зависимостей

### Что было использовано как инструмент решения

- **base44** (см. `docs/preview-provider/research/example-base44/`) —
  широкий референс для лендингов / простых SPA. Их состав и взяли
  за основу.
- **Принцип «battery included для типичных кейсов»** — лендинг,
  TODO, калькулятор, дашборд, портфолио, демо UI. Не пытаемся
  покрыть нишевые случаи (3D-игры, real-time multiplayer).
- **Не добавляем** packages для server-side: Express, Fastify, Prisma,
  databases. Чётко противоречат ADR-009 (static-only).

### Будущие правки списка

Решения принимаются platform-team. Критерии для нового добавления:
- Используется в ≥10% генерируемых проектов (по audit-log парсингу
  failed `module-not-found` events) — strong signal что нужно.
- Bundle size acceptable (Vite tree-shaking работает или используется
  редко) — учитывается trade-off.
- Не дублирует существующее (например `dayjs` дублирует `date-fns` —
  не добавляем).

Решения о удалении:
- Известные security CVE.
- Deprecated upstream без маинтейнера.
- Дублирование (`moment` дублирует `date-fns` → удалять следующим bump'ом).

---

## 7. Известные дубликаты в текущем списке (открытые)

Пометки для следующего bump'а:

| Пакет           | Альтернатива         | Решение           |
|-----------------|----------------------|-------------------|
| `moment`        | `date-fns`           | strip в 1.x → 2.0 |
| `lodash` (cjs)  | `lodash-es`          | возможно strip    |
| `react-hot-toast` + `sonner` + `@radix-ui/react-toast` | один из трёх | оставить sonner, остальные strip — open question |

Открытые вопросы (`OPEN_QUESTIONS.md`):
- `three` — оставлять? Тяжёлый, нишевой. Голос LLM-а / UX-замер при
  реальном использовании.
- `react-leaflet` без `leaflet` peer-dep — добавить или strip.
- `react-quill` → `tiptap` миграция?
- Lint в pipeline — нужен ли (если да, возвращаем eslint*).

---

## 8. AVAILABLE_DEPS.md vs DEPENDENCIES.md

- **AVAILABLE_DEPS.md** — для LLM-промпта, краткий, плоский, без
  мотивации. Генерируется автоматически из `package.json` +
  `lib/preview/available-deps.ts` категорий.
- **DEPENDENCIES.md** (этот документ) — для людей: реализатор,
  ревьюер, новый разработчик. Содержит мотивацию, strip-policy,
  synonyms, открытые вопросы.

Они **не должны рассинхронизироваться**: добавил пакет в
`package.json` → `pnpm gen:available-deps` обновляет `AVAILABLE_DEPS.md` →
ручное обновление этого документа. Drift = баг, gate в CI.

---

_Last updated: 2026-04-27._
