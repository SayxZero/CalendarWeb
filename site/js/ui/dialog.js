// Dialogs: a card in the middle of the window on a computer, the whole screen
// on a phone (with "✕ Название СОХРАНИТЬ" on top, as the planner's AppBar),
// and the small questions built from them.

import { h, icon, isMobile } from './dom.js';

let openCount = 0;

export class Dialog {
  /**
   * @p onSave returns false (or a Promise of false) to keep the dialog open;
   * without it there is no "Сохранить" and the dialog is closed by its own
   * buttons. @p size: '', 'wide' or 'narrow'; @p sheet - a small one that
   * slides up from the bottom on a phone instead of covering it.
   */
  constructor({ title = '', size = '', saveLabel = 'Сохранить', cancelLabel = 'Отмена', onSave = null, sheet = false, closeLabel = '' } = {}) {
    this.onSave = onSave;
    this.saving = false;
    this.titleEl = h('h2', null, title);
    this.saveTop = onSave ? h('button', { class: 'btn flat save-top', on: { click: () => this.save() } }, saveLabel.toUpperCase()) : null;
    const closeButton = h('button', { class: 'icon-btn', title: 'Закрыть', attrs: { 'aria-label': 'Закрыть' }, on: { click: () => this.close(null) } }, icon('close'));
    this.head = h('div', { class: 'dialog-head' }, isMobile() ? closeButton : null, this.titleEl, this.saveTop, isMobile() ? null : closeButton);
    this.body = h('div', { class: 'dialog-body' });
    this.extras = h('div', { class: 'row wrap' });
    this.foot = h('div', { class: 'dialog-foot' }, this.extras, h('span', { class: 'spacer' }),
      onSave ? h('button', { class: 'btn primary-foot', on: { click: () => this.close(null) } }, cancelLabel) : null,
      onSave ? h('button', { class: 'btn primary primary-foot', on: { click: () => this.save() } }, saveLabel) : null,
      !onSave && closeLabel ? h('button', { class: 'btn', on: { click: () => this.close(null) } }, closeLabel) : null);
    this.card = h('div', { class: ['dialog', size, sheet ? 'sheet-small' : ''], attrs: { role: 'dialog', 'aria-modal': 'true' } },
      this.head, this.body, this.foot);
    this.scrim = h('div', { class: 'scrim', on: { mousedown: (e) => { if (e.target === this.scrim && !isMobile()) this.pressedOutside = true; },
      click: (e) => { if (e.target === this.scrim && this.pressedOutside && !onSave) this.close(null); this.pressedOutside = false; } } }, this.card);
    this.onKey = (e) => {
      if (e.key === 'Escape' && !document.querySelector('.menu')) {
        e.stopPropagation();
        this.close(null);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onSave) {
        e.preventDefault();
        this.save();
      }
    };
  }

  setTitle(text) {
    this.titleEl.textContent = text;
  }

  /** A button at the left of the footer ("Удалить", "Экспорт"...). */
  addButton(label, action, { danger = false, iconName = '' } = {}) {
    const button = h('button', { class: ['btn', danger ? 'danger' : ''], on: { click: action } }, iconName ? icon(iconName) : null, label);
    this.extras.append(button);
    return button;
  }

  hideFoot() {
    this.foot.hidden = true;
  }

  open() {
    this.previousFocus = document.activeElement;
    document.body.append(this.scrim);
    document.addEventListener('keydown', this.onKey, true);
    ++openCount;
    // On a phone «Отмена» and «Сохранить» live in the bar on top; a footer
    // left with nothing else would be an empty strip.
    const shown = [...this.foot.querySelectorAll('button')].some((b) => !(isMobile() && b.classList.contains('primary-foot')));
    if (!shown) this.foot.hidden = true;
    const first = this.body.querySelector('input:not([type=checkbox]):not([type=color]), textarea, select');
    if (first && !isMobile()) setTimeout(() => first.focus(), 30);
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  async save() {
    if (this.saving) return;
    this.saving = true;
    try {
      const result = await this.onSave?.();
      if (result !== false) this.close(result === undefined ? true : result);
    } finally {
      this.saving = false;
    }
  }

  close(value) {
    if (!this.scrim.isConnected) return;
    document.removeEventListener('keydown', this.onKey, true);
    this.scrim.remove();
    --openCount;
    this.previousFocus?.focus?.({ preventScroll: true });
    this.resolve?.(value);
  }
}

export function dialogOpen() {
  return openCount > 0;
}

/** A labelled field. */
export function field(label, control, hint = '') {
  return h('div', { class: 'field' }, label ? h('div', { class: 'label' }, label) : null, control,
    hint ? h('div', { class: 'hint' }, hint) : null);
}

/** A switch with a label: returns the element; .input is the checkbox. */
export function toggle(label, checked, onChange = null) {
  const input = h('input', { type: 'checkbox', checked: !!checked, on: { change: () => onChange?.(input.checked) } });
  const el = h('label', { class: 'switch' }, input, h('span', { class: 'track' }), h('span', null, label));
  el.input = input;
  return el;
}

/** A yes/no question; resolves true for yes. */
export async function confirm({ title, text = '', ok = 'OK', cancel = 'Отмена', danger = false }) {
  const answer = await ask({ title, text, options: [
    { label: cancel, value: false },
    { label: ok, value: true, primary: !danger, danger },
  ] });
  return answer === true;
}

/** A question with several answers; resolves to the value of the one chosen, null when closed. */
export function ask({ title, text = '', options }) {
  const dialog = new Dialog({ title, size: 'narrow', sheet: true });
  if (text) dialog.body.append(h('div', { style: { whiteSpace: 'pre-wrap' } }, text));
  dialog.foot.querySelector('.spacer')?.remove();
  dialog.extras.remove();
  const row = h('div', { class: 'row wrap', style: { justifyContent: 'flex-end', width: '100%' } });
  for (const option of options) {
    row.append(h('button', {
      class: ['btn', option.primary ? 'primary' : '', option.danger ? 'danger' : ''],
      on: { click: () => dialog.close(option.value) },
    }, option.label));
  }
  dialog.foot.append(row);
  return dialog.open();
}

/** One line of text; resolves to it or null. */
export function promptText({ title, label = '', value = '', placeholder = '', type = 'text', saveLabel = 'Готово' }) {
  const input = h('input', { type, value, placeholder });
  let result = null;
  const dialog = new Dialog({ title, size: 'narrow', sheet: true, saveLabel, onSave: () => {
    result = input.value;
    return result;
  } });
  dialog.body.append(field(label, input));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); dialog.save(); } });
  setTimeout(() => input.focus(), 50);
  return dialog.open().then((v) => (v == null ? null : result));
}

/** A list to choose one from; resolves to the value or null. */
export function chooseFrom({ title, items, current = undefined }) {
  const dialog = new Dialog({ title, size: 'narrow', sheet: true, closeLabel: 'Отмена' });
  const list = h('div', { class: 'list-picker' });
  for (const item of items) {
    list.append(h('button', { class: item.value === current ? 'on' : '', on: { click: () => dialog.close({ value: item.value }) } },
      h('span', { class: 'row' }, item.color ? h('span', { class: 'dot', style: { '--cal': item.color } }) : null,
        h('span', null, item.label), item.hint ? h('span', { class: 'muted small' }, item.hint) : null)));
  }
  dialog.body.append(list);
  return dialog.open().then((r) => (r ? r.value : null));
}
