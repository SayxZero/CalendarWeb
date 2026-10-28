// Wears a palette: its colours become the custom properties of app.css.

const PROPERTY = {
  window: '--window', surface: '--surface', elevatedSurface: '--elevated', tile: '--tile', gridLine: '--grid',
  accent: '--accent', hoverTint: '--hover', pressedTint: '--pressed', selectionTint: '--selection',
  todayTint: '--today', weekendTint: '--weekend', nowLine: '--now', danger: '--danger', success: '--success',
  warning: '--warning', info: '--info', text: '--text', mutedText: '--muted', outsideMonthText: '--outside',
  placeholderText: '--placeholder', disabledText: '--disabled', onAccentText: '--on-accent',
  tooltipBase: '--tooltip-bg', tooltipText: '--tooltip-text',
};

export function applyPalette(palette, weekendsHighlighted = true) {
  const root = document.documentElement;
  for (const [field, property] of Object.entries(PROPERTY)) {
    if (palette.colors[field]) root.style.setProperty(property, palette.colors[field]);
  }
  if (!weekendsHighlighted) root.style.setProperty('--weekend', palette.colors.surface);
  root.dataset.dark = palette.dark ? '1' : '0';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette.colors.surface);
}
