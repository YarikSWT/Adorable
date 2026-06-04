# Component Inventory

Каждый раздел — отдельный файл с computed CSS из base44 + sunbaked-маппингом. Файлы консолидированы по семьям (вместо 1-файл-на-компонент), чтобы спека была overview'абельна.

## Файлы

| Файл | Что внутри |
|---|---|
| [layout.md](layout.md) | app-shell, sidebar, top-bar, editor-split, tabs, modal, workspace-switcher |
| [buttons-inputs.md](buttons-inputs.md) | Button variants (primary/secondary/ghost/icon/send/view-toggle), input, search, textarea, toggle/switch |
| [cards.md](cards.md) | Generic card, app-card (grid item), plan-card (pricing), upgrade-card (sidebar) |
| [chat.md](chat.md) | User/assistant message, chat-input, code-block, action-chip ("Wrote", "Generated image"), streaming indicator |
| [chips-alerts.md](chips-alerts.md) | Chip/badge, alert banner (warning/error), toast |
| [typography-states.md](typography-states.md) | Type scale (display/h1-h3/body/small/mono), empty/loading/error/404 states |

## Source data

Computed CSS взят из:
- `screenshots/01-home/notes.md` — sidebar, prompt-card, suggestion pills, app-card-mini
- `screenshots/02-apps-list/notes.md` — buttons (primary/secondary), search, filter, view-toggle, app-card
- `screenshots/03-app-detail/notes.md` — chat message structure (prose)
- `screenshots/04-editor-preview/notes.md` — chat-input wrapper, iframe wrapper
- `screenshots/05-editor-workspace/notes.md` — workspace tabs, h1/h3 spec
- `screenshots/billing/notes.md` — plan-card, hero h1, FAQ accordion
- `screenshots/states/notes.md` — 404, empty, alert banner
- `tokens/raw/01-home.json` — палитра/радиусы/шрифты глобально

## Mapping principle

| base44 token | sunbaked token | Reason |
|---|---|---|
| `--background` (white) | `--paper` (#FBF7EC) | warm bumaga вместо flat white — главный character наш |
| `--foreground` (#09090B) | `--ink` (#2A2419) | warm dark вместо плоского zinc |
| `--muted-foreground` (#71717A) | `--n-500` (#5C5240) | warm muted |
| `--border` (#E4E4E7) | `--cream-deep` (#E5D9BB) | warm border |
| `--primary` (zinc-900) | `--ink` (для dark buttons) | warm ink |
| brand orange `#FF631F` | `--coral` (#E84E2F) | наш coral на месте их orange |
| warm cream `#FBFAF7` | `--paper` (наш) или `--cream` (#F3EBD7) | в зависимости от контраста |
| `--workspace-badge` (#F0E8DB) | `--cream-deep` (#E5D9BB) | warm accent surface |
| `--radius` (.5rem = 8px) | `--r-md` (10px) или `--r-sm` (6px) | наш scale чуть больше |
| Tailwind `shadow-sm/md/lg` | `--sh-1/2/3` | наши shadow scale |
| `WixMadeforText` (sans) | `Geist` | наш display-friendly sans |
| `ui-monospace` | `Geist Mono` | наш mono |
| (display не было — base44 sans-only) | `Fraunces` | мы добавляем display serif для hero/title (наш twist) |

## Что НЕ копируем

- `--vscode-sash-*` — мы реализуем resizer проще (CSS-based, без VSCode lib)
- `--chart-1..5` (recharts theme) — заменим на coral/olive/cream-deep серию когда нужно
- `--ring` (focus-ring синий) — заменим на `rgba(coral,.15)` (наш warm focus)
