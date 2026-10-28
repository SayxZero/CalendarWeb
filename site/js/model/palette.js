// Palettes of the planner (model/palette.cpp): one look per palette, light or
// dark, every colour of the interface named. The site wears them as CSS custom
// properties (--window, --accent, ...), so a palette exported from the planner
// fits the site and back.

export const FIELDS = [
  ['window', 'Фон окна', 'Поверхности'],
  ['surface', 'Полотно', 'Поверхности'],
  ['elevatedSurface', 'Карточка', 'Поверхности'],
  ['tile', 'Плитка значения', 'Поверхности'],
  ['gridLine', 'Линии сетки', 'Поверхности'],
  ['accent', 'Основной цвет', 'Цвета и подсветки'],
  ['hoverTint', 'Наведение', 'Цвета и подсветки'],
  ['pressedTint', 'Нажатие', 'Цвета и подсветки'],
  ['selectionTint', 'Выделение', 'Цвета и подсветки'],
  ['todayTint', 'Сегодня', 'Цвета и подсветки'],
  ['weekendTint', 'Выходные', 'Цвета и подсветки'],
  ['nowLine', 'Линия времени', 'Цвета и подсветки'],
  ['danger', 'Тревожный', 'Цвета и подсветки'],
  ['success', 'Успех', 'Цвета и подсветки'],
  ['warning', 'Внимание', 'Цвета и подсветки'],
  ['info', 'Дополнительный', 'Цвета и подсветки'],
  ['text', 'Текст', 'Текст'],
  ['mutedText', 'Приглушённый текст', 'Текст'],
  ['outsideMonthText', 'Дни соседнего месяца', 'Текст'],
  ['placeholderText', 'Подсказка в поле', 'Текст'],
  ['disabledText', 'Недоступный текст', 'Текст'],
  ['onAccentText', 'Текст на основном', 'Текст'],
  ['tooltipBase', 'Фон подсказки', 'Подсказки'],
  ['tooltipText', 'Текст подсказки', 'Подсказки'],
];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

function toHsv([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max, d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, v];
}

function fromHsv([h, s, v]) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

/** QColor::darker(): the value divided by factor / 100. */
export function darker(hex, factor) {
  const [h, s, v] = toHsv(hexToRgb(hex));
  return rgbToHex(fromHsv([h, s, (v * 100) / factor]));
}

/** QColor::lighter(): the value multiplied, saturation given up past white. */
export function lighter(hex, factor) {
  let [h, s, v] = toHsv(hexToRgb(hex));
  v = (v * factor) / 100;
  if (v > 255) {
    s -= v - 255;
    if (s < 0) s = 0;
    v = 255;
  }
  return rgbToHex(fromHsv([h, s, v]));
}

/** Black or white text, whichever stays readable on @p background. */
export function contrastingText(background) {
  const [r, g, b] = hexToRgb(background);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#202228' : '#ffffff';
}

/** @p hex with alpha, as rgba(). */
export function withAlpha(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function lightScheme() {
  const c = {
    window: '#f5f6f8', surface: '#ffffff', elevatedSurface: '#f7f8fa', tile: '#e6e9f0',
    gridLine: '#e2e5ea', accent: '#4f6bed', selectionTint: '#d8e0fb', todayTint: '#e8edfd',
    weekendTint: '#f4f5f9', nowLine: '#e53935', danger: '#d93025', success: '#0f9d58',
    warning: '#e8710a', info: '#8e24aa', text: '#1f232b', mutedText: '#747c8a',
    outsideMonthText: '#b2b8c2', placeholderText: '#8a909c', disabledText: '#a5aab4',
    onAccentText: '#ffffff', tooltipBase: '#252830', tooltipText: '#f5f6f8',
  };
  c.hoverTint = darker(c.window, 106);
  c.pressedTint = darker(c.window, 113);
  return c;
}

function darkScheme() {
  const c = {
    window: '#1b1e24', surface: '#22262d', elevatedSurface: '#2a2f38', tile: '#2c313a',
    gridLine: '#363c46', accent: '#6b84f5', selectionTint: '#354063', todayTint: '#2b3552',
    weekendTint: '#262a33', nowLine: '#e53935', danger: '#ff6b6b', success: '#4cbd82',
    warning: '#f29a3e', info: '#b17ddd', text: '#e6e8ee', mutedText: '#949ca9',
    outsideMonthText: '#5e6673', placeholderText: '#7d8491', disabledText: '#6a707c',
    onAccentText: '#121418', tooltipBase: '#2f343d', tooltipText: '#e6e8ee',
  };
  c.hoverTint = lighter(c.surface, 118);
  c.pressedTint = lighter(c.surface, 134);
  return c;
}

function recoloured(base, id, name, accent, selection, todayTint) {
  return { id, name, builtIn: true, dark: base.dark,
    colors: { ...base.colors, accent, selectionTint: selection, todayTint } };
}

function surfaces(palette, colors) {
  Object.assign(palette.colors, colors);
  palette.colors.hoverTint = darker(palette.colors.window, 106);
  palette.colors.pressedTint = darker(palette.colors.window, 113);
  return palette;
}

export function builtInPalettes() {
  const light = { id: 'classic', name: 'Классическая светлая', builtIn: true, dark: false, colors: lightScheme() };
  const night = { id: 'classic-dark', name: 'Классическая тёмная', builtIn: true, dark: true, colors: darkScheme() };
  const rose = surfaces(recoloured(light, 'rose', 'Нежно-розовая', '#d95c8f', '#fadde8', '#fdeef4'), {
    window: '#fdf4f7', surface: '#fffcfd', elevatedSurface: '#fcf0f4', tile: '#f7e2ea', gridLine: '#f2dde5',
    weekendTint: '#fbf0f4', text: '#36252c', mutedText: '#8d767e', outsideMonthText: '#c9b3bb', danger: '#c62f3f',
  });
  const paper = surfaces(recoloured(light, 'paper', 'Бумага', '#9a6b2f', '#f0e3cb', '#f7efdf'), {
    window: '#f7f3ea', surface: '#fdfbf6', elevatedSurface: '#f4efe4', tile: '#ebe4d5', gridLine: '#e4dccb',
    weekendTint: '#f5f0e6', text: '#2e2a22', mutedText: '#7c7464', outsideMonthText: '#bcb4a4',
  });
  const sky = surfaces(recoloured(light, 'sky', 'Небесная', '#1d77a8', '#d2e8f4', '#e6f3fa'), {
    window: '#f1f6fa', surface: '#fdfeff', elevatedSurface: '#edf3f8', tile: '#dfe9f1', gridLine: '#dbe5ed',
    weekendTint: '#eff5f9', text: '#1c2830',
  });
  return [
    light, rose, paper, sky,
    recoloured(light, 'forest', 'Лесная', '#2e7d32', '#d7ead8', '#e8f4e9'),
    recoloured(light, 'amber', 'Янтарная', '#c47f00', '#fae9c8', '#fdf4e2'),
    recoloured(light, 'plum', 'Сливовая', '#7b3fa4', '#e8daf5', '#f3ecfa'),
    night,
    recoloured(night, 'forest-dark', 'Лесная тёмная', '#66bb6a', '#2a3f2e', '#243528'),
    recoloured(night, 'amber-dark', 'Янтарная тёмная', '#f0b13a', '#42361c', '#362d1a'),
    recoloured(night, 'plum-dark', 'Сливовая тёмная', '#b17ddd', '#392d4c', '#2f263e'),
    recoloured(night, 'slate', 'Графитовая', '#8ca6bd', '#2f3942', '#283038'),
  ];
}

/** A palette file of the planner (format calendar-planner-palette, version 2). */
export function paletteToJson(palette) {
  return { format: 'calendar-planner-palette', version: 2, id: palette.id, name: palette.name,
    dark: palette.dark, colors: { ...palette.colors } };
}

export function paletteFromJson(object, fallback) {
  const palette = { ...structuredClone(fallback), builtIn: false };
  if (object?.id) palette.id = String(object.id);
  if (object?.name) palette.name = String(object.name);
  const colors = object?.colors && typeof object.colors === 'object' ? object.colors
    : (fallback.dark ? object?.dark : object?.light) || object?.light || object?.dark || {};
  if (object?.colors) palette.dark = typeof object.dark === 'boolean' ? object.dark : fallback.dark;
  for (const [key] of FIELDS) {
    if (/^#[0-9a-f]{6}$/i.test(colors[key] || '')) palette.colors[key] = colors[key].toLowerCase();
  }
  return palette;
}
