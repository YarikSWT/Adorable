# Base44 — Apps list

**URL:** `https://app.base44.com/apps?filter=my_apps_workspace`

## Структура main

```
[Header row: h2 "Apps" — spacer — "Add new folder" btn — "Create New App" btn]
[Filter row: search input — "Created by me" — "Last updated" — spacer — [Grid|List] toggle]
[Grid: app cards 3-col, gap ~16-20px]
```

## CSS компонентов

### Page h2 ("Apps")
```css
font-family: WixMadeforText;
font-size: 48px;   /* text-5xl */
font-weight: 500;
line-height: 1.0;  /* leading-none */
color: #09090B;    /* foreground */
```

### Primary button "Create New App" (DARK, не orange — важно!)
```css
background-color: #18181B;  /* zinc-900 */
color: #FAFAFA;
padding: 10px 16px;
gap: 6px;
border-radius: 6px;
font-size: 14px;
font-weight: 500;
height: 40px;
```

### Secondary button "Add new folder"
```css
background-color: #FFFFFF;
color: #09090B;
border: 1px solid #E4E4E7;  /* zinc-200 */
padding: 10px 16px;
gap: 6px;
border-radius: 6px;
font-size: 14px;
font-weight: 500;
height: 40px;
```

### Search input (с поисковой иконкой слева)
```css
width: 320px;
height: 36px;
padding: 8px 12px 8px 40px;  /* левый отступ под иконку */
border: 1px solid #E4E4E7;
border-radius: 6px;
background-color: #FFFFFF;
font-size: 14px;
/* placeholder: muted-foreground = #71717A */
```

### Filter button ("Created by me" + chevron)
```css
background-color: #FFFFFF;
color: #09090B;
border: 1px solid #E4E4E7;
padding: 8px 12px;
gap: 8px;
border-radius: 6px;
font-size: 14px;
font-weight: 500;
height: 36px;
```

### View toggle (Grid/List pill — два сегмента в одной обёртке)
- Активный сегмент: `bg: #FFFFFF`, `border: 1px solid #E5E5E5`, `radius: 8px`, `shadow-md` (`0 4px 6px -1px rgba(0,0,0,.1)`), `padding: 3px 8px`, `34×24`
- Неактивный: transparent bg, no border

### App card (grid item)
- `~349×182px` при 3-col на ~1200px main
- Hover: `shadow-lg` + (predict: subtle scale)
- Структура:
  - Top row: logo (small img/icon) + h3 title + actions (heart/menu icons)
  - Description paragraph (2 lines, line-clamp-2)
  - Meta row: "By <email>" + spacer + "Created <time>"

### App card title (h3)
```css
font-family: WixMadeforText;
font-size: 18px;
font-weight: 600;  /* font-semibold */
color: #09090B;
/* line-clamp-2 */
```

### App card description (p)
```css
font-family: WixMadeforText;
font-size: 16px;
font-weight: 400;
color: #71717A;  /* muted-foreground = zinc-500 */
margin-bottom: 12px;
/* line-clamp-2 */
```

## UX-паттерны

- **Primary CTA dark, не оранжевая.** Orange зарезервирован для prompt-card glow на главной. Все обычные действия — `bg-zinc-900`.
- **2 типа кнопок:** primary (filled zinc-900) и secondary (outlined). Outlined более частые.
- **Filters не chips, а buttons** с dropdown — "Created by me ▾" / "Last updated ▾"
- **Grid/List toggle — сегментированный pill** с тенью на активном
- **App cards rich:** logo + title + actions + desc + meta. Heart-icon = favorite.

## Адаптация на sunbaked

- Primary button (был `bg-zinc-900`): → `bg-ink` (`#2A2419` — наш warm ink), `color: var(--cream)`
- Secondary button (был `bg-white border-zinc-200`): → `bg-paper border-cream-deep`, `color: var(--ink)`
- Search/filter/view-toggle: те же sunbaked-замены
- App card hover shadow: `var(--sh-2)`
- App card title color: `var(--ink)`, desc color: `var(--n-500)`
