# Base44 — Editor + Preview (КЛЮЧЕВАЯ страница)

**URL:** `https://app.base44.com/apps/{id}/editor/preview`

## Структура (desktop 1440×900)

```
[Sidebar 250px | Editor area 1190px]
  Editor area:
    [Chat pane 336px | Resizer | Preview pane 854px (1065 iframe + padding)]
    Wait — math says: chat 336 + iframe 1065 = 1401, sidebar 250 = total 1651 > 1440
    Actual: viewport был 1280 при первой загрузке. Сейчас 1440 после resize.
    На 1440: chat ≈ 336px, iframe ≈ 1065px (заполняет всё оставшееся пространство)
```

**Split ratio:** chat 25% / preview 75% примерно. Resizable.

## Iframe (preview)
- **Размер:** `1065×746px` на 1440-viewport
- **Без border, без radius, без shadow** — clean window edge. Просто sits on background.
- Класс: `absolute w-full h-full transition-opacity duration-300 ease-in-out opacity-100 z-[5]`
- Wrapper использует absolute positioning + transition opacity (для swap'а iframe при reload)

## Chat input (внизу chat pane)
- **Wrapper:** 336×153px
  ```css
  background: #FFFFFF;
  border: 1px solid #E5E5E5;
  border-radius: 14px;
  overflow: hidden;
  /* md:shadow-none — на desktop без тени, на mobile может быть shadow */
  ```
- **Textarea внутри:**
  ```css
  padding: 16px 16px 0;     /* без bottom padding — там toolbar */
  font-size: 14px;          /* МЕНЬШЕ чем 16px на home */
  background: transparent;
  border: 0;
  border-radius: 8px 8px 0 0;
  resize: none;
  ```
- **Внизу wrapper** — toolbar (как на home prompt-card, но компактнее)

**Ключевое отличие от home prompt:**
- Home prompt: max-width 785px, radius 14px, **с coral-glow градиентом**, font-weight 100 (thin)
- Editor chat: max-width 336px (заполняет chat pane), radius 14px, **БЕЗ градиента**, font-weight 400, font-size 14px (vs 16)

## Chat messages
- Используют `prose dark:prose-invert max-w-none base44-markdown` 
- Font 14px, color `#09090B`
- Markdown rendered (заголовки, списки, code, blockquote)
- Custom CSS overrides через `base44-markdown` класс

## CSS layout (editor pane)
- На основании observation: chat pane имеет horizontal padding ~16-24px вокруг content
- Border между chat и preview — обычно нет visible border (resizable sash 4px из CSS var `--vscode-sash-size: 4px`)

## Что важно скопировать для Adorable

1. **Split-pane chat (~25%) + preview (~75%)** с draggable resizer
2. **Чистый iframe без оформления** — preview визуально "сам сайт", не "карточка-превью"
3. **Compact chat input внизу** — sticky, 14px font, no glow, simple card
4. **Markdown chat messages** через `prose` plugin Tailwind

## Адаптация на sunbaked

- Editor background: `var(--bg-page)` = `var(--paper)`
- Chat pane bg: `var(--bg-surface-alt)` (`--n-100` — slight contrast)
- Preview pane bg: `var(--bg-page)` (та же бумага)
- Resizer: `var(--border-default)` (`--cream-deep`)
- Chat input wrapper: `bg-paper`, `border 1px var(--border-default)`, `radius 14px`
- Iframe: clean, no decoration
- Chat messages: `prose-stone` theme + custom `chat-md` overrides

## Mobile

Не покрывали отдельно для mobile editor. На mobile логика будет: chat/preview toggle (segmented control), full-width активный pane. Документируем в mockups/mobile/editor.html.
