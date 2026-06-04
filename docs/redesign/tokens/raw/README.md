# tokens/raw/

Сырые результаты JS-аудита (см. `../../_tools/audit.js`) base44 страниц.

## Состав

- **`01-home.json`** — главная страница (`https://app.base44.com/` = workspace dashboard). Содержит вычищенные и аннотированные данные.

## Почему только одна страница

Изначально план предполагал аудит 5 страниц (home / apps / app-detail / editor-preview / editor-workspace) с последующим merge'ем. При выполнении выяснилось:

1. **base44 — SPA** на Tailwind + shadcn/ui. Все CSS custom properties в `:root` (палитра, радиусы, тени, шрифты) **одинаковы на всех страницах** — определены глобально через `@layer base`.
2. **playwright-mcp filesystem isolated** — нельзя сохранить аудит в произвольный путь на host. Удалось получить только home page (через текстовый ответ + ручная Write).
3. Per-page различия касаются только частотных характеристик (usedColors / usedFontSizes / usedBoxShadows на конкретной странице) — эта информация дублируется тем, что мы собираем в `../../components/` через `component-extract.js` для конкретных селекторов.

## Что попало в финальный `../base44-extracted.json`

Поскольку home аудит уже включает все глобальные токены, `base44-extracted.json` (см. Phase F плана) собирается напрямую из `01-home.json` + per-component данных из `../../components/`.

## Ключевые находки (сводка для быстрого чтения)

- **Фреймворк:** Tailwind CSS v3 + shadcn/ui (HSL color tokens, `--radius: .5rem`, `--sidebar-*` series, `--chart-1..5`)
- **Шрифт:** `WixMadeforText` (400/500/600/700) — Wix-овский Inter-class. Fallback: `ui-sans-serif`.
- **Бренд:** `#FF631F` (coral-orange) — primary CTA. `#F54A00` — deep вариант (hover/active).
- **Warm touch:** `--workspace-badge: hsl(18, 27%, 93%)` ≈ `#F0E8DB` — единственный явно "тёплый" нейтрал в палитре. Уже близко к нашему `--cream-deep` `#E5D9BB`.
- **Surfaces:** `--background: #FFFFFF` (card), `--sidebar-background: hsl(0, 0%, 98%)` ≈ `#FAFAFA` (sidebar tone)
- **Text:** `--foreground: hsl(240, 10%, 3.9%)` ≈ `#09090B` (zinc-950), `--muted-foreground: hsl(240, 3.8%, 46.1%)` ≈ `#737378`
- **Borders:** `--border: hsl(240, 5.9%, 90%)` ≈ `#E4E4E7` (zinc-200)
- **Radius scale:** primary 8px (`.5rem`), secondary 6px, pills 9999px
- **Editor:** `--vscode-sash-size: 4px` — confirms VSCode-style split-pane resizer
- **Breakpoints:** 320 / 410 / 470 / 600 (max) / 640 / 768 / 1024 / 1200 / 1280 / 1400 / 1536 — стандартный Tailwind + Wix custom набор
