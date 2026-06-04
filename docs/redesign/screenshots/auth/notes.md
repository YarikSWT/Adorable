# Base44 — Auth (Login)

**URL:** `https://app.base44.com/login` (редирект с любой защищённой страницы без auth)

## Из bodyText (захвачен при первой навигации)

```
Welcome to Base44
Log in with Google
Log in with Apple
OR
Continue with email

Don't have an account? Sign up

Terms of Service and Privacy Policy.
```

## Структура

```
[Centered card (вероятно ~400px wide)]:
  [Logo + "Welcome to Base44"]
  [Button: "Log in with Google" (с G-иконкой)]
  [Button: "Log in with Apple" (с Apple-иконкой)]
  [Divider: "OR"]
  [Email input + "Continue with email" button]
  [Footer text: "Don't have an account? Sign up"]
  [Sub-footer: "Terms of Service and Privacy Policy"]
```

## Visual style (predict + observation)

- Background: probably gradient или solid `--paper`
- Card: centered, white bg, soft shadow, padding ~32-40px
- OAuth buttons: white bg + provider icon + label, full-width, ~44px height
- Divider: horizontal line with "OR" text in the middle
- Email input: standard shadcn input
- "Continue" button: primary (dark `zinc-900`) — full-width

## Не делали deep dive

Не logout'нились чтобы избежать риска потери токена (нам нужно ещё мокапы делать). Reconstruction из observation достаточен для mockup.

## Адаптация на sunbaked

- Background: `bg-paper` + (optional) subtle radial-gradient coral в углу для "warmth"
- Login card: `bg-paper border-cream-deep radius-lg shadow-2 padding-32`
- OAuth buttons: `bg-paper border-cream-deep` + icon + label, hover `bg-cream`
- Primary continue button: `bg-ink color-cream` (наш warm dark)
- Footer "Sign up" link: `color-coral-deep`

## Onboarding

Не наблюдали onboarding-flow (welcome tour) на залогиненом аккаунте — возможно был один раз при создании workspace, но потом скрыт. Для Adorable рекомендуется простой одностраничный onboarding: workspace name → role → first prompt suggestion.
