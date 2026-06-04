# Adorable × Base44 Redesign — Artifact Pack

Подготовленный пакет дизайн-артефактов для редизайна форка Adorable в визуал base44 с палитрой Vibeli `sunbaked` (coral + olive на cream paper).

## Как читать (в порядке убывания приоритета)

1. **[`spec.md`](spec.md)** — главный документ. Маппинг страниц base44 → Adorable, чеклист имплементации по фазам, ссылки на все артефакты, секция responsive behavior.

2. **`tokens/`** — готовые к использованию дизайн-токены:
   - **[`tokens.css`](tokens/tokens.css)** — drop-in CSS variables (универсально, работает с любым стеком)
   - **[`tailwind.css`](tokens/tailwind.css)** — Tailwind v4 `@theme` блок (для tailwind-based стеков)
   - **[`tokens.dtcg.json`](tokens/tokens.dtcg.json)** — Design Tokens Community Group формат (Style Dictionary, Tokens Studio)
   - **[`sunbaked-mapped.json`](tokens/sunbaked-mapped.json)** — структурированный маппинг base44 → sunbaked с обоснованием каждого
   - **[`mapping-decisions.md`](tokens/mapping-decisions.md)** — заметки о спорных решениях маппинга
   - **[`raw/`](tokens/raw/)** — сырые JS-аудиты base44 (для reference / переиспользования)

3. **`components/`** — инвентарь компонентов. Каждый файл = семейство с computed CSS из base44 + sunbaked-CSS. Начни с **[`_inventory.md`](components/_inventory.md)**.
   - [`layout.md`](components/layout.md) — app-shell, sidebar, top-bar, editor-split, modal, tabs
   - [`buttons-inputs.md`](components/buttons-inputs.md) — все варианты кнопок и инпутов
   - [`cards.md`](components/cards.md) — generic card, app-card, plan-card, upgrade-card
   - [`chat.md`](components/chat.md) — chat-input, user/assistant messages, code-block, action-chip
   - [`chips-alerts.md`](components/chips-alerts.md) — chips, badges, alert banners, toasts
   - [`typography-states.md`](components/typography-states.md) — type scale + empty/loading/error/404

4. **`mockups/`** — hi-fi HTML мокапы. **Открой в браузере** — это и есть target view.
   - **Desktop:** [home](mockups/desktop/home.html) · [apps-list](mockups/desktop/apps-list.html) · [editor](mockups/desktop/editor.html) · [workspace](mockups/desktop/workspace.html) · [settings](mockups/desktop/settings.html)
   - **Mobile** (375×812): [home](mockups/mobile/home.html) · [editor](mockups/mobile/editor.html)
   - [`shared.css`](mockups/shared.css) — tokens (:root) + component primitives в одном файле
   - **Стейдж:** v3 sunbaked (warm coral + olive on cream paper, Fraunces + Geist). См. [`SWAP-TO-SUNBAKED.md`](mockups/SWAP-TO-SUNBAKED.md) для истории v1 → v2 base44-stage → v3 sunbaked.
   - **Preview локально:** `cd mockups && python3 -m http.server 8765` → открыть `http://localhost:8765/desktop/home.html`

5. **`screenshots/`** — captures base44 в виде accessibility-snapshots + detailed notes.md (PNG недоступны — playwright-mcp FS isolation, см. отдельный note в `_tools/auth-log.md`).
   - P1 пейджи: 01-home / 02-apps-list / 03-app-detail / 04-editor-preview / 05-editor-workspace
   - P2 флоу: settings / billing / account / auth / onboarding / chat-detail / states

6. **`_tools/`** — переиспользуемые JS-скрипты для playwright (audit / set-auth / component-extract) + лог по авторизации.

## Стек, под который оптимизировано

- **Tailwind v4** (но `tokens.css` универсален — работает с любым CSS)
- **React + Next.js** (но мокапы — чистый HTML без React)
- **shadcn/ui** (если в форке Adorable установлено — компоненты повторяют shadcn-структуру)

Можно использовать на любом стеке — `tokens.css` достаточно. Tailwind config дополняет.

## Что НЕ нужно делать

- **Не копировать base44-бренд** (логотип, оригинальные тексты, фирменные иллюстрации) — в мокапах плейсхолдеры с нашим брендом
- **Не использовать base44-цвета напрямую** — все перемаплены в `sunbaked-mapped.json`. Используй переменные `var(--coral)`, `var(--ink)`, etc.
- **Не игнорировать mobile** — на 2 ключевые страницы (home, editor) есть mobile-варианты в `mockups/mobile/`

## Контекст

- **Исходная design system:** `../design-system-C1-sunbaked.html`
- **Spec этой research работы:** `../docs/superpowers/specs/2026-06-03-adorable-base44-redesign-research-design.md`
- **Plan этой research работы:** `../docs/superpowers/plans/2026-06-03-adorable-base44-redesign-research.md`

## Ключевые находки base44 (TL;DR)

- **Стек:** Tailwind v3 + shadcn/ui + WixMadeforText шрифт + brand orange `#FF631F`
- **Brand orange используется sparingly** — только в prompt-card glow + (вероятно) send-button. Все обычные buttons — `bg: zinc-900` (dark).
- **Тёплый акцент в палитре:** `--workspace-badge: hsl(18, 27%, 93%)` ≈ `#F0E8DB` — единственный warm нейтрал у base44. Это естественная anchor-точка для наших cream/paper.
- **Editor layout:** split-pane `~25% chat / ~75% preview`, без iframe-фрейма (чистое окно). Resizer 4px (vscode-sash).
- **Markdown в чате** через `prose dark:prose-invert + base44-markdown` custom overrides.
- **Шикарный градиент:** prompt-card имеет radial coral glow в bottom-left углу — мы воспроизводим 1:1 заменой `#FF6B21 → var(--coral)`.

## Стейджи мокапов (история)

1. **v1 `_sunbaked-draft-v1/`** — первая попытка без визуального референса base44, слишком "креативная". Архив.
2. **v2 stage-base44** — мокапы 1:1 replicas структуры base44 (orange + Inter + cold zinc). Использовалось для калибровки структурной точности. См. git history `bab4306^`.
3. **v3 sunbaked** ← **сейчас** — base44 структура + наши sunbaked цвета (coral/olive/cream/paper) + Geist + Fraunces display. Это target.

Переход между стейджами задокументирован в `mockups/SWAP-TO-SUNBAKED.md` — все изменения только в `:root { }` блоке shared.css + Google Fonts link + 3 inline gradients. Структура HTML не менялась.

## Несоответствия плану (для прозрачности)

- **PNG скриншоты:** изначально не получилось снять (playwright-mcp FS isolated). После фикса output dir на `~/.cc-mcp-outputs/` — собраны **25 PNG** для всех P1 + billing + 404. См. `screenshots/0X-*/`.
- **Per-page raw token audit сделан только для home** — base44 SPA с глобальными `:root` vars, остальные страницы дают тот же результат на уровне токенов. Per-page различия (used colors / sizes) собраны через component-extract в screenshots/notes.md.
- **Component inventory консолидирован в 6 файлов вместо 25** — для удобства чтения. Все компоненты внутри. См. `components/_inventory.md` за индексом.
- **Component docs (`components/*.md`) и `spec.md`** написаны для sunbaked сразу (включают coral/cream/ink значения). Они точно соответствуют v3 sunbaked мокапам — implementation-агент может использовать parallel.
