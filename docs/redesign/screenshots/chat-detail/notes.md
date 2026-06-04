# Base44 — Chat detail (типы сообщений)

Захвачено в контексте `04-editor-preview` (наблюдения из реальной чат-истории "Obsidian VPN" app).

## Типы сообщений наблюдаются

### 1. User message
- Avatar "YY" + role label
- Plain text
- Timestamp "5 hours ago"
- Compact, single bubble

### 2. Assistant message (base44 / Cursor-like)
- Role label "Base44"
- Markdown rendered content (через `prose dark:prose-invert max-w-none base44-markdown`)
- Может содержать:
  - **Plan-list** (структурированные пункты "Pages: ... / Visual direction: ... / Components: ...")
  - **Action chip "Wrote"** + filename (например "styles", "landing") — индикатор файла-результата
  - **Action chip "Generated image"** + title (например "Hero Texture", "Feature 1/2/3")

### 3. Tool/action chips inline
- "Wrote", "Generated image" — appearing inline в assistant message
- Каждый — компактный pill с иконкой + label типа объекта (filename / image title)
- Click-able (вероятно открывает diff/preview)

### 4. Code-block (не наблюдали напрямую в этом app, но есть в base44-markdown)
- Стандартный `<pre><code>` через prose + custom syntax highlighting
- Предположительно тёмный bg (`zinc-900` или `zinc-800`)
- Mono font (определим — вероятно ui-monospace или их кастомный)

### 5. File-diff (не наблюдали в captured app)
- Предположительно стандартный shadcn pattern: `+` зелёные / `-` красные строки на pale bg

### 6. Streaming indicator
- Не наблюдали (assistant уже всё ответил)
- Предположительно cursor (мигающий блок) в конце последнего assistant message

## CSS observation (assistant message)

```css
.base44-markdown {
  font-family: ui-sans-serif (inherits from prose);
  font-size: 14px;
  color: #09090B;
}
```

Width: 253-318px depending on message (chat pane width ~336px minus padding).

## Action chip "Wrote" / "Generated image" pattern

Не успели captured CSS точно, но из observation:
- Пилюля с иконкой + label
- Inline в потоке assistant text
- Click → opens preview

Адаптация: `bg-cream border-cream-deep radius-pill padding-xs/sm font-mono` (для technical look) или `bg-paper border + icon`.

## Адаптация на sunbaked

- User message bg: либо subtle outline (бескамерный, как у base44) либо `bg-n-100`
- Assistant role label: `text-coral-deep font-mono font-size-xs uppercase letter-spacing`
- Markdown content: используем `@tailwindcss/typography` с custom theme на сваш sunbaked vars
- Code-block: `bg-ink color-cream font-mono` (наш warm-dark вместо плоского zinc)
- Action chips: см. `components/chip.md` (Phase E)
