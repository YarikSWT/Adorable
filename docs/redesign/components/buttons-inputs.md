# Buttons & Inputs

## Buttons — variants

### Primary (DARK, not orange!)

base44 captured (`Create New App`):
```css
background-color: #18181B;  /* zinc-900 */
color: #FAFAFA;
padding: 10px 16px;
gap: 6px;
border-radius: 6px;
font-size: 14px;
font-weight: 500;
height: 40px;
display: inline-flex; align-items: center; justify-content: center;
font-family: WixMadeforText;
```

### Secondary (outlined)

base44 captured (`Add new folder`):
```css
background-color: #FFFFFF;
color: #09090B;
border: 1px solid #E4E4E7;
padding: 10px 16px;
gap: 6px;
border-radius: 6px;
font-size: 14px;
font-weight: 500;
height: 40px;
```

### Ghost (минимальная)

predict pattern (shadcn-style):
```css
background: transparent;
color: var(--text-primary);
border: 0;
padding: 8px 12px;
border-radius: 6px;
/* hover: bg: zinc-100 */
```

### Icon button

predict (32×32 или 36×36):
```css
width: 36px; height: 36px;
padding: 8px;
border-radius: var(--r-sm);
background: transparent;
/* hover: bg cream */
```

### Send (orange disabled → orange active)

base44 captured (disabled state):
```css
width: 32px; height: 32px;
border-radius: 8px;
background-color: #D4D4D4;  /* disabled */
color: rgba(255,255,255,0.5);
padding: 4px;
display: flex; align-items: center; justify-content: center;
```

Active state (predict from brand color):
```css
background-color: #FF631F;  /* base44 brand orange */
color: white;
```

### View toggle (segmented pill)

base44 captured:
- Активный сегмент: 34×24, `bg: #FFFFFF`, `border: 1px solid #E5E5E5`, `radius: 8px`, `shadow-md` (`0 4px 6px -1px rgba(0,0,0,.1)`)
- Padding: 3px 8px

## Sunbaked версии

```css
.btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 8px;
  padding: 9px 16px;
  border-radius: var(--r-sm);
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all .15s ease;
  height: 40px;
}
.btn-primary  { background: var(--ink);          color: var(--cream); }
.btn-primary:hover { background: var(--ink-2); }

.btn-secondary { background: var(--bg-surface);   color: var(--text-primary); border-color: var(--border-default); }
.btn-secondary:hover { background: var(--cream); }

.btn-ghost    { background: transparent;          color: var(--text-primary); }
.btn-ghost:hover { background: var(--cream); }

.btn-brand    { background: var(--coral);         color: white; }
.btn-brand:hover { background: var(--coral-soft); box-shadow: var(--sh-coral); }

.btn-icon { width: 36px; height: 36px; padding: 8px; }

.btn-send {
  width: 32px; height: 32px; padding: 4px;
  background: var(--coral); color: white;
  border-radius: var(--r-sm);
}
.btn-send[disabled] { background: var(--n-300); color: rgba(255,255,255,.5); cursor: not-allowed; }

/* Segmented toggle */
.segmented {
  display: inline-flex;
  background: var(--cream);
  border-radius: var(--r-sm);
  padding: 2px;
}
.seg-btn {
  padding: 6px 12px;
  font-size: 13px;
  color: var(--text-secondary);
  border-radius: calc(var(--r-sm) - 2px);
  border: 0; background: transparent;
}
.seg-btn.is-active {
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  box-shadow: var(--sh-1);
}
```

## Inputs

### Text input / search

base44 captured (`search-input`):
```css
width: 320px;
height: 36px;
padding: 8px 12px 8px 40px;  /* left 40px для search icon */
border: 1px solid #E4E4E7;
border-radius: 6px;
background: #FFFFFF;
font-size: 14px;
/* placeholder: muted-foreground #71717A */
```

### Sunbaked

```css
.input {
  width: 100%;
  height: 36px;
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--r-sm);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 14px;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.input:focus {
  border-color: var(--coral);
  box-shadow: 0 0 0 3px rgba(232, 78, 47, .15);
}
.input::placeholder { color: var(--text-muted); }

.input--with-icon { padding-left: 40px; }
.search-wrapper { position: relative; }
.search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: var(--text-muted); }
```

### Textarea (chat input)

base44 chat-input wrapper:
```css
background: #FFFFFF;
border: 1px solid #E5E5E5;
border-radius: 14px;
overflow: hidden;
/* shadow: none on desktop */
```

Textarea inside:
```css
padding: 16px 16px 0;
font-size: 14px;
font-family: ui-sans-serif;
background: transparent;
border: 0;
resize: none;
outline: none;
border-radius: 8px 8px 0 0;
```

### Sunbaked

```css
.chat-input {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: 14px;
  overflow: hidden;
  display: flex; flex-direction: column;
}
.chat-input__textarea {
  padding: 16px 16px 8px;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  background: transparent;
  border: 0;
  outline: none;
  resize: none;
  color: var(--text-primary);
}
.chat-input__toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 8px 8px;
}
```

## Switch / Toggle

Не captured precisely. Standard shadcn:
```css
.switch {
  width: 36px; height: 20px;
  border-radius: 999px;
  background: var(--n-200);
  position: relative;
  cursor: pointer;
  transition: background .2s;
}
.switch__thumb {
  position: absolute;
  width: 16px; height: 16px;
  background: white;
  border-radius: 50%;
  top: 2px; left: 2px;
  transition: transform .2s;
  box-shadow: var(--sh-1);
}
.switch.is-on { background: var(--coral); }
.switch.is-on .switch__thumb { transform: translateX(16px); }
```
