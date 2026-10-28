// Calendars: the list, the card of one (name, colour, visibility, the star of
// the filter bar, ICS export, deletion) and, for an own calendar of an
// account, the block of shared access; for somebody else's - the way out.
// Joining a calendar by a link lives here too (the planner's JoinDialog).

import { h, icon, calStyle, toast, download, copyText, pickFile } from './dom.js';
import { Dialog, field, toggle, confirm, ask, chooseFrom } from './dialog.js';
import { colorPicker } from './fields.js';
import { calendarColor, isForeign, PALETTE_COLORS } from '../model/records.js';
import { MODES, modeTitle, modeHint, accessTitle, initialAccess, LINK_LIVES, memberTitle, plannerLink, tokenFromLink, sameServer } from '../model/share.js';
import { buildDocument, fileNameFor, importText } from '../core/ics.js';
import { api } from '../core/api.js';
import { pluralRu } from '../model/text.js';

export function exportCalendar(store, calendarId) {
  const calendar = store.calendar(calendarId);
  const text = buildDocument(store.events().filter((e) => e.calendarId === calendarId),
    store.tasks().filter((t) => t.calendarId === calendarId), calendar);
  download(fileNameFor(calendar), text, 'text/calendar;charset=utf-8');
}

export async function importCalendarFile(app) {
  const file = await pickFile('.ics,text/calendar');
  if (!file) return;
  const text = await file.text();
  const result = importText(text, app.store, file.name.replace(/\.[^.]+$/, ''));
  if (result.error) {
    toast(result.error);
    return;
  }
  toast(`«${result.calendarName}»: событий ${result.importedEvents}, задач ${result.importedTasks}${result.skipped ? `, пропущено ${result.skipped}` : ''}`, { timeout: 6000 });
}

export function manageCalendars(app) {
  const store = app.store;
  const dialog = new Dialog({ title: 'Календари', size: 'wide', closeLabel: 'Закрыть' });
  const list = h('div', { class: 'col', style: { gap: '2px' } });
  const render = () => {
    list.replaceChildren(...store.calendars().map((calendar) => {
      const events = store.eventCountIn(calendar.id), tasks = store.taskCountIn(calendar.id);
      return h('div', { class: 'line', style: calStyle(calendarColor(calendar)) },
        h('span', { class: 'dot', style: { width: '14px', height: '14px' } }),
        h('div', { class: 'body', on: { click: () => editCalendar(app, calendar.id) } },
          h('div', { class: 'title' }, calendar.name || 'Без названия'),
          h('div', { class: 'sub' }, `Событий: ${events} · Задач: ${tasks}`,
            isForeign(calendar) ? h('span', null, icon('share'), ` ${calendar.ownerLogin} · ${accessTitle(calendar.access).toLowerCase()}`) : null,
            calendar.shared ? h('span', null, icon('share'), ' открыт другим') : null)),
        h('button', { class: ['icon-btn', calendar.starred ? 'on' : ''], title: calendar.starred ? 'Убрать из панели под экранами' : 'Показать в панели под экранами',
          on: { click: () => store.setCalendarStarred(calendar.id, !calendar.starred) } }, icon(calendar.starred ? 'starFilled' : 'star')),
        h('button', { class: 'icon-btn', title: calendar.visible ? 'Скрыть' : 'Показать',
          on: { click: () => store.setCalendarVisible(calendar.id, !calendar.visible) } }, icon(calendar.visible ? 'eye' : 'eyeOff')));
    }));
  };
  render();
  const unsubscribe = store.subscribe(render);
  dialog.body.append(list);
  dialog.addButton('Новый', () => editCalendar(app, null), { iconName: 'plus' });
  if (app.account) dialog.addButton('По ссылке…', () => joinByLink(app, ''), { iconName: 'link' });
  dialog.addButton('Импорт ICS', () => importCalendarFile(app), { iconName: 'import' });
  return dialog.open().finally(unsubscribe);
}

/** The card of one calendar; @p id null makes a new one. */
export async function editCalendar(app, id) {
  const store = app.store;
  const original = id ? store.calendar(id) : null;
  const foreign = isForeign(original);
  const name = h('input', { type: 'text', value: original?.name || '', placeholder: 'Название', maxLength: 200 });
  let color = original ? calendarColor(original) : PALETTE_COLORS[store.calendars().length % PALETTE_COLORS.length];
  const colors = colorPicker(color, (c) => { color = c; });
  const visible = toggle('Показывать', original ? original.visible : true);
  const starred = toggle('В панели под экранами', original?.starred);
  const share = id && !foreign && app.account ? new SharePanel(app, id) : null;
  const dialog = new Dialog({ title: original ? 'Календарь' : 'Новый календарь', onSave: () => {
    const fresh = id ? store.calendar(id) : null;
    store.saveCalendar({ ...(fresh || {}), id: id || '', name: name.value.trim() || 'Без названия', color,
      visible: visible.input.checked, starred: starred.input.checked });
    return true;
  } });
  dialog.body.append(field('Название', name), field('Цвет', colors), visible, starred);
  if (foreign) {
    dialog.body.append(h('div', { class: 'share-box' },
      h('div', { class: 'row' }, icon('share'), h('b', null, 'Общий календарь')),
      h('div', null, `Владелец: ${original.ownerLogin}`),
      h('div', null, `Ваш доступ: ${accessTitle(original.access).toLowerCase()}`),
      h('div', { class: 'muted small' }, 'Название и цвет — ваши: у владельца они остаются прежними. Напоминания владельца к вам не приходят, свои вы ставите сами.'),
      h('button', { class: 'btn danger', style: { alignSelf: 'flex-start' }, on: { click: async () => {
        if (await leaveShared(app, id)) dialog.close(null);
      } } }, icon('logout'), 'Отказаться от доступа')));
  }
  if (share) dialog.body.append(share.el);
  if (id) {
    dialog.addButton('Экспорт ICS', () => exportCalendar(store, id), { iconName: 'download' });
    if (!foreign) dialog.addButton('Удалить', async () => { if (await deleteCalendar(app, id)) dialog.close(null); }, { danger: true, iconName: 'trash' });
  }
  const saved = await dialog.open();
  if (!saved && share) await share.revert();
}

async function deleteCalendar(app, id) {
  const store = app.store;
  const calendar = store.calendar(id);
  if (store.calendars().length < 2) {
    toast('Последний календарь удалить нельзя: записям негде будет храниться');
    return false;
  }
  const count = store.eventCountIn(id) + store.taskCountIn(id);
  let moveTo = '';
  if (count) {
    const others = store.calendars().filter((c) => c.id !== id && store.isCalendarWritable(c.id));
    const choice = await ask({
      title: `Удалить «${calendar.name}»?`,
      text: `В календаре ${count} ${pluralRu(count, 'запись', 'записи', 'записей')}. Что с ними сделать?`,
      options: [{ label: 'Отмена', value: null }, others.length ? { label: 'Перенести…', value: 'move', primary: true } : null,
        { label: 'Удалить вместе с ними', value: 'drop', danger: true }].filter(Boolean),
    });
    if (!choice) return false;
    if (choice === 'move') {
      moveTo = await chooseFrom({ title: 'Куда перенести записи', items: others.map((c) => ({ label: c.name, value: c.id, color: calendarColor(c) })) });
      if (!moveTo) return false;
    }
  } else if (!await confirm({ title: 'Удаление', text: `Удалить календарь «${calendar.name}»?`, ok: 'Удалить', danger: true })) {
    return false;
  }
  if (calendar.shared && app.account) await api.shareConfigure(id, false, calendar.shareMode);
  store.removeCalendar(id, moveTo);
  toast(`Календарь «${calendar.name}» удалён`);
  return true;
}

async function leaveShared(app, id) {
  const calendar = app.store.calendar(id);
  if (!await confirm({ title: 'Отказаться от доступа?', text: `Календарь «${calendar.name}» пропадёт с этого сайта и со всех ваших устройств. У владельца он останется.`, ok: 'Отказаться', danger: true })) return false;
  const result = await api.shareLeave(id);
  if (!result.ok && result.status !== 404) {
    toast(result.error);
    return false;
  }
  app.store.dropSharedCalendar(id);
  app.sync?.syncNow();
  return true;
}

/**
 * Shared access of an own calendar. The switch and the mode go to the server
 * at once - a link has to work while the card is open - and «Отмена» of the
 * card brings them back to what they were.
 */
class SharePanel {
  constructor(app, calendarId) {
    this.app = app;
    this.calendarId = calendarId;
    this.el = h('div', { class: 'share-box' }, h('div', { class: 'muted' }, 'Совместный доступ: спрашиваем сервер…'));
    this.initial = null;
    this.share = null;
    this.load();
  }

  async load() {
    const result = await api.share(this.calendarId);
    if (!result.ok) {
      this.el.replaceChildren(h('div', { class: 'row' }, icon('share'), h('b', null, 'Совместный доступ')),
        h('div', { class: 'error' }, result.error));
      return;
    }
    this.share = result.body.share && result.body.share.calendarId ? result.body.share : { enabled: false, mode: 'custom', members: [] };
    if (!this.initial) this.initial = { enabled: !!this.share.enabled, mode: this.share.mode || 'custom' };
    this.render();
  }

  render() {
    const share = this.share;
    const enabled = toggle('Открыть доступ другим', share.enabled, (on) => this.configure(on, share.mode || 'custom'));
    const parts = [h('div', { class: 'row' }, icon('share'), h('b', null, 'Совместный доступ')), enabled];
    if (share.enabled) {
      const mode = h('select', { on: { change: () => this.configure(true, mode.value) } },
        ...MODES.map((m) => h('option', { value: m, selected: (share.mode || 'custom') === m }, modeTitle(m))));
      parts.push(field('Тип доступа', mode, modeHint(share.mode || 'custom')));
      const members = share.members || [];
      parts.push(h('div', { class: 'label muted small' }, members.length ? `УЧАСТНИКИ · ${members.length}` : 'Участников пока нет'));
      for (const member of members) {
        const access = h('select', { disabled: share.mode !== 'custom', on: { change: () => this.memberAccess(member.login, access.value) } },
          h('option', { value: 'read', selected: member.access === 'read' }, accessTitle('read')),
          h('option', { value: 'edit', selected: member.access === 'edit' }, accessTitle('edit')));
        parts.push(h('div', { class: 'member' }, icon('user'), h('span', { class: 'grow ellipsis' }, memberTitle(member)), access,
          h('button', { class: 'icon-btn', title: 'Закрыть доступ', on: { click: () => this.removeMember(member) } }, icon('close'))));
      }
      parts.push(this.linkMaker());
    } else {
      parts.push(h('div', { class: 'muted small' }, 'Попасть в календарь можно только по ссылке, которую вы дадите. Её откроют в планере или на этом сайте.'));
    }
    this.el.replaceChildren(...parts);
  }

  linkMaker() {
    const use = h('select', null, h('option', { value: 'once' }, 'Одноразовая'), h('option', { value: 'many' }, 'Многоразовая'));
    const life = h('select', null, ...LINK_LIVES.map((l, i) => h('option', { value: i }, l.title)));
    const out = h('div', { class: 'col' });
    const make = h('button', { class: 'btn', on: { click: async () => {
      make.disabled = true;
      const result = await api.shareLink(this.calendarId, use.value === 'once', LINK_LIVES[+life.value].seconds);
      make.disabled = false;
      if (!result.ok) {
        toast(result.error);
        return;
      }
      const token = result.body.token;
      const web = `${location.origin}${location.pathname}#join=${encodeURIComponent(token)}`;
      const planner = plannerLink(this.app.serverAddress, token);
      const box = (label, value) => {
        const input = h('input', { type: 'text', value, readOnly: true, on: { focus: () => input.select() } });
        return field(label, h('div', { class: 'link-box' }, input,
          h('button', { class: 'btn', on: { click: async () => toast((await copyText(value)) ? 'Ссылка скопирована' : 'Не удалось скопировать') } }, icon('copy'), 'Копировать')));
      };
      out.replaceChildren(box('Ссылка для сайта', web), box('Ссылка для планера', planner),
        h('div', { class: 'muted small' }, result.body.expiresAt ? `Действует до ${new Date(result.body.expiresAt).toLocaleString('ru-RU')}` : 'Бессрочная'));
    } } }, icon('link'), 'Создать ссылку');
    return h('div', { class: 'col' }, h('div', { class: 'row wrap' }, use, life, make), out);
  }

  async configure(enabled, mode) {
    // The first calendar of a planner is a seed and has never been on the
    // server: it goes there now, or whoever follows the link finds nothing.
    const store = this.app.store;
    const calendar = store.calendar(this.calendarId);
    if (calendar && (calendar.shared !== enabled || calendar.shareMode !== mode)) {
      store.saveCalendar({ ...calendar, shared: enabled, shareMode: mode });
    }
    await this.app.sync?.syncNow();
    const result = await api.shareConfigure(this.calendarId, enabled, mode);
    if (!result.ok) {
      toast(result.error);
      await this.load();
      return;
    }
    this.share = result.body.share;
    this.render();
  }

  async memberAccess(login, access) {
    const result = await api.shareMember(this.calendarId, login, access);
    if (!result.ok) toast(result.error);
    else this.share = result.body.share;
    this.render();
  }

  async removeMember(member) {
    if (!await confirm({ title: 'Закрыть доступ?', text: `${memberTitle(member)} больше не увидит этот календарь`, ok: 'Закрыть доступ', danger: true })) return;
    const result = await api.shareRemove(this.calendarId, member.login);
    if (!result.ok) toast(result.error);
    else this.share = result.body.share;
    this.render();
  }

  /** «Отмена» of the card: the switch and the mode as they were when it opened. */
  async revert() {
    if (!this.initial || !this.share) return;
    if (this.initial.enabled === !!this.share.enabled && this.initial.mode === (this.share.mode || 'custom')) return;
    await api.shareConfigure(this.calendarId, this.initial.enabled, this.initial.mode);
    const calendar = this.app.store.calendar(this.calendarId);
    if (calendar) this.app.store.saveCalendar({ ...calendar, shared: this.initial.enabled, shareMode: this.initial.mode });
  }
}

/**
 * Adds somebody else's calendar by a link: shows where it leads, makes the
 * twin - a calendar of this account with its own name and colour - and asks
 * the server to let it in; the records come with the next exchange.
 */
export async function joinByLink(app, linkText) {
  const store = app.store;
  const input = h('input', { type: 'text', value: linkText || '', placeholder: 'Ссылка на календарь' });
  const info = h('div', { class: 'col' });
  const note = h('div', { class: 'muted small' });
  let peeked = null;
  let name = null, colors = null, color = '#4f6bed';
  const dialog = new Dialog({ title: 'Добавить календарь по ссылке', saveLabel: 'Добавить', onSave: async () => {
    if (!peeked) {
      await peek();
      return false;
    }
    note.textContent = 'Добавляем…';
    let twin = store.foreignCalendar(peeked.ownerLogin, peeked.originId);
    const fresh = !twin;
    const twinId = store.saveCalendar({ ...(twin || {}), id: twin?.id || '', name: name.value.trim() || 'Общий календарь', color,
      ownerLogin: peeked.ownerLogin, originId: peeked.originId, access: peeked.access, visible: true });
    const result = await api.shareJoin(peeked.token, twinId);
    if (!result.ok) {
      if (fresh) store.dropSharedCalendar(twinId);
      note.textContent = result.error;
      note.className = 'error';
      return false;
    }
    twin = store.calendar(twinId);
    store.saveCalendar({ ...twin, access: result.body.access === 'edit' ? 'edit' : 'read' });
    app.sync?.syncNow();
    toast(`Календарь «${twin.name}» добавлен — записи придут с синхронизацией`);
    return true;
  } });

  async function peek() {
    const { token, server } = tokenFromLink(input.value);
    info.replaceChildren();
    peeked = null;
    if (!token) {
      note.textContent = 'Скопируйте ссылку целиком и попробуйте ещё раз';
      note.className = 'error';
      return;
    }
    if (server && app.serverAddress && !sameServer(server, app.serverAddress)) {
      note.textContent = `Ссылка ведёт на сервер ${server}, а сайт работает с ${app.serverAddress}. Откройте её в планере с аккаунтом на том сервере.`;
      note.className = 'error';
      return;
    }
    note.textContent = 'Спрашиваем сервер…';
    note.className = 'muted small';
    const result = await api.sharePeek(token);
    if (!result.ok) {
      note.textContent = result.code === 'own_calendar' ? 'Это ссылка на ваш собственный календарь' : result.error;
      note.className = 'error';
      return;
    }
    const share = result.body.share;
    const calendar = result.body.calendar || {};
    peeked = { token, ownerLogin: share.ownerLogin, originId: share.calendarId, access: initialAccess(share.mode) };
    color = /^#[0-9a-f]{6}$/i.test(calendar.color || '') ? calendar.color : '#4f6bed';
    name = h('input', { type: 'text', value: calendar.name || 'Общий календарь' });
    colors = colorPicker(color, (c) => { color = c; });
    const existing = store.foreignCalendar(peeked.ownerLogin, peeked.originId);
    info.replaceChildren(
      h('div', null, `Календарь пользователя ${share.ownerName && share.ownerName !== share.ownerLogin ? `${share.ownerName} (${share.ownerLogin})` : share.ownerLogin} · ${accessTitle(peeked.access).toLowerCase()}`),
      field('Название у вас', name), field('Цвет у вас', colors),
      h('div', { class: 'muted small' }, 'Название и цвет — ваши, владелец их не увидит. Напоминания владельца к вам не придут.'));
    note.textContent = existing ? `Этот календарь у вас уже есть — «${existing.name}»` : '';
    note.className = 'muted small';
  }

  input.addEventListener('change', () => peek());
  dialog.body.append(field('Ссылка', h('div', { class: 'link-box' }, input, h('button', { class: 'btn', on: { click: () => peek() } }, 'Открыть'))), info, note);
  if (linkText) peek();
  return dialog.open();
}
