# SWAP → Sunbaked — done ✅

**Статус:** свап выполнен. Мокапы сейчас в **stage v3 — sunbaked** (Vibeli design system colors + Geist/Fraunces + warm tones).

История стейджей:
- **v1** (`_sunbaked-draft-v1/`) — первая попытка без визуального референса. Архив.
- **v2 stage-base44** — мокапы 1:1 replicas структуры base44 (orange + Inter + cold zinc). См. git history `bab4306^`.
- **v3 sunbaked** ← мы сейчас здесь.

## Что было сделано в v2→v3 свапе (commit `bab4306` + следующий)

### `shared.css` — заменён `:root` блок токенов

| Что | base44 stage (v2) | sunbaked stage (v3) |
|---|---|---|
| `--brand` | `#FF631F` (orange) | `var(--coral)` = `#E84E2F` |
| `--brand-deep` | `#F54A00` | `var(--coral-deep)` = `#B83A1F` |
| `--bg-page` | `#FFFFFF` | `var(--paper)` = `#FBF7EC` (warm cream) |
| `--bg-surface` | `#FFFFFF` | `var(--paper)` |
| `--bg-surface-alt` | `#FAFAFA` (sidebar) | `var(--n-100)` = `#F0E8D2` |
| `--bg-muted` | `#F4F4F5` | `var(--cream)` = `#F3EBD7` |
| `--bg-warm` | `#FBFAF7` (upgrade card) | `var(--cream)` |
| `--bg-workspace-pill` | `#F0E8DB` | `var(--cream-deep)` = `#E5D9BB` |
| `--text-primary` | `#09090B` (zinc-950) | `var(--ink)` = `#2A2419` (warm dark) |
| `--text-secondary` | `#71717A` | `var(--n-500)` = `#5C5240` |
| `--text-muted` | `#A8A29E` | `var(--n-400)` = `#8B7F62` |
| `--text-inverse` | `#FAFAFA` | `var(--cream)` |
| `--border-default` | `#E4E4E7` (zinc-200) | `var(--cream-deep)` = `#E5D9BB` |
| `--border-muted` | `#E5E5E5` | `var(--cream-deep)` |
| `--border-dashed` | `#D6D3D1` (stone-300) | `var(--n-300)` = `#BFB290` |
| `--action-primary` | `#18181B` (zinc-900) | `var(--ink)` = `#2A2419` |
| `--action-primary-hover` | `#27272A` | `var(--ink-2)` = `#3A3327` |
| `--success` | `#16A34A` | `#5C7C3E` (olive-tinted) |
| `--danger` | `#EF4444` | `#C7392E` (coral-tinted) |
| `--warning-text` | `#92400E` (amber-800) | `#C77A1E` |
| `--font-sans` | `'Inter'` | `'Geist', -apple-system, ...` |
| `--font-mono` | `ui-monospace` | `'Geist Mono', ...` |
| `--font-display` | — (n/a, sans only) | `'Fraunces', Georgia, serif` ← наш bonus |
| `--sh-sm/md/lg` | `rgba(0,0,0,X)` | `rgba(42,36,25,X)` (warm ink shadows) |
| `--focus-ring` | `rgba(59,130,246,.5)` (TW blue) | `rgba(232,78,47,.15)` (coral) |
| `--sh-coral` | — | `0 8px 24px rgba(232,78,47,.22)` ← bonus |

Также добавлены sunbaked base palette переменные (`--coral`, `--olive`, `--cream`, `--paper`, etc) на которые ссылаются alias'ы выше — для дальнейшего использования напрямую.

### HTML мокапы

- Все 7 HTML файлов — заменён `<link>` Google Fonts с Inter на `Fraunces + Geist + Geist Mono`
- `desktop/home.html` + `desktop/editor.html` + `mobile/home.html` — обновлён inline radial-gradient на сoral→cream sunset
- `desktop/home.html` hero h1 — переведён на `var(--font-display)` (Fraunces) с italic accents:
  ```html
  <h1>What will you <em>build</em> <span class="olive-mark">next?</span></h1>
  ```
  где `em` = coral-deep italic, `.olive-mark` = olive-deep italic
- `desktop/editor.html` preview-mock h1 — Fraunces 48px с italic в "ипотечной"

### `shared.css` — внутри-стиля inline color updates

- `.sb-workspace-badge` — color `#7B5C32` → `var(--olive-deep)`
- `.sb-upgrade:hover` — `#F5F0E7` → `var(--cream-deep)`

## Что НЕ менялось

- HTML структура (layouts, классы, иерархия) — vector identical
- Размеры (px, gaps, paddings, heights, widths) — тот же spacing scale
- Иконки (Lucide через CDN) — те же
- Hover/active/focus поведение — тот же
- Component selectors (`.btn`, `.sb-card`, `.app-card`, etc.) — те же

## Refine pass (после initial swap)

Дополнительно подкручено для лучшей атмосферы:
- Hero gradient soft-pass: добавлены промежуточные тёплые ступени (`#F2A788`, `#F1C5A8`) между coral-soft и cream — закат стал плавнее, peak менее агрессивен
- Hero и Preview h1 — Fraunces с opsz 144 + italic emphases

## Если нужно откатиться к base44 stage

```bash
git checkout bab4306^ -- platform-design/adorable-redesign/mockups/
```

Это вернёт состояние перед swap'ом. Или просто посмотреть в архиве `_sunbaked-draft-v1/` — но это **первая** (визуально неудачная) версия, а не v2 base44 stage.

## Файлы

- `shared.css` — содержит и tokens (:root), и component primitives
- `desktop/{home,editor,apps-list,workspace,settings}.html` — 5 desktop screens
- `mobile/{home,editor}.html` — 2 mobile screens
- `_sunbaked-draft-v1/` — архив v1 (первая попытка)
