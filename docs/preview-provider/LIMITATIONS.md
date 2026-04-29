# LIMITATIONS.md — границы static-режима

Что **не** поддерживается архитектурой PreviewProvider в static-
режиме на MVP. Это документ для пользователя, реализатора UI-сообщений
и для согласования product-expectations.

Это **не баг-список**: ограничения — следствие принятых архитектурных
решений (см. ADR-002, ADR-009, ADR-013, ADR-019). Их адресует не
этот форк, а **другой продукт** (BaaS-интеграция, sandbox-режим).

Source: все ADR, ARCHITECTURE.md §7.

---

## 1. Жёсткие ограничения (заложены архитектурой)

### 1.1. Нет server-runtime

- Никаких Express, Fastify, Koa, Next.js API routes, server actions,
  Edge functions runtime.
- Backend для приложения = managed BaaS-провайдер (Appwrite или
  аналог; см. OPEN_QUESTIONS.md). Подключение через `fetch` из
  браузера.
- На MVP **`functions/**/*.ts` файлы существуют, но не исполняются**
  (ADR-021). Они станут рабочими после BaaS-интеграции.

**User-facing message** (UI overlay при попытке запустить серверный
код): «Этот проект — статичный SPA. Серверный код запустится после
подключения BaaS — пока что используйте `localStorage` или внешний
API через `fetch`».

### 1.2. Нет custom npm-зависимостей

- Состав npm-пакетов **фиксирован** в `templates/vite-react/package.json`
  (ADR-019). LLM не может добавить новый пакет.
- Если LLM пытается импортировать что-то вне списка — билд падает с
  `BuildError {code: "import-not-allowed"}`. LLM получает suggestion
  из synonyms таблицы (например `axios → fetch`).
- Расширение списка — **продуктовое решение** platform-team
  (ADR-008). Запросы пользователей собираются и анализируются.

**User-facing message** (UI чат при ошибке): «Пакет `axios` не
доступен в этом шаблоне. Можно использовать встроенный `fetch` API.
Если нужен другой пакет — напишите в поддержку».

### 1.3. Нет TypeScript для frontend

- `src/**` — JSX-only (ADR-013). LLM пишет `*.jsx`, не `*.tsx`.
- Тип-проверки UI-кода нет.
- `functions/**/*.ts` — TypeScript, но это не frontend.

**User-facing message** (если пользователь явно просит TS): «Frontend
этого шаблона использует JSX, не TypeScript. Серверные функции
(папка functions/) пишутся на TypeScript».

### 1.4. Нет HMR / live-reload

- Каждое изменение = full vite build (с тёплым cache).
- В UI пользователь видит overlay «Обновляется...» во время билда
  (ADR-004). После успешного билда iframe обновляется
  (`location.reload`).
- Типичная задержка: 2–5 секунд (cache warm), 5–10 секунд (cold).
- HMR будет в sandbox-режиме (capability `hotReload: true`), но это
  fallback, не default.

**User-facing message** (FAQ или onboarding tooltip): «Это статичный
билдер: каждое изменение пересобирается через несколько секунд. Это
быстрее, чем кажется — мы оптимизируем cache».

### 1.5. Нет SSR / SSG

- Vite в режиме SPA. `vite build` создаёт client-side bundle, не
  pre-rendering.
- `index.html` — единственный HTML, всё остальное JS.
- SEO: limited — поисковики могут не проиндексировать SPA-контент.
  Если SEO критично — пока **не наш use-case**.

**User-facing message** (FAQ): «Эта платформа создаёт SPA — лучше
всего подходит для приложений и динамических страниц. Если нужен
SEO-friendly статический сайт — используйте генератор статики (это
другой продукт)».

### 1.6. Нет shell-доступа для LLM

- В static-режиме LLM не может выполнять `bash`, `npm install`, etc.
  (ADR-003).
- Это by design: устраняет целый класс security-issues.
- Все file-операции — через `writeFile`, `readFile`, etc tools.

**User-facing message** (видна только LLM, не юзеру): уже в
ARCHITECTURE CONSTRAINT блоке system-prompt'а.

### 1.7. Нет реактивных UI-апдейтов между LLM-turn'ами

- Билд триггерится **только** в `onFinish` стрима (или manual
  rebuild). Во время стрима пользователь видит текст LLM, но iframe
  не обновляется.
- После закрытия стрима — overlay «Обновляется...», затем reload.

**User-facing message** (тultiplekt в UI): «Вы увидите обновление
preview через несколько секунд после того как ассистент закончит
ответ».

---

## 2. Soft-ограничения (могут быть решены, но out of scope MVP)

### 2.1. Нет multi-framework (Vue, Svelte)

- Поддержан только React (ADR-002).
- Расширение — после ADR-002 revoke + создание `templates/<framework>/`.

### 2.2. Нет custom domain mappings

- Preview доступен только по `<projectId>.preview.<base>`.
- Custom domains (`mysite.com → /data/static/<id>/current/`) — Phase 5
  «Deploy», отложен в v2 (см. MIGRATION_PLAN.md root-уровневый).

### 2.3. Нет dark mode toggle через системный prefers-color-scheme

- `next-themes` есть в boilerplate'е, LLM может реализовать toggle.
  Но automatic detection через media query — стандартная клиентская
  логика, не платформенная.

### 2.4. Нет файлов > 5 MB через UI upload

- `UPLOAD_MAX_BYTES = 5 * 1024 * 1024` (ADR-007).
- Большие файлы (видео, тяжёлые изображения) — out of scope. Пользователь
  должен сжимать.

### 2.5. Нет TypeScript typecheck в build pipeline

- `tsc --noEmit functions/**/*.ts` не запускается на MVP (ADR-021).
- Тип-баги в `functions/` проявятся только при BaaS-deploy.

### 2.6. Нет горизонтального масштабирования билдера

- Single-instance модель (ADR-006). Все scratch dirs на локальном
  диске билдера.
- При >десятков concurrent users → нужны sticky sessions →
  S3-compat для scratch (отдельная задача, OPEN_QUESTIONS).

### 2.7. Нет persistent storage для генерируемого приложения

- Пользовательский SPA сохраняет данные в `localStorage`/`sessionStorage`
  только. Никакой managed-DB на нашей стороне.
- Появится с BaaS-интеграцией.

---

## 3. Что **не** ограничено (часто спрашиваемое)

### 3.1. Можно использовать любые web-API

- `fetch`, `WebSocket`, `IndexedDB`, `localStorage`, `crypto.subtle`,
  и т.д. — браузерные стандарты, работают.
- CORS — это уже отношения с external API, не наша проблема.

### 3.2. Можно вызывать external API напрямую из браузера

- `fetch('https://api.example.com/...')` работает, если API
  CORS-permitting.
- Секреты для API нельзя хранить в коде frontend (видны клиенту).

### 3.3. Можно работать с большими списками / данными

- Vite tree-shake'ает зависимости. Bundle size зависит от того что
  LLM импортирует.
- Для больших списков (1000+ элементов) — `react-resizable-panels`,
  виртуализация (LLM может сделать руками или использовать utility
  из uvb).

### 3.4. Можно стилизовать через произвольный Tailwind

- Все Tailwind utility-классы доступны (стандартный Tailwind 3.4
  setup).
- Custom CSS через `src/index.css` или per-component `*.css` файлы.

---

## 4. Как граница static и sandbox видна пользователю

В UI:
- **Capability badges** в шапке проекта: «Static», «Real-time
  preview off», «No backend» — кратко, кликабельно (раскрывает
  объяснение).
- **При попытке запросить unsupported feature** — диалог
  «Эта возможность требует sandbox-режима. Хотите создать новый
  проект в sandbox?» (если platform-team разрешает).

В чате LLM:
- ARCHITECTURE CONSTRAINT блок в system-prompt предупреждает
  заранее.
- При билд-ошибке `import-not-allowed` — clear suggestion в чат.

---

## 5. Roadmap снятия ограничений

| Ограничение                | Когда снимется               |
|----------------------------|------------------------------|
| 1.1 Нет server-runtime     | После BaaS-интеграции (Phase v2) |
| 1.4 Нет HMR                | Никогда в static — sandbox-режим есть |
| 1.5 Нет SSR/SSG            | Other product (separate)     |
| 2.1 Нет multi-framework    | После Vue/Svelte product-decision |
| 2.5 Нет typecheck functions | По решению platform-team    |
| 2.6 Нет horizontal scale   | При продуктовой нагрузке (sticky→S3) |

---

_Last updated: 2026-04-28._
