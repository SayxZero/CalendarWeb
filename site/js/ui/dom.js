// Small DOM helpers, the icons and the little windows every screen uses:
// toasts, menus, questions. No framework: the planner draws itself with
// QPainter, the site with these.

const ICONS = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  more: '<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  month: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h2M12 14h2M16 14h1M8 17h2M12 17h2"/>',
  week: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M9 10v10M15 10v10"/>',
  day: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h8"/>',
  year: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  agenda: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>',
  tasks: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 12l3 3 5-6"/>',
  habits: '<path d="M12 21c-4 0-7-3-7-7 0-3.5 2.5-5.5 4-8 .8 2 2 3 3 3 0-2 1-4 3-6 1 3 4 5.5 4 10 0 4.5-3 8-7 8z"/>',
  bell: '<path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15L6 16z"/><path d="M10 20a2 2 0 004 0"/>',
  alarm: '<circle cx="12" cy="13" r="7"/><path d="M12 9v4l2.5 2M4 5l3-2M20 5l-3-2"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
  sync: '<path d="M20 11a8 8 0 00-14.3-4.6L4 8M4 4v4h4M4 13a8 8 0 0014.3 4.6L20 16M20 20v-4h-4"/>',
  offline: '<path d="M3 3l18 18M8.5 8.5A5 5 0 007 18h10M17.5 18a3.5 3.5 0 00.5-6.9A6 6 0 009.6 6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  starFilled: '<path fill="currentColor" d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A10 10 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7a9.7 9.7 0 005.4-1.6"/>',
  share: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.5a3.5 3.5 0 010 7M18 14.4c2.1.8 3.5 2.8 3.5 5.6"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  repeat: '<path d="M17 2l3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 01-4 4H4"/>',
  place: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  note: '<path d="M5 4h14v16H5zM9 8h6M9 12h6M9 16h4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  play: '<path fill="currentColor" d="M8 5v14l11-7z"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  palette: '<path d="M12 3a9 9 0 100 18c1 0 1.5-.7 1.5-1.5 0-.5-.2-.8-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 005-5c0-4-4-7.5-9-7.5z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
  back: '<path d="M10 6l-6 6 6 6M4 12h16"/>',
  failed: '<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  today: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><rect x="10" y="13" width="4" height="4" rx="1" fill="currentColor"/>',
  calendars: '<rect x="3.5" y="5" width="13" height="13" rx="2"/><path d="M7.5 3v4M12.5 3v4M3.5 10h13M20.5 9v10a2 2 0 01-2 2h-11"/>',
  import: '<path d="M12 3v12M7 10l5 5 5-5M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.5"/>',
};

// A part of a screen that is not there is written as null or false - in h()
// and just as well in append(), prepend() and replaceChildren(), which would
// otherwise put the word "null" into the page. The site loads no code but its
// own, so teaching the three methods to skip them is safe here.
for (const name of ['append', 'prepend', 'replaceChildren']) {
  const original = Element.prototype[name];
  Element.prototype[name] = function skippingNothing(...nodes) {
    return original.apply(this, nodes.filter((node) => node != null && node !== false));
  };
}

export function icon(name, className = '') {
  const span = document.createElement('span');
  span.innerHTML = `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span.firstChild;
}

/**
 * h('div', {class: 'x', on: {click}}, child, [children], 'text'). Props:
 * class, style (object), on (events), dataset, attrs, and anything else as a
 * property of the element (value, checked, disabled, title, type...).
 */
export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false && key !== 'checked' && key !== 'disabled' && key !== 'value') continue;
      if (key === 'class') el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
      else if (key === 'style') {
        if (typeof value === 'string') el.style.cssText = value;
        else for (const [k, v] of Object.entries(value)) {
          if (v == null) continue;
          if (k.startsWith('--')) el.style.setProperty(k, v);
          else el.style[k] = v;
        }
      } else if (key === 'on') {
        for (const [event, handler] of Object.entries(value)) if (handler) el.addEventListener(event, handler);
      } else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key === 'attrs') for (const [k, v] of Object.entries(value)) { if (v != null) el.setAttribute(k, v); }
      else el[key] = value;
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : String(child));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export const mobileQuery = matchMedia('(max-width: 899px)');
export function isMobile() {
  return mobileQuery.matches;
}

/** Text colour that reads on @p hex, and the style vars for a calendar colour. */
export function calStyle(hex) {
  const n = parseInt((hex || '#4f6bed').slice(1), 16);
  const luminance = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return { '--cal': hex, '--on-cal': luminance > 0.6 ? '#202228' : '#ffffff' };
}

// ------------------------------------------------------------------ toasts

let toastBox = null;

export function toast(text, { action = '', onAction = null, timeout = 3500 } = {}) {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts', attrs: { role: 'status', 'aria-live': 'polite' } });
    document.body.append(toastBox);
  }
  const item = h('div', { class: 'toast' }, h('span', null, text),
    action ? h('button', { on: { click: () => { item.remove(); onAction?.(); } } }, action) : null);
  toastBox.append(item);
  setTimeout(() => item.remove(), timeout);
}

// ------------------------------------------------------------------- menus

/**
 * A menu at @p anchor (an element or {x, y}). Items: {label, icon, danger,
 * action} or 'sep' or {title}. Closes on choice, outside click or Escape.
 */
export function openMenu(anchor, items) {
  closeMenus();
  const menu = h('div', { class: 'menu', attrs: { role: 'menu' } });
  for (const item of items) {
    if (!item) continue;
    if (item === 'sep') menu.append(h('div', { class: 'sep' }));
    else if (item.title) menu.append(h('div', { class: 'menu-title' }, item.title));
    else if (item.element) menu.append(item.element);
    else {
      menu.append(h('button', {
        class: item.danger ? 'danger' : '', attrs: { role: 'menuitem' }, disabled: !!item.disabled,
        on: { click: (e) => { e.stopPropagation(); closeMenus(); item.action?.(); } },
      }, item.icon ? icon(item.icon) : null, item.dot ? h('span', { class: 'dot', style: { '--cal': item.dot } }) : null,
      h('span', { class: 'grow' }, item.label), item.hint ? h('span', { class: 'muted small' }, item.hint) : null));
    }
  }
  document.body.append(menu);
  const rect = anchor instanceof Element ? anchor.getBoundingClientRect()
    : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const width = menu.offsetWidth, height = menu.offsetHeight;
  let left = Math.min(rect.left, innerWidth - width - 8);
  let top = rect.bottom + 4;
  if (top + height > innerHeight - 8) top = Math.max(8, rect.top - height - 4);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${top}px`;
  const away = (e) => { if (!menu.contains(e.target)) closeMenus(); };
  const key = (e) => { if (e.key === 'Escape') closeMenus(); };
  setTimeout(() => {
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key, true);
  });
  menu.cleanup = () => {
    document.removeEventListener('pointerdown', away, true);
    document.removeEventListener('keydown', key, true);
  };
  menu.querySelector('button')?.focus({ preventScroll: true });
  return menu;
}

export function closeMenus() {
  for (const menu of document.querySelectorAll('.menu')) {
    menu.cleanup?.();
    menu.remove();
  }
}

// --------------------------------------------------------------- downloads

export function download(fileName, content, type = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: fileName });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** A file the user picks, or null. */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => {
      resolve(input.files?.[0] || null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h('textarea', { value: text, style: { position: 'fixed', opacity: '0' } });
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

/** Swipe left/right on @p el, for the phone: calls back with -1 or +1. */
export function onSwipe(el, callback) {
  let start = null;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { start = null; return; }
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (!start) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
    // The left edge belongs to the drawer.
    if (start.x > 24 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - start.t < 600) {
      callback(dx < 0 ? 1 : -1);
    }
    start = null;
  }, { passive: true });
}
