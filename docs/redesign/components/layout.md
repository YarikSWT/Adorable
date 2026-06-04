# Layout & Navigation

## App shell

```
[Sidebar 250px | Main fluid]
```

### CSS (base44 — captured)

Sidebar `<aside>`:
```css
width: 250px;
height: 100%;
background-color: #FFFFFF;
padding: 12px;
gap: 12px;
display: flex;
flex-direction: column;
font-family: WixMadeforText, system-ui, sans-serif;
font-size: 16px;
line-height: 24px;
overflow: hidden;
flex-shrink: 0;
```
Classes: `flex-shrink-0 flex flex-col h-full w-full bg-white font-base44 overflow-hidden p-3 gap-3`

Main: fluid, paddding 24-40px по контексту.

### Sunbaked версия

```css
.app-shell {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-height: 100vh;
}
.sidebar {
  background: var(--bg-surface-alt);  /* var(--n-100) — slight warm contrast */
  border-right: 1px solid var(--border-default);
  padding: 12px;
  gap: 12px;
  display: flex;
  flex-direction: column;
  font-family: var(--font-sans);
}
.main {
  padding: 24px 32px;
  background: var(--bg-page);
  overflow: auto;
}
@media (max-width: 768px) {
  .app-shell { grid-template-columns: 1fr; }
  .sidebar { display: none; }  /* drawer mode */
}
```

## Workspace switcher (sidebar top)

base44 captured:
```css
width: 100%;          /* fills sidebar padded area */
height: 40px;
padding: 8px;
gap: 6px;
border: 1px solid #E4E4E7;  /* zinc-200 */
border-radius: 8px;
background: transparent;
font-size: 16px;
font-weight: 400;
/* hover: bg #FAFAFA (zinc-50) */
```

Структура: `[avatar 24×24] [name span] [chevron icon]`

### Sunbaked

```css
.workspace-switcher {
  width: 100%;
  height: 40px;
  padding: 8px;
  gap: 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  cursor: pointer;
}
.workspace-switcher:hover { background: var(--cream); }
.workspace-switcher__avatar {
  width: 24px; height: 24px; border-radius: 6px;
  background: var(--olive);  /* warm avatar */
  color: white;
  font-size: 11px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
}
```

## Sidebar items (nav)

Pattern (из observation):
- `display: flex; align-items: center; gap: 10px;`
- `padding: 8px 12px;`
- `border-radius: 8px;`
- `font-size: 13-14px;`
- Default: `color: var(--text-secondary)`, transparent bg
- Hover: `color: var(--text-primary)`, `bg: var(--cream)`
- Active: `bg: var(--cream)`, `color: var(--coral-deep)`, font-weight 500, **+3px left accent stripe coral**

```css
.sidebar-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px;
  border-radius: var(--r-sm);
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  position: relative;
}
.sidebar-item:hover { background: var(--cream); color: var(--text-primary); }
.sidebar-item.is-active {
  background: var(--cream);
  color: var(--coral-deep);
  font-weight: 500;
}
.sidebar-item.is-active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 16px;
  background: var(--coral);
  border-radius: 2px;
}
.sidebar-item__icon { width: 16px; height: 16px; flex-shrink: 0; }
```

## Top bar (within main)

Не было заметного фиксированного top-bar в base44 — на home/apps управление-кнопки идут вместе с заголовком h2 / h1. Для Adorable можно сделать слабую top-bar:

```css
.top-bar {
  display: flex; align-items: center; gap: 12px;
  padding: 16px 32px;
  border-bottom: 1px solid var(--border-default);
  background: var(--bg-page);
}
```

## Editor split-pane

base44 captured:
- Chat pane ~336px
- Iframe pane 1065px (на 1440 viewport, minus 250 sidebar = 1190 editor area; ratio ~28% / ~72%)
- Resizable (vscode-sash 4px)

### Sunbaked

```css
.editor-split {
  display: grid;
  grid-template-columns: minmax(280px, 33%) 4px 1fr;  /* chat | resizer | preview */
  height: 100%;
}
.editor-split__chat {
  background: var(--bg-surface-alt);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.editor-split__resizer {
  background: var(--border-default);
  cursor: col-resize;
}
.editor-split__resizer:hover { background: var(--coral-soft); }
.editor-split__preview {
  background: var(--bg-page);
  overflow: hidden;
}

@media (max-width: 768px) {
  .editor-split { grid-template-columns: 1fr; }
  .editor-split__resizer { display: none; }
  /* Toggle chat/preview via .is-mobile-chat / .is-mobile-preview class */
}
```

## Tabs (workspace tabs / sub-nav)

Не captured CSS точно, но из observation — кнопки сверху workspace area, без явных borders. Standard pattern:

```css
.tabs {
  display: flex; gap: 4px;
  border-bottom: 1px solid var(--border-default);
}
.tab {
  padding: 10px 14px;
  font-size: 14px; font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  position: relative;
  top: 1px;  /* перекрывает border-bottom */
}
.tab:hover { color: var(--text-primary); }
.tab.is-active {
  color: var(--coral-deep);
  border-bottom-color: var(--coral);
}
```

## Modal / Dialog overlay

Из observation cookie-banner внизу — `role="dialog"` стандартный shadcn. Patterns:

```css
.modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(42, 36, 25, .4);  /* warm ink с прозрачностью */
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
.modal {
  background: var(--bg-surface);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-3);
  padding: 24px;
  max-width: 480px;
  width: calc(100% - 32px);
}
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.modal-title { font-family: var(--font-display); font-size: 20px; font-weight: 500; color: var(--ink); }
```
