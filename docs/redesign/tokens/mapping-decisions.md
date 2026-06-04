# Token mapping — обоснования решений

## Главные сдвиги от base44 к sunbaked

### 1. Flat white → warm cream paper

**base44:** `--background: #FFFFFF`, `--card: #FFFFFF` — плоский белый везде.
**sunbaked:** `--bg-page = var(--paper) = #FBF7EC`, `--bg-surface = var(--paper)` — кремовая бумага.

**Why:** наш дизайн system основан на ассоциации "тёплая печатная бумага vs офисный экран". Это главный character — нельзя его сохранить и при этом оставить белый bg.

**Tradeoff:** все скриншоты от base44 будут "не такие" — мы намеренно меняем main canvas.

### 2. Cold zinc text → warm ink

**base44:** `--foreground: hsl(240 10% 3.9%) = #09090B` (zinc-950, cold).
**sunbaked:** `--ink = #2A2419` (warm dark с медовым подтоном).

**Why:** в сочетании с тёплой бумагой холодный текст выглядит "глюк". Warm ink держит coherence.

### 3. Cold border → warm cream-deep border

**base44:** `--border: hsl(240 5.9% 90%) = #E4E4E7` (zinc-200, cold).
**sunbaked:** `--border-default = var(--cream-deep) = #E5D9BB`.

**Why:** same reason. Cold border on warm bg = "разлепленный" UI.

### 4. Brand orange → coral lineage

**base44:** `#FF631F` (saturated bright orange), used **только** в:
- prompt-card radial-gradient glow
- (вероятно) active send button

Все обычные кнопки — `bg: zinc-900` (DARK, не orange!).

**sunbaked:** `--coral = #E84E2F` (чуть более земляной).

**Why:** наш coral более warm/мягкий, лучше живёт на cream paper. base44 orange был бы слишком яркий.

**Важное:** мы тоже НЕ используем coral для всех primary buttons — `bg-ink` для default primary, `bg-coral` только для brand-emphatic CTA (Send button, Subscribe, Featured plan).

### 5. Добавляем olive как secondary brand

**base44:** не имеет secondary brand color — только зелёные tags редко (audit показал #92400E amber-800 для warning).
**sunbaked:** `--olive = #6B7C3E` как secondary brand.

**Why:** дизайн-система C1 (sunbaked) построена на coral + olive вместе. Используем olive для:
- success status
- secondary brand CTA
- ассистент avatar (на чате)
- chip variants

**Tradeoff:** Adorable не будет 1:1 match base44 (у них только orange). Но это часть нашего brand identity.

### 6. Добавляем Fraunces display

**base44:** только WixMadeforText sans для всех заголовков.
**sunbaked:** `--font-display: Fraunces` (serif с optical sizing) для display tier (hero h1, plan-price, accent emphases).

**Why:** display serif — главный visual signal "premium / editorial / human". Дополняет cream paper.

**Где использовать display:**
- Hero h1 на главной ("Build with warmth.")
- Plan name на pricing
- Accent words с italic ("когда **warmth** живёт вместе со сдержанностью")

Body, UI labels, sidebar — всё на Geist sans.

### 7. Radius: чуть крупнее

**base44:** `--radius: .5rem (8px)` default, всё ровно по 8.
**sunbaked:** `--r-md: 10px`, `--r-sm: 6px`, `--r-lg: 16px`.

**Why:** 10px чувствуется чуть более "domestic / handmade". 8px — quintessential shadcn.

### 8. Shadows: warm ink-toned

**base44:** `rgba(0,0,0,X)` shadows (cold).
**sunbaked:** `rgba(42,36,25,X)` — warm ink tone.

**Why:** чёрные shadow на warm bg выглядят cold. Наши shadows получают warmth-tint.

### 9. Focus ring: blue → coral

**base44:** `--ring: rgb(59 130 246 / 0.5)` — Tailwind default blue.
**sunbaked:** `--focus-ring: 0 0 0 3px rgba(232, 78, 47, .15)` — coral semi-transparent.

**Why:** focus ring должен быть brand color, иначе теряется бренд.

## Что мы НЕ меняли

### Spacing scale
4px-based, как у Tailwind. Прямой перенос. `gap-2 = 8px = 0.5rem` остаётся.

### Breakpoints
`sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536` — стандартный Tailwind.

### shadcn structural patterns
- Card pattern (header / body / footer)
- Dialog/Modal overlay+content
- Dropdown trigger+content
- Tabs structure

Эти patterns переносим как есть — меняем только токены внутри.

## Адаптированные градиенты — детально

### Prompt-card glow (главный brand visual эффект)

**base44 оригинал:**
```css
background:
  linear-gradient(rgb(255,255,255), rgb(255,255,255)),
  radial-gradient(circle at 0% 100%, rgb(255,107,33) 0%, rgba(0,0,0,0) 21%);
```

Два слоя: белый поверх coral radial. Coral виден только slightly в нижнем-левом углу — иллюзия "свечения из-под карточки".

**sunbaked адаптация (1:1 substitution):**
```css
background:
  linear-gradient(var(--paper), var(--paper)),
  radial-gradient(circle at 0% 100%, var(--coral) 0%, transparent 21%);
```

Идентичная техника. paper заменяет белый, coral заменяет orange. Glow position идентичный (bottom-left).

### Hero backdrop (наш бонус, у base44 нет)

```css
background:
  radial-gradient(ellipse at 90% 0%, var(--cream) 0%, transparent 55%),
  var(--paper);
```

Тёплый кремовый свет из верхне-правого угла. Используется в hero-разделах для добавления depth без явных декоративных элементов.

### App-card preview placeholder

```css
background: linear-gradient(135deg, var(--cream), var(--cream-deep));
```

Fallback для app-card thumbnail когда нет реального превью.

### CTA glow (для featured plan-card / important buttons)

```css
background: linear-gradient(135deg, var(--coral), var(--coral-deep));
```

Альтернатива solid `bg-coral` для эмфазных CTA.

## Что не реализовано из base44

| Базовое | Почему не делаем |
|---|---|
| `--vscode-sash-*` vars | Сами реализуем resizer через CSS `cursor: col-resize` + JS handler — не нужен VSCode-sash lib |
| `--chart-1..5` (recharts theme) | Используем coral/olive/cream-deep серию когда понадобятся charts — не приоритет |
| `--sidebar-ring` (Tailwind blue) | У нас focus-ring уже coral везде включая sidebar |
| `--workspace-badge` отдельная переменная | У нас покрывается `--cream-deep` через `--bg-workspace` alias |
