# Chat (messages, input, code-block, action-chip)

## Chat input (compact, в editor — НЕ home prompt-card)

base44 captured:
- Wrapper: 336×153px (заполняет chat pane)
- `bg: #FFFFFF`, `border: 1px solid #E5E5E5`, `border-radius: 14px`
- No shadow on desktop (`md:shadow-none`)
- Textarea внутри: padding `16px 16px 0`, font 14px, weight 400
- Toolbar внизу (icons + send-button)

## Home prompt-card (большая, с brand glow!)

base44 captured (main feature, отдельный от chat-input):
- Wrapper: 719×157px, max-width 785px, centered
- `border-radius: 14px`
- **GRADIENT background:**
  ```css
  background:
    linear-gradient(rgb(255,255,255), rgb(255,255,255)),
    radial-gradient(circle at 0% 100%, rgb(255,107,33) 0%, rgba(0,0,0,0) 21%);
  ```
- `box-shadow: 0 16px 30px rgba(0,0,0,.04)` — soft
- Textarea: font-weight **100** (very thin!), font 16px

### Sunbaked адаптация prompt-card (с переведённым градиентом)

```css
.prompt-card {
  position: relative;
  max-width: 785px;
  margin: 0 auto;
  background:
    linear-gradient(var(--paper), var(--paper)),
    radial-gradient(circle at 0% 100%, var(--coral) 0%, transparent 21%);
  border: 1px solid transparent;
  border-radius: 14px;
  box-shadow: var(--sh-2);
  overflow: hidden;
}
.prompt-card__textarea {
  width: 100%;
  min-height: 80px;
  padding: 16px 24px 8px;
  font-family: var(--font-sans);
  font-size: 16px;
  font-weight: 300;  /* light, не такой thin как у base44 (100 слишком — Geist начинается с 300) */
  line-height: 1.5;
  background: transparent;
  border: 0;
  outline: none;
  resize: none;
  color: var(--text-primary);
}
.prompt-card__textarea::placeholder { color: var(--text-muted); }
.prompt-card__toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 12px 8px;
}
.prompt-card__toolbar-spacer { flex: 1; }
.prompt-card__model {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}
.prompt-card__send {
  width: 36px; height: 36px;
  border-radius: 50%;  /* base44 has square; мы делаем круглый для brand glow */
  background: var(--coral);
  color: white;
  display: flex; align-items: center; justify-content: center;
  box-shadow: var(--sh-coral);
  border: 0;
  cursor: pointer;
}
.prompt-card__send:hover { background: var(--coral-deep); }
.prompt-card__send[disabled] { background: var(--n-300); color: rgba(255,255,255,.5); box-shadow: none; cursor: not-allowed; }
```

## Suggestion pill (под prompt-card)

base44 captured:
```css
height: 36px;
padding: 0 12px;
background-color: rgba(255,255,255,0.69);
border-radius: 8px;
font-family: WixMadeforText;
font-size: 14px;
font-weight: 500;
color: #0A0A0A;
/* hover: bg white + shadow-sm */
```

### Sunbaked

```css
.suggestion {
  display: inline-flex; align-items: center;
  height: 36px;
  padding: 0 14px;
  background: var(--cream);
  border: 1px solid var(--cream-deep);
  border-radius: var(--r-sm);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
  cursor: pointer;
  transition: all .15s;
}
.suggestion:hover {
  background: var(--bg-surface);
  color: var(--coral-deep);
  border-color: var(--coral);
  box-shadow: var(--sh-1);
}
```

## User message

base44 observed — `prose dark:prose-invert max-w-none base44-markdown`, font 14px, color `#09090B`. User messages narrower (~253px width).

Pattern (не captured точно — Cursor/Bolt-style):
- Right-aligned bubble
- Compact padding
- Avatar к левому краю bubble
- Timestamp слева под content

### Sunbaked

```css
.chat-msg-user {
  display: flex; gap: 12px; align-items: flex-start;
  padding: 16px 20px;
  background: var(--cream);   /* warm user-bubble */
  border-radius: var(--r-md);
  max-width: 90%;
  margin-left: auto;
}
.chat-msg-user__avatar {
  width: 28px; height: 28px;
  border-radius: 50%;
  background: var(--olive);
  color: white;
  font-size: 11px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.chat-msg-user__body { font-size: 14px; color: var(--text-primary); line-height: 1.5; }
.chat-msg-user__time {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 4px;
}
```

## Assistant message

base44 observed — full-width pattern, role label "Base44" сверху, markdown body via `prose` plugin.

### Sunbaked

```css
.chat-msg-assistant {
  display: flex; flex-direction: column;
  gap: 8px;
  padding: 16px 0;
}
.chat-msg-assistant__role {
  display: flex; align-items: center; gap: 8px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--coral-deep);
  text-transform: uppercase;
  letter-spacing: .12em;
}
.chat-msg-assistant__role::before {
  content: "";
  width: 16px; height: 2px;
  background: var(--coral);
  border-radius: 1px;
}
.chat-msg-assistant__body.chat-md {
  /* prose-like markdown styling — см. ниже */
}
```

## Markdown content (`.chat-md` — наш аналог `base44-markdown`)

```css
.chat-md { color: var(--text-primary); font-size: 14px; line-height: 1.6; }
.chat-md > * + * { margin-top: 12px; }
.chat-md h1, .chat-md h2, .chat-md h3 { font-family: var(--font-sans); font-weight: 600; color: var(--ink); }
.chat-md h2 { font-size: 18px; margin-top: 24px; }
.chat-md h3 { font-size: 16px; margin-top: 20px; }
.chat-md p { font-size: 14px; }
.chat-md ul, .chat-md ol { padding-left: 24px; }
.chat-md li + li { margin-top: 6px; }
.chat-md a { color: var(--coral-deep); text-decoration: underline; }
.chat-md strong { color: var(--ink); font-weight: 600; }
.chat-md em { font-style: italic; color: var(--coral-deep); }
.chat-md code:not(pre code) {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--cream);
  color: var(--coral-deep);
  padding: 1px 6px;
  border-radius: 4px;
}
.chat-md pre {
  background: var(--ink);
  color: var(--cream);
  padding: 16px;
  border-radius: var(--r-sm);
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
}
.chat-md pre code { color: inherit; background: transparent; padding: 0; }
.chat-md blockquote {
  border-left: 3px solid var(--coral);
  padding-left: 16px;
  color: var(--text-secondary);
  font-style: italic;
}
```

## Action chip ("Wrote", "Generated image", etc — inline в assistant message)

base44 observed paterns — компактные pills с label + file/image title.

```css
.action-chip {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  background: var(--cream);
  border: 1px solid var(--cream-deep);
  border-radius: var(--r-sm);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all .15s;
}
.action-chip:hover {
  border-color: var(--coral);
  color: var(--coral-deep);
}
.action-chip__verb {
  font-weight: 600;
  color: var(--olive-deep);
  text-transform: uppercase;
  letter-spacing: .06em;
}
.action-chip__icon { width: 12px; height: 12px; }
```

## Code-block (внутри markdown — детали)

См. `.chat-md pre` выше. Дополнения для filename / copy button:

```css
.code-block { position: relative; }
.code-block__header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 12px;
  background: var(--ink-2);
  color: var(--n-300);
  font-family: var(--font-mono);
  font-size: 11px;
  border-radius: var(--r-sm) var(--r-sm) 0 0;
}
.code-block__lang { color: var(--coral-soft); }
.code-block__copy {
  background: transparent; border: 0; color: var(--n-300);
  font-size: 11px; cursor: pointer;
}
.code-block__copy:hover { color: var(--cream); }
.code-block pre {
  margin: 0;
  border-radius: 0 0 var(--r-sm) var(--r-sm);
}
```

## Streaming indicator

```css
.streaming-cursor {
  display: inline-block;
  width: 8px; height: 16px;
  background: var(--coral);
  vertical-align: text-bottom;
  animation: cursor-blink 1s steps(2) infinite;
  margin-left: 2px;
}
@keyframes cursor-blink { to { opacity: 0; } }
```

## File-diff (inferred — не observed)

```css
.file-diff {
  background: var(--cream);
  border: 1px solid var(--cream-deep);
  border-radius: var(--r-sm);
  font-family: var(--font-mono);
  font-size: 11px;
  overflow: hidden;
}
.file-diff__filename {
  padding: 6px 12px;
  background: var(--cream-deep);
  color: var(--ink);
  font-size: 11px;
  font-weight: 600;
}
.file-diff__line {
  display: flex;
  padding: 0 12px;
  white-space: pre;
}
.file-diff__line--add { background: rgba(92, 124, 62, .15); }    /* olive-tinted green */
.file-diff__line--add::before { content: "+"; color: var(--success); padding-right: 8px; }
.file-diff__line--remove { background: rgba(199, 57, 46, .12); }  /* danger-tinted red */
.file-diff__line--remove::before { content: "−"; color: var(--danger); padding-right: 8px; }
```
