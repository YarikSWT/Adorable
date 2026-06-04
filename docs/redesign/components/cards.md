# Cards

## Generic card

Не captured напрямую в base44, но pattern (shadcn-style):
```css
background: var(--bg-surface);
border: 1px solid var(--border-default);
border-radius: var(--r-md);     /* 10px у нас, у них 8px */
padding: 20px;
box-shadow: var(--sh-1);
```

## App card (grid item on /apps)

base44 captured:
- Box: `349 × 182px` (3-col grid на ~1200px main)
- Background transparent (hover: shadow-lg + group effect)
- Structure: logo + title h3 (18/600) + action icons + description p (16/400 muted) + meta (small)

### Sunbaked

```css
.app-card {
  display: block;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--r-md);
  padding: 0;
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow .2s, transform .2s;
}
.app-card:hover {
  box-shadow: var(--sh-2);
  transform: translateY(-2px);
}
.app-card__preview {
  aspect-ratio: 16/9;
  background: linear-gradient(135deg, var(--cream), var(--cream-deep));
  /* fallback gradient — реально картинка превью */
}
.app-card__body { padding: 16px 20px 18px; }
.app-card__head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 8px; }
.app-card__logo {
  width: 36px; height: 36px;
  border-radius: var(--r-sm);
  background: var(--cream);
  flex-shrink: 0;
}
.app-card__title {
  font-family: var(--font-sans);
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
  /* line-clamp-2 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.app-card__actions { margin-left: auto; display: flex; gap: 4px; }
.app-card__desc {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.app-card__meta {
  display: flex; justify-content: space-between;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: .04em;
}
```

## Plan card (pricing)

base44 на /billing — горизонтальная 4-tier grid. Структура:
- Plan name h3 (24px / 700)
- Price block ($X / mo, большой)
- Stats (credits, integrations)
- CTA button "Get {name}"
- Highlights label
- Feature list (✓ bullet items)

### Sunbaked

```css
.plan-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--r-lg);
  padding: 28px 24px;
  display: flex; flex-direction: column;
  gap: 16px;
}
.plan-card--featured {
  background: var(--ink);
  color: var(--cream);
  border-color: var(--ink-2);
  position: relative;
}
.plan-card--featured::before {
  content: "Most popular";
  position: absolute;
  top: -12px; left: 24px;
  background: var(--coral);
  color: white;
  padding: 4px 12px;
  font-size: 11px;
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: .08em;
  border-radius: 999px;
}
.plan-card__name { font-family: var(--font-display); font-size: 24px; font-weight: 600; }
.plan-card__price {
  display: flex; align-items: baseline; gap: 4px;
}
.plan-card__price-amount { font-family: var(--font-display); font-size: 48px; font-weight: 500; }
.plan-card__price-currency { font-size: 18px; }
.plan-card__price-period { font-size: 14px; color: var(--text-muted); }

.plan-card__stats { display: flex; flex-direction: column; gap: 6px; }
.plan-card__stat { display: flex; justify-content: space-between; font-size: 14px; }
.plan-card__stat-num { font-family: var(--font-mono); font-weight: 600; }

.plan-card__cta { width: 100%; margin-top: 8px; }

.plan-card__features { display: flex; flex-direction: column; gap: 8px; }
.plan-card__feature {
  display: flex; gap: 8px; align-items: flex-start;
  font-size: 13px;
  color: var(--text-secondary);
}
.plan-card__feature::before {
  content: "✓";
  color: var(--olive);
  font-weight: 600;
}
.plan-card--featured .plan-card__feature { color: var(--n-200); }
.plan-card--featured .plan-card__feature::before { color: var(--coral-soft); }
```

## Upgrade card (sidebar bottom)

base44 captured:
- 226 × 56px
- `bg: #FBFAF7` (warm cream — единственное яркое тёплое место в base44)
- `border: 1px solid #E4E4E4`
- `border-radius: 8px`
- `padding: 12px`
- Content: "Upgrade your plan" h-text + "Get more out of your apps" muted-text + chevron-right

### Sunbaked

```css
.upgrade-card {
  display: flex; align-items: center; gap: 12px;
  background: var(--cream);
  border: 1px solid var(--cream-deep);
  border-radius: var(--r-sm);
  padding: 12px;
  text-decoration: none;
  color: var(--text-primary);
  cursor: pointer;
}
.upgrade-card:hover { background: var(--cream-deep); }
.upgrade-card__content { flex: 1; }
.upgrade-card__title { font-size: 13px; font-weight: 600; color: var(--ink); }
.upgrade-card__sub { font-size: 11px; color: var(--text-muted); }
.upgrade-card__icon { width: 14px; height: 14px; color: var(--coral); }
```
