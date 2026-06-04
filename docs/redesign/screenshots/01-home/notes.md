# Base44 — Home / Workspace dashboard

**URL:** `https://app.base44.com/`
**Что это:** workspace home — лендинг внутри логина, главный launcher новых аппов и быстрый доступ к recents.

**Скриншоты:** PNG недоступны (playwright-mcp FS isolated). Структуру даёт `snapshot.yml` + computed CSS ключевых компонентов ниже.

## Структура страницы

```
[Sidebar 250px | Main (fluid)]
```

### Sidebar (`width: 250px`, `bg: #FFFFFF`, `padding: 12px`, `gap: 12px` между секциями)

1. **Top row** (горизонталь): логотип-ссылка `/` + search icon button + ещё один icon button (notifications?)
2. **Workspace switcher** — кнопка-карточка с аватаркой "Yw" + "Yaroslav's Workspace" + chevron. `height: 40px`, `border: 1px solid #E4E4E7 (zinc-200)`, `radius: 8px`, `padding: 8px`, `gap: 6px`. Hover: `bg-zinc-50`.
3. **Primary tabs** — горизонтальная пара "Apps" / "Superagents" (с иконками)
4. **Nav (под Apps)** — список ссылок: Home / All apps / Templates / Integrations / Community (Community с dropdown)
5. **Favorite apps** — сворачиваемая секция, empty state "No favorite apps yet. Add your apps for quick access"
6. **Recents** — сворачиваемая секция, список ссылок-аппов с dots-menu, footer-ссылка "View all" → `/apps`
7. **Bottom — upgrade card** — `height: 56px`, `bg: #FBFAF7` (тёплый кремовый!), `border: 1px solid #E4E4E4`, `radius: 8px`, ссылка → `/billing`. Текст: "Upgrade your plan" + "Get more out of your apps" + chevron-right.
8. **Bottom — user strip** — аватарка "Y" 32×32 (warm orange bg, single letter) + Feedback icon + Referral icon + ещё один icon (settings?)

### Main (центральный stack по вертикали)

#### Hero
- `h1`: "What will you build next?" — `WixMadeforText 32px/48px weight-500`, color `#0F0F0F`
- НЕТ subtitle, hero идёт сразу в prompt-card

#### Prompt card (главный CTA)
- `max-width: 785px`, центрировано
- `border-radius: 14px`, `border: 1px solid transparent`
- **Шикарный background:** `linear-gradient(white, white), radial-gradient(circle at 0% 100%, #FF6B21 0%, transparent 21%)` — белый поверх coral-glow в нижнем-левом углу. Glow едва заметен но создаёт тёплое сияние из-под карточки.
- Shadow: `0 16px 30px rgba(0,0,0,.04)` — мягкая широкая тень
- Textarea внутри: `WixMadeforText 16px weight-100` (тонкий!), placeholder "Describe the app you want to create..."
- Toolbar внизу карточки разделён на лево/право:
  - Left: attach button, "Connectors" button с иконкой, image-upload button
  - Right: "Plan" label + toggle switch, Speech-to-text button (mic), Send button
- **Send button:** 32×32, `radius: 8px`, disabled state `bg: #D4D4D4` color `white/50%`. Active (predict): coral.

#### Suggestion pills (под prompt-card)
- 5 категорий + "More": `Tasks & Workflows / CRM & Sales / Content & Sites / Finance / Booking / More`
- Каждая: `bg: rgba(255,255,255,.69)`, `height: 36px`, `padding: 0 12px`, `radius: 8px`, `font: WixMadeforText 14/21 weight-500 #0A0A0A`. Hover: solid white + shadow-sm.
- Горизонтальный ряд с wrapping

#### Recent section
- Tabs row: "Recent apps" (active) / "Templates" + right-aligned "View all" с chevron
- App card (single shown — "Obsidian VPN"):
  - Лого слева
  - h3 название + info icon
  - Описание-параграф 2 строки
  - Meta: "Edited 4 hours ago"

### Cookie banner (modal bottom)
- Dialog с текстом + privacy policy link
- Buttons: "Manage preferences" / "Deny" / "Accept all"

## Computed CSS ключевых компонентов

(Готовы для копирования в `components/*.md` в Phase E)

### Sidebar
```css
width: 250px;
background-color: #FFFFFF;
padding: 12px;
gap: 12px;
display: flex;
flex-direction: column;
font-family: WixMadeforText, system-ui, sans-serif;
font-size: 16px;
line-height: 24px;
```

### Workspace switcher
```css
width: 100%;
height: 40px;
padding: 8px;
gap: 6px;
border: 1px solid #E4E4E7;
border-radius: 8px;
background: transparent;
/* hover: background: #FAFAFA (zinc-50) */
```

### Upgrade card
```css
width: 100%;
height: 56px;
padding: 12px;
background-color: #FBFAF7; /* warm cream */
border: 1px solid #E4E4E4;
border-radius: 8px;
display: flex;
flex-direction: column;
```

### Hero h1
```css
font-family: WixMadeforText;
font-size: 32px;
line-height: 48px;
font-weight: 500;
color: #0F0F0F;
```

### Prompt card
```css
max-width: 785px;
margin: 0 auto;
border-radius: 14px;
border: 1px solid transparent;
background:
  linear-gradient(#FFFFFF, #FFFFFF),
  radial-gradient(circle at 0% 100%, #FF6B21 0%, transparent 21%);
box-shadow: 0 16px 30px rgba(0,0,0,0.04);
```

### Prompt textarea (внутри prompt-card)
```css
padding: 12px 16px 0 24px;
font-family: WixMadeforText;
font-size: 16px;
font-weight: 100; /* very thin */
line-height: 24px;
border: 0;
background: transparent;
resize: none;
outline: none;
```

### Send button (disabled state — заметить, что active state coral)
```css
width: 32px;
height: 32px;
border-radius: 8px;
background-color: #D4D4D4; /* disabled */
color: rgba(255,255,255,0.5);
/* active state assumed: bg: var(--brand) = #FF631F or #FF6B21 */
```

### Suggestion pill
```css
height: 36px;
padding: 0 12px;
background-color: rgba(255,255,255,0.69);
border-radius: 8px;
font-family: WixMadeforText;
font-size: 14px;
font-weight: 500;
line-height: 21px;
color: #0A0A0A;
/* hover: background: white + box-shadow-sm */
```

## Адаптированные градиенты (для sunbaked)

| База44 оригинал | Sunbaked адаптация | Где |
|---|---|---|
| `linear-gradient(white,white), radial-gradient(circle at 0% 100%, #FF6B21 0%, transparent 21%)` | `linear-gradient(var(--paper), var(--paper)), radial-gradient(circle at 0% 100%, var(--coral) 0%, transparent 21%)` | prompt-card backdrop |

## UX-паттерны

- **Промпт-инпут — фокус UX**: вся страница построена вокруг textarea. Suggestions помогают начать.
- **Recent apps** дублируется и в sidebar (быстрый доступ) и в main (визуальный grid).
- **Тёплая ассоциация бренда:** `#FBFAF7` (upgrade card) + coral glow на prompt-card. base44 использует тёплый off-white как сигнал "premium/branded" surface вместо плоского white.
- **Wix-овый шрифт WixMadeforText** + thin-weight (100) в textarea — характерный visual flavor base44.
- **shadcn/ui underneath** — все utility-классы Tailwind, radius везде `8px` (`.5rem`), стандартные shadcn tokens (`zinc-200`, `stone-950`, etc.).

## Соответствие Adorable

- Adorable-эквивалент: `/` (главная — точно так же prompt-to-app)
- Что взять: hero "What will you build next?" + textarea-card + suggestions row + recent apps секция
- Sidebar: workspace switcher, primary tabs, nav-секция (Home/Apps/Templates), upgrade card внизу
- Бренд: заменяем base44 orange (#FF631F) → `--coral` (#E84E2F), warm cream (#FBFAF7) → `--paper` (#FBF7EC)
