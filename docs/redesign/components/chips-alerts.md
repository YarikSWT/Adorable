# Chips, Badges, Alerts

## Chip / Badge (state-indicator)

Observed in base44:
- Workspace badge area uses `--workspace-badge: hsl(18, 27%, 93%)` ≈ `#F0E8DB` warm cream surface
- Pill action chips (Wrote / Generated image) — см. `chat.md`

### Sunbaked

```css
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: .04em;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--cream);
  color: var(--coral-deep);
  border: 1px solid var(--cream-deep);
}
.chip__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--coral); }

.chip--olive { background: var(--olive); color: white; border-color: transparent; }
.chip--olive .chip__dot { background: var(--cream); }

.chip--ink { background: var(--ink); color: var(--cream); border-color: transparent; }
.chip--ink .chip__dot { background: var(--coral); }

.chip--success { background: rgba(92,124,62,.12); color: var(--success); border-color: rgba(92,124,62,.3); }
.chip--warning { background: rgba(199,122,30,.12); color: var(--warning); border-color: rgba(199,122,30,.3); }
.chip--danger  { background: rgba(199,57,46,.12); color: var(--danger);  border-color: rgba(199,57,46,.3); }
```

## Badge (small numeric / dot)

```css
.badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--coral);
  color: white;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
}
.badge--dot {
  width: 8px; height: 8px;
  min-width: 8px;
  padding: 0;
}
```

## Alert banner (top of page)

base44 observed (top of every page):
> "We're aware of a technical issue affecting some services..."

Pattern: amber-ish (`#FEF3C7` / `#92400E` из audit) banner full-width с dismiss button.

### Sunbaked

```css
.alert-banner {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 24px;
  background: var(--cream-deep);    /* нейтральный warning bg */
  border-bottom: 1px solid var(--n-200);
  color: var(--n-700);
  font-size: 13px;
}
.alert-banner__icon { width: 16px; height: 16px; color: var(--warning); flex-shrink: 0; }
.alert-banner__content { flex: 1; }
.alert-banner__content a { color: var(--coral-deep); text-decoration: underline; }
.alert-banner__dismiss { background: transparent; border: 0; cursor: pointer; opacity: .6; }
.alert-banner__dismiss:hover { opacity: 1; }

.alert-banner--info    { background: rgba(74,107,138,.08); border-color: rgba(74,107,138,.3); }
.alert-banner--info    .alert-banner__icon { color: var(--info); }
.alert-banner--success { background: rgba(92,124,62,.10); border-color: rgba(92,124,62,.3); }
.alert-banner--success .alert-banner__icon { color: var(--success); }
.alert-banner--danger  { background: rgba(199,57,46,.10); border-color: rgba(199,57,46,.3); }
.alert-banner--danger  .alert-banner__icon { color: var(--danger); }
```

## Toast (transient notification)

Not directly observed but standard pattern.

```css
.toast {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 16px;
  background: var(--ink);
  color: var(--cream);
  border-radius: var(--r-md);
  box-shadow: var(--sh-3);
  max-width: 400px;
}
.toast__icon { width: 16px; height: 16px; flex-shrink: 0; }
.toast__content { flex: 1; }
.toast__title { font-size: 13px; font-weight: 600; }
.toast__message { font-size: 12px; color: var(--n-200); margin-top: 2px; }
.toast__close { background: transparent; border: 0; color: var(--n-300); cursor: pointer; }

.toast--success .toast__icon { color: var(--olive-soft); }
.toast--danger  .toast__icon { color: var(--coral-soft); }
```

## Tooltip

```css
.tooltip {
  padding: 6px 10px;
  background: var(--ink);
  color: var(--cream);
  border-radius: var(--r-sm);
  font-size: 12px;
  white-space: nowrap;
  box-shadow: var(--sh-2);
  /* positioned by JS or popper.js */
}
```
