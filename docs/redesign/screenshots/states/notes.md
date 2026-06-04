# Base44 — Empty / Loading / Error states

## 404 (Page not found)

Захвачен на `/account` и `/settings`. Те же URL — стандартный 404 шаблон base44.

```
[Centered]
h1 "404"  /* font-size: 96px (массивный!), weight bold */
h2 "Page not found"  /* font-size: 24px */
p "The page you're looking for doesn't exist or has been moved."  /* muted */
button "Go home" → /  /* primary */
```

CSS:
- h1: 96px (большой акцент)
- h2: 24px
- Layout: centered vertically + horizontally

## Empty state — favorite apps

Из sidebar на главной:
```
Favorite apps
↓ chevron (sees collapsed)
"No favorite apps yet."
"Add your apps for quick access"
```

Pattern: heading + 2-line muted text. Без иконки или CTA — inline в sidebar.

## Empty state — apps grid

Не наблюдали (в моём workspace есть apps). По умолчанию shadcn-like empty state predict:
```
[Centered]
[Icon (folder / sparkles) — ~48px]
[h3 "No apps yet"]
[p "Create your first app to get started" (muted)]
[button "Create New App" (primary)]
```

## Loading

Не наблюдали явный skeleton при загрузке editor (быстро). На preview page есть `iframe` с opacity-transition (300ms) — паттерн "swap iframe" вместо skeleton.

Predict patterns base44:
- Skeleton rows для список — `bg-zinc-100 animate-pulse rounded-md`
- Spinner overlay для loading модала — circular border-spinner
- Page-level loader — top-bar progress (Linear-like)

## Error states

Видели alert-banner на каждой странице:
```
"We're aware of a technical issue affecting some services. We're working to resolve it as quickly as possible. For updates, check our Status Page."
[Dismiss button]
```

Pattern: yellow/amber banner вверху (predict: `bg-amber-100 text-amber-800` — мы видели эти цвета в audit `#FEF3C7 / #92400E`).

## Адаптация на sunbaked

| State | Sunbaked стиль |
|---|---|
| 404 hero | h1 `Fraunces 120px italic` (тёплый display!), h2 `Geist 24` |
| Empty (in-context) | inline `t-small color-n-500` без иконки |
| Empty (page-level) | icon + h3 + muted text + primary button |
| Loading skeleton | `bg-cream animate-pulse radius-md` |
| Alert banner (warning) | `bg-cream-deep border-warning color-n-700` |
| Alert banner (error) | `bg-paper border-danger color-n-700` |
| Toast (success) | `bg-olive color-cream radius-md shadow-2` |
