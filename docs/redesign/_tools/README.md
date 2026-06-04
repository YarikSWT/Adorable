# _tools/

Переиспользуемые JS-сниппеты для запуска через playwright `browser_evaluate`.

- `audit.js` — глобальный токен-аудит страницы. Возвращает CSS custom properties, шрифты, частоты цветов/шрифтов/радиусов/теней/spacing, media queries.
- `set-auth.js` — устанавливает JWT во все распространённые ключи `localStorage`. Перед вставкой замени `__TOKEN__` на значение из `.env`.
- `component-extract.js` — извлекает computed CSS + outerHTML для CSS-селектора. Замени `__SELECTOR__` перед вставкой.
- `auth-log.md` — заметка о том, какой именно ключ в localStorage сработал для base44.

**Workflow:**
1. `browser_navigate https://app.base44.com/`
2. Прочитать `.env`, подставить токен в `set-auth.js`, `browser_evaluate`
3. `browser_navigate` на нужную страницу
4. `browser_evaluate` с `audit.js` → сохранить ответ в `tokens/raw/<page>.json`
5. Для каждого компонента: `browser_evaluate` с `component-extract.js` (свой селектор)
