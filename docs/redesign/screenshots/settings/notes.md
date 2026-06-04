# Base44 — Settings / Account

**URL:** `/settings` и `/account` оба возвращают 404 — base44 не имеет глобальных user-settings страниц.

## Где живут настройки base44

1. **Workspace switcher** в sidebar — все настройки воркспейса (members, plan, integrations) — через клик на "Yw" workspace dropdown
2. **App-level settings** — `/apps/{id}/editor/workspace/overview` (см. `05-editor-workspace/notes.md`) — 7 табов с настройками конкретного app
3. **Billing** — отдельный URL `/billing` (см. соседний файл)
4. **User avatar** в sidebar (нижний правый) → dropdown с personal settings (predict, нужно кликнуть для подтверждения)

## 404 page (bonus)

```css
/* h1 */
font-size: 96px;
font-weight: ?; /* assumed bold */
color: foreground;

/* h2 */
font-size: 24px;
font-weight: ?;
```

Sub: "The page you're looking for doesn't exist or has been moved."

Button "Go home" — primary button → `/`

## Адаптация для Adorable

Adorable обычно имеет:
- `/settings` page с vertical sub-nav: Profile / Account / Billing / Notifications / API Keys
- В нашем случае — повторяем этот паттерн, не копируя base44 (у них settings разбросаны)

## Mockup recommendation

`mockups/desktop/settings.html` — vertical sub-nav слева + content справа:
- Sub-nav items: Profile / Account / Billing / Notifications / API Keys / Integrations
- Content для Profile (default): avatar + name input + email input + bio textarea + Save button
