# Typography & States

## Typography scale

base44 captured sizes (in actual use):
- 96px (404 hero)
- 48px (page h2 "Apps", "text-5xl")
- 38px (приблизительно, не captured напрямую)
- 35px (billing hero h1)
- 32px (home hero h1)
- 28px (приблизительно)
- 24px (workspace h1, plan card h3, FAQ h2)
- 18px (FAQ question h3, app-card title)
- 16px (body default, section h3)
- 14px (chat body, button text, secondary body)
- 13px (sidebar items)
- 12px (mono / metadata)
- 11px (chip)
- 10px (eyebrow / uppercase labels)

## Sunbaked type scale

```css
.t-display-xl { font-family: var(--font-display); font-size: clamp(60px, 8vw, 96px); font-weight: 500; line-height: 1.0; letter-spacing: -0.022em; font-variation-settings: "opsz" 144; color: var(--ink); }
.t-display-l  { font-family: var(--font-display); font-size: clamp(40px, 5vw, 56px); font-weight: 500; line-height: 1.05; letter-spacing: -0.018em; color: var(--ink); }
.t-display-m  { font-family: var(--font-display); font-size: 38px; font-weight: 500; line-height: 1.1; letter-spacing: -0.015em; color: var(--ink); }
.t-h1         { font-family: var(--font-sans); font-size: 26px; font-weight: 600; line-height: 1.2; letter-spacing: -0.01em; color: var(--ink); }
.t-h2         { font-family: var(--font-sans); font-size: 22px; font-weight: 600; line-height: 1.3; color: var(--ink); }
.t-h3         { font-family: var(--font-sans); font-size: 18px; font-weight: 600; color: var(--ink); }
.t-h4         { font-family: var(--font-sans); font-size: 16px; font-weight: 600; color: var(--ink); }
.t-body       { font-family: var(--font-sans); font-size: 15px; font-weight: 400; line-height: 1.6; color: var(--text-secondary); }
.t-body-sm    { font-family: var(--font-sans); font-size: 14px; line-height: 1.5; color: var(--text-secondary); }
.t-small      { font-family: var(--font-sans); font-size: 13px; color: var(--text-muted); }
.t-mono       { font-family: var(--font-mono); font-size: 12px; color: var(--coral-deep); }
.t-mono-olive { font-family: var(--font-mono); font-size: 12px; color: var(--olive-deep); }
.t-eyebrow    { font-family: var(--font-mono); font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--coral-deep); }
.t-label      { font-family: var(--font-mono); font-size: 11px; letter-spacing: .04em; }
```

### Display italic (наш sunbaked twist)

base44 нет italic display (только sans). Мы добавляем **Fraunces italic** для emphasized слов в display:
```css
.t-display-xl em,
.t-display-l em,
.t-display-m em {
  font-style: italic;
  font-weight: 500;
  color: var(--coral-deep);
}
.t-display-xl .olive-mark,
.t-display-l .olive-mark,
.t-display-m .olive-mark {
  font-style: italic;
  color: var(--olive-deep);
}
```

## 404 page

base44 captured:
- h1 "404" — 96px (massive)
- h2 "Page not found" — 24px
- Sub text + "Go home" button

### Sunbaked

```html
<div class="error-page">
  <h1 class="t-display-xl"><em>404</em></h1>
  <h2 class="t-h1">Страница не найдена</h2>
  <p class="t-body">Похоже, эта страница переехала или была удалена.</p>
  <a class="btn btn-primary" href="/">Вернуться на главную</a>
</div>
```

```css
.error-page {
  min-height: 100vh;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 16px;
  padding: 32px;
  text-align: center;
}
.error-page .t-display-xl { font-size: 120px; }
.error-page .t-display-xl em { color: var(--coral); font-style: italic; }
.error-page .t-body { max-width: 420px; }
.error-page .btn { margin-top: 16px; }
```

## Empty states

### In-context (inline в sidebar / list)
```css
.empty-inline {
  padding: 12px;
  text-align: center;
  color: var(--text-muted);
}
.empty-inline__title { font-size: 12px; font-weight: 500; color: var(--text-secondary); }
.empty-inline__sub { font-size: 11px; margin-top: 2px; }
```

### Page-level
```css
.empty-page {
  display: flex; flex-direction: column;
  align-items: center; gap: 12px;
  padding: 64px 32px;
  text-align: center;
}
.empty-page__icon { width: 48px; height: 48px; color: var(--n-400); }
.empty-page__title { font-family: var(--font-display); font-size: 24px; font-weight: 500; color: var(--ink); }
.empty-page__sub { font-size: 14px; color: var(--text-secondary); max-width: 360px; }
.empty-page .btn { margin-top: 8px; }
```

## Loading skeleton

```css
.skeleton {
  background: var(--cream);
  border-radius: var(--r-sm);
  position: relative;
  overflow: hidden;
}
.skeleton::after {
  content: "";
  position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.5), transparent);
  animation: skeleton-shimmer 1.5s infinite;
}
@keyframes skeleton-shimmer { from { transform: translateX(-100%); } to { transform: translateX(100%); } }

.skeleton-row    { height: 14px; }
.skeleton-title  { height: 20px; width: 60%; }
.skeleton-block  { height: 80px; }
.skeleton-circle { width: 40px; height: 40px; border-radius: 50%; }
```

## Spinner

```css
.spinner {
  width: 20px; height: 20px;
  border: 2px solid var(--cream-deep);
  border-top-color: var(--coral);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

## FAQ accordion (из billing)

```css
.faq {
  display: flex; flex-direction: column;
  gap: 8px;
}
.faq-item {
  border-bottom: 1px solid var(--border-default);
}
.faq-question {
  display: flex; justify-content: space-between; align-items: center;
  padding: 20px 4px;
  background: transparent;
  border: 0;
  font-family: var(--font-sans);
  font-size: 16px;
  font-weight: 500;
  color: var(--ink);
  cursor: pointer;
  text-align: left;
  width: 100%;
}
.faq-question__chevron {
  width: 16px; height: 16px;
  color: var(--text-muted);
  transition: transform .2s;
}
.faq-item.is-open .faq-question__chevron { transform: rotate(180deg); }
.faq-answer {
  padding: 0 4px 20px;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}
```
