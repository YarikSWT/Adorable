# Base44 — Editor / Workspace overview

**URL:** `https://app.base44.com/apps/{id}/editor/workspace/overview`

**Что это:** Workspace tab внутри editor — set of cards для управления приложением (visibility, users, platform badge, etc).

## Структура

```
[Sidebar 250px | Workspace area]
  Workspace area (полная ширина без preview):
    [App header: h1 "Obsidian VPN" (24px/700)]
    [Workspace tabs row: Overview | Data | Integrations | Code | Logs | API | Settings]
    [Grid of management cards (по секциям):]
      - "App Visibility" card
      - "Invite Users" card
      - "Move to Workspace" card
      - "Platform Badge" card
      - ... другие settings
```

## Tabs

7 табов: **Overview / Data / Integrations / Code / Logs / API / Settings**

Reach tab — кнопка (не link), значит state-driven (не URL routing для каждой).

Adorable equivalent: workspace tabs можно урезать до **Overview / Files / Deployments / Settings** (4 типичных для bolt-like редактора).

## Headings

- **App title h1:** 24px / weight-700, color `#111827` (gray-900)
- **Card title h3:** 16px / weight-600, color foreground (`#09090B`)
- **Small label h3 (в sidebar возможно):** 14px / weight-500

## Card pattern (для управления)

Каждая management-card имеет:
- h3 заголовок (16px/600)
- Описание (paragraph)
- Action или toggle справа
- Все на белом bg с border (типичный shadcn card)

## UX

- **Tabs внутри editor area** — не сверху страницы, а под header'ом приложения. Управление как Settings в Linear / Notion workspace.
- **Cards stack vertically** — каждая занимает full width workspace area
- **Cohesive с Settings UX** — этот workspace overview = облегчённый settings, специфичный для текущего app

## Адаптация на sunbaked

- Tabs: используем sub-nav стиль из shared.css (border-bottom + active underline)
- Card: `bg-paper border-cream-deep radius-md`
- App title h1: `WixMadeforText → Geist 24px / 600 / var(--ink)` (нашему шрифту)
- Section h3: `Geist 16px / 600 / var(--ink)`
