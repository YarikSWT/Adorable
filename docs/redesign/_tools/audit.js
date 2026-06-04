// Запускается через playwright browser_evaluate.
// Возвращает компактный JSON со всем нужным для извлечения дизайн-токенов.
(() => {
  const getCSSProps = (el) => {
    const props = {};
    const style = getComputedStyle(el);
    for (let i = 0; i < style.length; i++) {
      const name = style[i];
      if (name.startsWith('--')) {
        props[name] = style.getPropertyValue(name).trim();
      }
    }
    return props;
  };

  const cssCustomProperties = {
    ':root': getCSSProps(document.documentElement),
    body: getCSSProps(document.body),
  };

  const fonts = [...document.fonts.values()].map((f) => ({
    family: f.family,
    weight: f.weight,
    style: f.style,
    status: f.status,
  }));

  const colors = {};
  const fontFamilies = {};
  const fontSizes = {};
  const fontWeights = {};
  const lineHeights = {};
  const letterSpacings = {};
  const borderRadii = {};
  const boxShadows = {};
  const paddings = {};
  const margins = {};
  const gaps = {};
  const borders = {};

  const skipColor = (v) =>
    !v || v === 'rgba(0, 0, 0, 0)' || v === 'transparent' || v === 'currentcolor';
  const skipSpace = (v) =>
    !v || v === '0px' || v === '0px 0px' || v === '0px 0px 0px 0px';

  const incr = (map, key, filter = () => false) => {
    if (!key || filter(key)) return;
    map[key] = (map[key] || 0) + 1;
  };

  document.querySelectorAll('*').forEach((el) => {
    const cs = getComputedStyle(el);
    incr(colors, cs.backgroundColor, skipColor);
    incr(colors, cs.color, skipColor);
    incr(colors, cs.borderTopColor, skipColor);
    incr(fontFamilies, cs.fontFamily);
    incr(fontSizes, cs.fontSize);
    incr(fontWeights, cs.fontWeight);
    incr(lineHeights, cs.lineHeight);
    incr(letterSpacings, cs.letterSpacing);
    incr(borderRadii, cs.borderRadius, (v) => v === '0px');
    incr(boxShadows, cs.boxShadow, (v) => v === 'none');
    incr(paddings, cs.padding, skipSpace);
    incr(margins, cs.margin, skipSpace);
    incr(gaps, cs.gap, (v) => v === 'normal' || v === '0px');
    incr(borders, cs.border, (v) => v.startsWith('0px'));
  });

  const rank = (map, limit) =>
    Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([value, count]) => ({ value, count }));

  const mediaQueries = new Set();
  try {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules || []) {
          if (rule.type === CSSRule.MEDIA_RULE) mediaQueries.add(rule.media.mediaText);
        }
      } catch (e) {}
    }
  } catch (e) {}

  return {
    url: location.href,
    viewport: { w: innerWidth, h: innerHeight },
    cssCustomProperties,
    fonts,
    usedColors: rank(colors, 30),
    usedFontFamilies: rank(fontFamilies, 10),
    usedFontSizes: rank(fontSizes, 20),
    usedFontWeights: rank(fontWeights, 10),
    usedLineHeights: rank(lineHeights, 15),
    usedLetterSpacings: rank(letterSpacings, 15),
    usedBorderRadii: rank(borderRadii, 15),
    usedBoxShadows: rank(boxShadows, 15),
    usedSpacingValues: {
      paddings: rank(paddings, 20),
      margins: rank(margins, 20),
      gaps: rank(gaps, 20),
    },
    usedBorders: rank(borders, 15),
    mediaQueries: [...mediaQueries].sort(),
  };
})();
