// Принимает selector через параметр. Возвращает computed CSS + outerHTML.
// Использование: browser_evaluate с заменой __SELECTOR__ на CSS-селектор.
((sel) => {
  const els = document.querySelectorAll(sel);
  if (!els.length) return { error: 'not found', selector: sel };
  return [...els].slice(0, 3).map((el, idx) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const pick = (props) =>
      Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p).trim()]));
    return {
      index: idx,
      tag: el.tagName.toLowerCase(),
      classes: el.className,
      box: { w: rect.width, h: rect.height, x: rect.x, y: rect.y },
      visual: pick([
        'background-color',
        'background-image',
        'color',
        'border',
        'border-radius',
        'box-shadow',
        'opacity',
      ]),
      type: pick([
        'font-family',
        'font-size',
        'font-weight',
        'line-height',
        'letter-spacing',
        'text-transform',
      ]),
      space: pick(['padding', 'margin', 'gap', 'width', 'height', 'min-height']),
      flex: pick(['display', 'flex-direction', 'justify-content', 'align-items']),
      outerHTML: el.outerHTML.length > 2000 ? el.outerHTML.slice(0, 2000) + '...[truncated]' : el.outerHTML,
    };
  });
})('__SELECTOR__');
