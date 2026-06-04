# Base44 — App detail / Editor (без preview)

**URL:** `https://app.base44.com/apps/{id}`

**Важное наблюдение:** URL без `/editor/preview` ВСЁ РАВНО показывает редактор с chat-историей слева. Single-pane (без preview справа). Это значит:
- `/apps/{id}` = editor с chat (full-width chat)
- `/apps/{id}/editor/preview` = тот же editor + preview pane справа

В Adorable это значит — нет отдельной "app overview" страницы. Сразу editor.

## Структура

```
[Sidebar 250px (как на /) | Editor area]
  Editor area:
    [Top: app title h1 "Obsidian VPN" + workspace label]
    [Chat history (scrollable)]
      - User message (с timestamp "5 hours ago", avatar "YY")
      - Assistant message ("Base44", markdown response)
      - ... ~14 message blocks
    [Chat input fixed bottom — как на main / но без gradient glow?]
```

## CSS observations

- Page h1 "Obsidian VPN": `text-2xl font-bold text-gray-900` = 24px / 700 / `#111827`
  - **WARNING**: использует `ui-sans-serif` fallback, не `WixMadeforText` — возможно legacy block внутри editor
- Chat message blocks (`prose dark:prose-invert base44-markdown`):
  - `font-size: 14px`, color `#09090B`
  - Используют tailwind `@tailwindcss/typography` (`prose` class) + custom `base44-markdown` стили
  - Width: variable (253-318px depending on speaker — user messages могут быть уже)
- Action icons в messages: round button 24x24, `rounded-full` (9999px), padding 4px, hover `bg-black/10`

## UX-паттерны

- **Markdown в чате через Tailwind Typography** — это значит готовые семантические стили (p, h1-h6, ul, code, blockquote)
- **`base44-markdown` overrides** — base44 имеет свой набор customizations над `prose` (стиль code-blocks, link colors, и тп)
- **Round close/dismiss buttons** — 24x24 в верхнем-правом углу некоторых блоков (toast-like dismissals)

## Адаптация

- Chat message block: `prose-stone` или `prose-slate` тема → custom CSS для нашей палитры (text-ink на paper)
- `base44-markdown` равно нашему набору `.chat-md` правил в shared.css (определим в Phase G)
- App title h1 в editor header: `WixMadeforText 24px / 600 / var(--ink)` (привести к нашему шрифту)

## Скриншоты

PNG недоступны. Подробное содержимое чата извлекается на странице `04-editor-preview/` (та же страница + preview pane).
