# Base44 — Onboarding

Не наблюдали активный onboarding-flow на текущем аккаунте (видимо, single-shot при регистрации workspace).

## Inferred patterns base44 на основе UX

На главной (`/`) есть **empty-state-ish prompting**:
- "What will you build next?" h1
- Большой prompt-input как primary CTA
- Suggestion pills как hint что builder умеет ("Tasks & Workflows", "CRM & Sales", ...)
- Sidebar "Favorite apps" empty state: "No favorite apps yet. Add your apps for quick access"

Это уже фактически onboarding — нет welcome-modal, просто пустые ёмкости с подсказками.

## Адаптация для Adorable

**Не делаем отдельный onboarding-flow.** Принимаем base44 паттерн:
- Главная всегда показывает prompt-input
- Sidebar секции имеют empty states с тёплым описанием
- Если хочется лёгкого onboarding: одна dismissible banner вверху main "👋 Welcome — try one of these prompts to start"

Этого достаточно. Спецификация в `spec.md` пометит "no dedicated onboarding screen".
