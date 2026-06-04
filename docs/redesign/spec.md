# Adorable × Sunbaked Redesign — Implementation Guide

**Для:** implementation-агент (Claude в будущей сессии) или человек-разработчик.
**Цель:** переделать форк Adorable так, чтобы он визуально и поведенчески напоминал base44, но в палитре Vibeli `sunbaked` (coral + olive на cream paper).

## 1. Tech assumptions

| Если форк Adorable использует | Делать |
|---|---|
| **Tailwind v4** | Импортировать `tokens/tailwind.css` рядом с `@import 'tailwindcss'`. Использовать tailwind утилиты с нашими цветами (`bg-paper`, `text-ink`, `bg-coral`, etc.) |
| **Tailwind v3** | Скопировать содержимое `tokens/tokens.css` в `globals.css`. Дополнительно — extend Tailwind theme через `tailwind.config.ts` (приложить colors из tokens.dtcg.json) |
| **CSS-in-JS / styled-components / vanilla CSS** | Просто `@import 'path/to/tokens.css'` в корне. Использовать `var(--coral)`, `var(--text-primary)` напрямую |
| **shadcn/ui установлен** | Переопределить shadcn's CSS variables на наши через `:root` overrides (см. tokens.css — наши уже семантические aliases) |

## 2. Шрифты

Добавить в `<head>` (или next/font):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,ital@9..144,400,0;9..144,500,0;9..144,600,0;9..144,500,1&family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
```

Использование:
- `var(--font-display)` = Fraunces — **для hero, plan-prices, accent words с italic**
- `var(--font-sans)` = Geist — **для всего UI** (buttons, inputs, body, sidebar, labels)
- `var(--font-mono)` = Geist Mono — **для metadata, monospace labels, code, kbd**

## 3. Иконки

Установить **lucide-react**:
```bash
npm i lucide-react
```

Все мокапы используют Lucide. Соответствие base44 иконкам:
- Sparkles → "New app"
- Folder → "My apps"
- LayoutTemplate → "Templates"
- Plug → "Integrations"
- Users → "Community" / "Members"
- Settings → "Settings"
- Heart → favorite
- ChevronRight / ChevronDown — chevrons
- Plus / FolderPlus — create actions
- Search — search icon в input
- ArrowUp — send button
- Paperclip / Image / Plug — chat input toolbar
- Code / Database / Webhook / Terminal — workspace tabs
- Rocket — deploy
- GitBranch / GitCommit — version control

## 4. Маппинг страниц base44 → Adorable

| base44 page | Adorable equivalent | Reference notes | Reference mockup |
|---|---|---|---|
| `app.base44.com/` (workspace home) | `/` (главная — prompt-to-app) | [`screenshots/01-home/notes.md`](screenshots/01-home/notes.md) | [`mockups/desktop/home.html`](mockups/desktop/home.html), [`mockups/mobile/home.html`](mockups/mobile/home.html) |
| `/apps?filter=my_apps_workspace` | `/apps` (grid + filters) | [`screenshots/02-apps-list/notes.md`](screenshots/02-apps-list/notes.md) | [`mockups/desktop/apps-list.html`](mockups/desktop/apps-list.html) |
| `/apps/{id}` (editor, no preview) | `/apps/[id]/chat` (full-width chat) | [`screenshots/03-app-detail/notes.md`](screenshots/03-app-detail/notes.md) | используй `editor.html` без preview-pane |
| `/apps/{id}/editor/preview` | `/apps/[id]` (default — chat + preview) | [`screenshots/04-editor-preview/notes.md`](screenshots/04-editor-preview/notes.md) | [`mockups/desktop/editor.html`](mockups/desktop/editor.html), [`mockups/mobile/editor.html`](mockups/mobile/editor.html) |
| `/apps/{id}/editor/workspace/overview` | `/apps/[id]/workspace` (tabs Overview/Data/Code/...) | [`screenshots/05-editor-workspace/notes.md`](screenshots/05-editor-workspace/notes.md) | [`mockups/desktop/workspace.html`](mockups/desktop/workspace.html) |
| `/billing` (pricing) | `/billing` (4-tier plans) | [`screenshots/billing/notes.md`](screenshots/billing/notes.md) | (вписать `plan-card` из `components/cards.md` в settings sub-page) |
| `/settings`, `/account` (404 у base44) | `/settings` (vertical sub-nav + Profile/Account/Billing/Notifications/API) | [`screenshots/settings/notes.md`](screenshots/settings/notes.md) | [`mockups/desktop/settings.html`](mockups/desktop/settings.html) |
| Auth (`/login`) | `/login` (centered card + OAuth + email) | [`screenshots/auth/notes.md`](screenshots/auth/notes.md) | (можно создать по паттерну в notes) |

## 5. Чеклист имплементации (по фазам)

### Phase 0 — Setup
- [ ] Скопировать `tokens/tokens.css` в `app/globals.css` (или эквивалент)
- [ ] Если Tailwind v4 — добавить содержимое `tokens/tailwind.css` рядом с `@import 'tailwindcss'`
- [ ] Подключить Google Fonts (Fraunces + Geist + Geist Mono) — см. секцию 2
- [ ] Установить `lucide-react`
- [ ] Удалить старые CSS-цвета Adorable (которые мы перекрываем) — `git grep` старые hex'ы и заменить на токены

### Phase 1 — App shell + Sidebar
- [ ] Реализовать `app-shell` grid (240px sidebar + main), см. [`components/layout.md`](components/layout.md)
- [ ] Sidebar: logo + workspace-switcher + nav секции + upgrade-card + user-strip
- [ ] Active state для sidebar-item с coral-stripe слева
- [ ] Mobile: hamburger в top-bar + drawer (sidebar появляется как `position:fixed; inset: 0` overlay)
- [ ] Bottom-nav для mobile (4 items): см. [`mockups/mobile/home.html`](mockups/mobile/home.html)

### Phase 2 — Базовые building blocks
- [ ] Buttons: primary / secondary / ghost / brand / icon / send / segmented — см. [`components/buttons-inputs.md`](components/buttons-inputs.md)
- [ ] Inputs: text / search / textarea — см. там же
- [ ] Cards: generic / app-card / plan-card / upgrade-card — см. [`components/cards.md`](components/cards.md)
- [ ] Chips: default / olive / ink / status variants — см. [`components/chips-alerts.md`](components/chips-alerts.md)

### Phase 3 — Home page (`/`)
- [ ] Hero: eyebrow + display-l title + sub
- [ ] **Prompt-card с brand glow gradient** — точно воспроизвести радиальный градиент: `linear-gradient(var(--paper), var(--paper)), radial-gradient(circle at 0% 100%, var(--coral) 0%, transparent 24%)`. См. [`mockups/desktop/home.html`](mockups/desktop/home.html).
- [ ] Toolbar внизу prompt-card: attach + image + connectors + model-label + round send-button
- [ ] Suggestion pills row (6 категорий)
- [ ] Recent apps grid (3-col на desktop, vertical list на mobile)
- [ ] Mobile: top-bar с hamburger + horizontal-scroll suggestions

### Phase 4 — Apps list (`/apps`)
- [ ] Page header: large display title "My apps" (italic accent) + secondary "New folder" + primary "Create new app" buttons
- [ ] Filter row: search input + 2 dropdown filter buttons + Grid/List segmented toggle
- [ ] Apps grid (3-col): app-card с preview thumbnail + title + actions + desc + meta
- [ ] Hover state: shadow-2 + translateY(-2px)
- [ ] Empty state (когда нет apps): см. [`components/typography-states.md`](components/typography-states.md)

### Phase 5 — Editor (`/apps/[id]`)
**Главная страница.** Уделить особое внимание.

- [ ] Split-pane layout: grid `minmax(320px, 30%) 4px 1fr`
- [ ] Resizer column 4px, cursor col-resize, hover на coral-soft (JS-handler для drag)
- [ ] Chat pane: header (с back / title / status / git / more) + scrollable messages + sticky input внизу
- [ ] **Chat messages:**
  - User: right-aligned bubble `bg-cream border-cream-deep radius-md`
  - Assistant: full-width, role-label сверху (coral-mono uppercase eyebrow style)
  - Markdown content via `prose` plugin Tailwind + наш override `.chat-md`
  - Code-block: warm-dark `bg-ink color-cream` с syntax-highlight (coral keywords, olive strings)
  - File-diff: + olive bg, − danger bg
  - Action-chip ("Wrote", "Updated"): warm cream pill с olive verb
- [ ] Chat input: compact 14px font, no glow (отличается от home prompt-card!), radius 14px, focus-ring coral
- [ ] Preview pane: top toolbar (refresh + URL + external + maximize) + iframe area
- [ ] Iframe: **без border, без radius, без shadow** — sits clean on background
- [ ] Mobile: chat/preview segmented toggle (см. [`mockups/mobile/editor.html`](mockups/mobile/editor.html))

### Phase 6 — Workspace (`/apps/[id]/workspace`)
- [ ] App header: logo + title + status + Deploy/Open-live buttons
- [ ] Tabs row: Overview / Data / Integrations / Code / Logs / API / Settings (см. [`mockups/desktop/workspace.html`](mockups/desktop/workspace.html))
- [ ] Active tab: coral text + coral underline
- [ ] Overview: 4-stat row + management cards grid (2-col) + activity feed
- [ ] Stat: eyebrow label + display-style number + delta indicator (success/danger)

### Phase 7 — Settings (`/settings`)
- [ ] Sub-nav vertical слева: Personal section (Profile/Account/Notifications/API keys) + Workspace section (Members/Billing/Integrations)
- [ ] Content справа: display-style page title + sub + sections-as-cards
- [ ] Каждая section-card: title + sub + rows (label + control)
- [ ] Save/Cancel actions внизу секции — separator + flex-end alignment

### Phase 8 — Billing / Pricing
- [ ] Можно как отдельный URL `/settings/billing` или как страницу с большим pricing layout
- [ ] 4 plan-cards horizontal: featured tier с `.plan-card--featured` (bg-ink, "Most popular" coral badge)
- [ ] FAQ accordion внизу — см. [`components/typography-states.md`](components/typography-states.md)

### Phase 9 — Auth / Onboarding
- [ ] Login page: centered card с logo + welcome h1 + OAuth buttons (Google, Apple) + divider + email input + primary "Continue" + signup link + footer
- [ ] No dedicated onboarding flow — главная сама работает как welcome (prompt-input + suggestions hint)

### Phase 10 — States
- [ ] 404 page: huge display-xl "404" + h1 "Not found" + sub + Go home button
- [ ] Empty states (inline в sidebar / page-level)
- [ ] Loading skeletons: `bg-cream animate-shimmer` базовый класс + concrete shapes (row/title/circle)
- [ ] Spinner для inline-loading
- [ ] Toast notifications (success / danger) — `bg-ink color-cream` базовый

## 6. Responsive behavior

| Breakpoint | Что меняется |
|---|---|
| **≥ 1024px** | Полный desktop layout, sidebar 240px, editor split chat+preview |
| **768–1023px** | Sidebar остаётся или ужимается до icons-only (56px); main padding 24px; editor split может стать stacked vertical |
| **< 768px** | **Sidebar → drawer** (hamburger top-left открывает overlay). Top-bar полная (logo + hamburger + avatar). Editor split → **chat/preview segmented toggle**. Apps grid → vertical list |
| **< 480px** | Hero title 28-32px (не 52). Prompt-card padding 12px. Suggestions horizontal scroll. Bottom-nav для основной навигации (как в [`mockups/mobile/home.html`](mockups/mobile/home.html)) |

## 7. Адаптированные градиенты

| Контекст | base44 оригинал | Sunbaked-версия |
|---|---|---|
| **Prompt-card glow** (главный brand visual) | `linear-gradient(#fff, #fff), radial-gradient(circle at 0% 100%, #FF6B21 0%, transparent 21%)` | `linear-gradient(var(--paper), var(--paper)), radial-gradient(circle at 0% 100%, var(--coral) 0%, transparent 24%)` |
| **Hero backdrop** (наш бонус, у base44 нет) | — | `radial-gradient(ellipse at 90% 0%, var(--cream) 0%, transparent 55%), var(--paper)` |
| **App-card preview placeholder** | (реальный screenshot) | `linear-gradient(135deg, var(--cream), var(--cream-deep))` (fallback когда нет thumbnail) |
| **CTA glow** (для emphatic buttons / featured plan) | — | `linear-gradient(135deg, var(--coral), var(--coral-deep))` + `box-shadow: var(--sh-coral)` |

CSS variable shortcuts уже определены в `tokens.css`:
- `var(--gradient-prompt-glow)`
- `var(--gradient-hero-backdrop)`
- `var(--gradient-app-card-preview)`
- `var(--gradient-cta-glow)`

## 8. Что НЕ копируем из base44

- Логотип base44, фирменные иллюстрации, маркетинговые тексты, товарные знаки
- Кастомные shadcn customizations (`--workspace-badge`, `--vscode-sash-*`) — заменены sunbaked-эквивалентами
- WixMadeforText шрифт — заменён на Geist (наш display: Fraunces — bonus, у них display'а вообще нет)
- Brand orange `#FF631F` — заменён на `--coral #E84E2F`

## 9. Acceptance criteria для имплементации

- [ ] Все цвета через CSS variables (нет хардкода hex кроме как в `tokens.css`)
- [ ] Все шрифты — Fraunces / Geist / Geist Mono (через Google Fonts)
- [ ] Главная страница, apps list, editor — визуально матчат соответствующие `mockups/desktop/*.html` (допустимое отклонение ±10% за счёт реального контента vs плейсхолдеров)
- [ ] Mobile-варианты home + editor рендерятся правильно на 375×812
- [ ] Все компоненты из `components/_inventory.md` либо использованы, либо явно отмечены как "skipped в этой итерации"
- [ ] Нет следов оригинальных base44-цветов в финальной сборке (`git grep` на `#FF631F`, `#18181B`, `WixMadeforText` ничего не находит)
- [ ] Адаптированные градиенты (prompt-glow, hero-backdrop) работают и выглядят как в мокапах

## 10. Ссылки

- **README пакета:** [`README.md`](README.md)
- **Design system источник:** [`../design-system-C1-sunbaked.html`](../design-system-C1-sunbaked.html)
- **Research spec:** [`../docs/superpowers/specs/2026-06-03-adorable-base44-redesign-research-design.md`](../docs/superpowers/specs/2026-06-03-adorable-base44-redesign-research-design.md)
- **Research plan:** [`../docs/superpowers/plans/2026-06-03-adorable-base44-redesign-research.md`](../docs/superpowers/plans/2026-06-03-adorable-base44-redesign-research.md)
