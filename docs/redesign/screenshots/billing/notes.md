# Base44 — Billing / Pricing

**URL:** `https://app.base44.com/billing`

## Структура

```
[Sidebar (тот же что на /)]
[Main:]
  [Hero h1: "Choose the plan that's right for you" — 35px/400, centered]
  [Sub: "Base44 is part of" + Wix logo + "Trusted by 250M+ people worldwide"]
  [Plans grid — 4 tier cards horizontally: Starter / Builder / Pro / Elite]
    Каждая plan-card:
      - Plan name h3 (24px/700) — "Elite" / "Pro" / "Builder" / "Starter"
      - Price block: "$160 / mo" (large)
      - Stat lines: "1.2k Monthly credits/mo", "50k Integration credits/mo"
      - CTA button (dark/full-width): "Get Elite" / "Get Pro" / etc
      - "Plan highlights:" label
      - Feature list (✓ Unlimited apps, ✓ Unlimited collaborators, ...)
  [Enterprise section h3 "Base44 for Enterprise" — отдельная карта/CTA]
  [FAQ section h2 "Frequently Asked Questions"]
    Аккордеон с h3 questions (18px/500):
      - What is Base44?
      - What's included in the free plan?
      - What are integration credits?
      - What types of applications can I build with Base44?
      - Who owns the applications created with Base44?
      - How are Base44 applications deployed?
      - What happens if I reach my plan limits?
```

## Типографика

- **Hero h1:** 35px / weight-400 (light для landing-стиля!)
- **Plan h3:** 24px / weight-700 (bold!)
- **FAQ h2:** 24px / weight-600
- **FAQ question h3:** 18px / weight-500

## UX

- **4 pricing-tier cards** horizontally — стандартный SaaS pricing
- **Pricing page доступен в-приложении** (не отдельный marketing-сайт)
- **Wix branding mention** — base44 это часть Wix, упоминается на pricing
- **FAQ внизу** — стандартный shadcn-style accordion

## Адаптация на sunbaked

- Plan card: `bg-paper border-cream-deep radius-lg padding-24`, highlight tier: `bg-ink color-cream` (negative space treatment)
- CTA button в plan: primary (наш `bg-coral` для recommended tier; `bg-ink` для остальных)
- FAQ accordion: shadcn pattern (chevron + content collapse)
