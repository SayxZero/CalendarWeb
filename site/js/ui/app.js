// The window of the site: the side panel (account, screens, a small month,
// calendars), the bar on top, the screen, the bar of starred calendars - and
// on a phone the same as an app bar, a drawer and a round "+". Everything a
// screen asks for (open, make, move, copy, delete a record) is done here, as
// the planner's MainWindow does it.

import { h, icon, clear, calStyle, isMobile, mobileQuery, toast, openMenu, closeMenus } from './dom.js';
import { Dialog, ask, confirm, dialogOpen } from './dialog.js';
import { settings } from './settings.js';
import { applyPalette } from './theme.js';
import { MonthView } from './views/month.js';
import { WeekView } from './views/week.js';
import { YearView } from './views/year.js';
import { AgendaView } from './views/agenda.js';
import { TasksView } from './views/tasks.js';
import { HabitsView } from './views/habits.js';
import { RemindersView } from './views/reminders.js';
import { StatsView } from './views/stats.js';
import { taskLine, eventLine } from './views/rows.js';
import { showEvent, showTask } from './detail.js';
import { editEvent, editTask, editReminder, defaultEventReminders, defaultTaskReminders } from './editors.js';
import { pickDays } from './fields.js';
import { manageCalendars, editCalendar, joinByLink } from './calendars.js';
import { openSettings } from './settingsDialog.js';
import {
  today, addDays, at, dateOf, minuteOfDay, toSeconds, fromSeconds, daysTo, parts, startOfMonth, startOfWeek,
  addMonths, isValidDate, nowSeconds, DAY_SECONDS,
} from '../model/dates.js';
import { longDate, monthTitle, MONTHS, MONTHS_GENITIVE, WEEKDAYS_SHORT, capitalize, pluralRu } from '../model/text.js';
import { isActive, normalizeRule } from '../model/recurrence.js';
import { DEFAULT_START_MINUTES } from '../model/reminders.js';
import { Kind, normalize, isClosed, calendarColor, isForeign } from '../model/records.js';
import { nextReminderText } from '../core/alarms.js';

// In the order of the planner's list of screens.
const SCREENS = [
  ['year', 'Год', 'year'], ['month', 'Месяц', 'month'], ['week', 'Неделя', 'week'], ['day', 'День', 'day'],
  ['agenda', 'Повестка', 'agenda'], ['tasks', 'Задачи', 'tasks'], ['reminders', 'Напоминания', 'bell'],
  ['habits', 'Привычки', 'habits'], ['stats', 'Статистика', 'stats'],
];

export class App {
  constructor({ store, sync, engine, account, serverAddress, version, offline = false, onSignOut }) {
    this.store = store;
    this.sync = sync;
    this.engine = engine;
    this.account = account;
    this.serverAddress = serverAddress;
    this.version = version;
    this.offline = offline;
    this.onSignOut = onSignOut;
    this.search = '';
    this.viewName = SCREENS.some(([k]) => k === settings.get('lastView')) ? settings.get('lastView') : 'month';
    this.anchor = today();
    this.views = {
      month: new MonthView(this), week: new WeekView(this, 'week'), day: new WeekView(this, 'day'), year: new YearView(this),
      agenda: new AgendaView(this), tasks: new TasksView(this), habits: new HabitsView(this), reminders: new RemindersView(this), stats: new StatsView(this),
    };
    this.renderQueued = false;
  }

  get view() {
    return this.views[this.viewName];
  }

  // ------------------------------------------------------------- building

  mount(root) {
    this.root = root;
    this.readHash();
    this.applyTheme();
    this.sidebar = h('aside', { class: 'sidebar' });
    this.titleEl = h('div', { class: 'title' });
    this.toolbarSlot = h('div', { class: 'row' });
    this.searchInput = h('input', { type: 'search', placeholder: 'Поиск', on: { input: () => this.setSearch(this.searchInput.value) } });
    this.searchBox = h('div', { class: 'search row' }, isMobile() ? h('button', { class: 'icon-btn', on: { click: () => this.closeSearch() } }, icon('back')) : null, this.searchInput);
    this.navButtons = h('div', { class: 'row' });
    this.topbar = h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn menu-btn', title: 'Меню', attrs: { 'aria-label': 'Меню' }, on: { click: () => this.toggleDrawer(true) } }, icon('menu')),
      this.titleEl, this.navButtons, h('span', { class: 'grow desktop-only' }), this.toolbarSlot, this.searchBox,
      h('button', { class: 'icon-btn', title: 'Поиск', style: isMobile() ? null : { display: 'none' }, on: { click: () => this.openSearch() } }, icon('search')),
      h('button', { class: 'btn primary desktop-only', title: 'Создать', on: { click: (e) => this.createMenu(e.currentTarget) } }, icon('plus'), 'Создать'),
      h('button', { class: 'icon-btn', title: 'Ещё', on: { click: (e) => this.moreMenu(e.currentTarget) } }, icon('more')));
    this.viewEl = h('div', { class: 'view' });
    this.filterBar = h('div', { class: 'filterbar' });
    this.statusEl = h('div', { class: 'status-line' });
    this.banner = h('div', { class: 'offline-banner', hidden: true });
    this.fab = h('button', { class: 'fab', title: 'Создать', attrs: { 'aria-label': 'Создать' }, on: { click: () => this.fabAction() } }, icon('plus'));
    this.shell = h('div', { class: 'shell' },
      this.sidebar,
      h('div', { class: 'drawer-scrim', on: { click: () => this.toggleDrawer(false) } }),
      h('main', { class: 'main' }, this.banner, this.topbar, this.viewEl, this.filterBar, this.statusEl),
      this.fab);
    clear(root).append(this.shell);
    this.listenOnce();
    this.render();
  }

  /**
   * The window is built again when the layout changes (computer <-> phone) or
   * after signing in again; what it listens to is set up only the first time.
   */
  listenOnce() {
    if (this.listening) return;
    this.listening = true;
    this.store.subscribe(() => this.scheduleRender());
    this.sync?.subscribe((event) => this.onSync(event));
    settings.addEventListener('change', () => this.scheduleRender());
    mobileQuery.addEventListener('change', () => this.mount(this.root));
    window.addEventListener('hashchange', () => { if (this.readHash()) this.render(); });
    window.addEventListener('resize', () => { if (this.viewName === 'month') this.scheduleRender(); });
    document.addEventListener('keydown', (e) => this.onKey(e));
    this.edgeSwipe();
    setInterval(() => this.midnightCheck(), 60000);
  }

  applyTheme() {
    applyPalette(settings.activePalette(), settings.get('highlightWeekends'));
  }

  scheduleRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  render() {
    if (!this.root) return;
    const view = this.view;
    view.destroy?.();
    const keepScroll = this.viewEl.querySelector('.scroll')?.scrollTop ?? 0;
    clear(this.viewEl);
    view.render(this.viewEl);
    const scroll = this.viewEl.querySelector('.scroll');
    if (scroll && this.lastRendered === this.viewName) scroll.scrollTop = keepScroll;
    this.lastRendered = this.viewName;
    this.renderChrome();
    this.writeHash();
  }

  renderChrome() {
    const view = this.view;
    this.titleEl.textContent = view.title();
    document.title = `${view.title()} — Космос календарь`;
    // On a phone the period moves by a swipe, as in the planner: only «Сегодня» stays.
    this.navButtons.replaceChildren(...(view.hasDateNav && !this.search ? (isMobile() ? [
      h('button', { class: 'icon-btn', title: 'Сегодня', attrs: { 'aria-label': 'Сегодня' }, on: { click: () => this.goToday() } }, icon('today')),
    ] : [
      h('button', { class: 'icon-btn', title: 'Назад', attrs: { 'aria-label': 'Назад' }, on: { click: () => view.step(-1) } }, icon('left')),
      h('button', { class: 'btn flat', title: 'Сегодня', on: { click: () => this.goToday() } }, 'Сегодня'),
      h('button', { class: 'icon-btn', title: 'Вперёд', attrs: { 'aria-label': 'Вперёд' }, on: { click: () => view.step(1) } }, icon('right')),
    ]) : []));
    this.toolbarSlot.replaceChildren(...[view.toolbar?.()].filter(Boolean));
    this.renderSidebar();
    this.renderFilterBar();
    this.renderStatus();
  }

  renderSidebar() {
    const store = this.store;
    const user = this.account || {};
    const sidebar = this.sidebar;
    const syncState = this.syncStateLine();
    const nav = h('nav', { class: 'nav' }, ...SCREENS.map(([key, title, iconName]) => h('button', {
      class: key === this.viewName && !this.search ? 'on' : '',
      on: { click: () => { this.closeSearch(); this.go(key); this.toggleDrawer(false); } },
    }, icon(iconName), h('span', { class: 'label' }, title), h('span', { class: 'detail' }, this.navDetail(key)))));
    const calendars = h('div', { class: 'calendar-list' }, ...store.calendars().map((calendar) => h('div', { class: 'calendar-row', style: calStyle(calendarColor(calendar)) },
      h('button', {
        class: ['check', 'square', calendar.visible ? 'done' : ''], title: calendar.visible ? 'Скрыть' : 'Показать',
        on: { click: () => store.setCalendarVisible(calendar.id, !calendar.visible) },
      }, calendar.visible ? icon('check') : null),
      h('span', { class: 'name', title: calendar.name, on: { click: () => editCalendar(this, calendar.id) } }, calendar.name || 'Без названия'),
      isForeign(calendar) ? h('span', { class: 'tag', title: `Календарь ${calendar.ownerLogin}` }, icon('share')) : null,
      calendar.starred ? h('span', { class: 'tag' }, icon('starFilled')) : null)));
    sidebar.replaceChildren(
      h('div', { class: 'account' },
        h('span', { class: 'avatar' }, (user.displayName || user.login || '?')[0].toUpperCase()),
        h('div', { class: 'who' }, h('div', { class: 'name ellipsis' }, user.displayName || user.login || ''), syncState),
        h('button', { class: 'icon-btn', title: 'Синхронизировать сейчас', on: { click: () => this.sync?.syncNow() } }, icon('sync'))),
      nav,
      isMobile() ? null : this.miniCalendar(),
      h('div', { class: 'side-section' }, h('span', { class: 'grow' }, 'Календари'),
        h('button', { class: 'icon-btn', title: 'Новый календарь', on: { click: () => editCalendar(this, null) } }, icon('plus')),
        h('button', { class: 'icon-btn', title: 'Управление календарями', on: { click: () => manageCalendars(this) } }, icon('settings'))),
      calendars,
      h('nav', { class: 'nav' },
        h('button', { on: { click: () => { this.toggleDrawer(false); joinByLink(this, ''); } } }, icon('link'), h('span', { class: 'label' }, 'Календарь по ссылке')),
        h('button', { on: { click: () => { this.toggleDrawer(false); openSettings(this); } } }, icon('settings'), h('span', { class: 'label' }, 'Настройки'))));
  }

  syncStateLine() {
    const state = this.sync?.state || 'idle';
    if (state === 'syncing') return h('div', { class: 'sync-state' }, h('span', { class: 'spin' }, icon('sync')), 'Синхронизация…');
    if (state === 'offline') return h('div', { class: 'sync-state bad' }, icon('offline'), 'Нет связи');
    if (state === 'error') return h('div', { class: 'sync-state bad', title: this.sync.error }, icon('offline'), 'Ошибка синхронизации');
    if (state === 'auth') return h('div', { class: 'sync-state bad' }, 'Войдите снова');
    const pending = this.store.journal.size;
    const last = this.sync?.lastSync;
    return h('div', { class: 'sync-state' }, pending ? `Ждут отправки: ${pending}` : last ? `Синхронизировано в ${last.slice(11, 16)}` : this.account?.login || '');
  }

  navDetail(key) {
    const store = this.store;
    const anchor = this.anchor;
    switch (key) {
      case 'month': return monthTitle(anchor).toLowerCase();
      case 'week': {
        const start = startOfWeek(anchor, settings.get('firstDayOfWeek'));
        const end = addDays(start, 6);
        return parts(start).m === parts(end).m ? `${parts(start).d}–${parts(end).d} ${MONTHS_GENITIVE[parts(end).m - 1]}`
          : `${parts(start).d} ${MONTHS_GENITIVE[parts(start).m - 1].slice(0, 3)} – ${parts(end).d} ${MONTHS_GENITIVE[parts(end).m - 1].slice(0, 3)}`;
      }
      case 'day': return `${parts(anchor).d} ${MONTHS_GENITIVE[parts(anchor).m - 1]}`;
      case 'year': return String(parts(anchor).y);
      case 'agenda': return '';
      case 'tasks': return `открыто: ${store.openTasks().length}`;
      case 'habits': {
        const habits = store.habits();
        return habits.length ? `сегодня: ${store.habitsDoneOn(today())} из ${habits.length}` : '';
      }
      case 'reminders': return nextReminderText(store);
      case 'stats': return `выполнено: ${store.completedInLastDays(30)}`;
      default: return '';
    }
  }

  miniCalendar() {
    const month = startOfMonth(this.miniMonth || this.anchor);
    const firstDay = settings.get('firstDayOfWeek');
    const first = startOfWeek(month, firstDay);
    const last = addDays(first, 41);
    const busy = new Set();
    const hidden = this.store.hiddenCalendars();
    for (const o of this.store.occurrences(first, last)) if (!hidden.has(o.event.calendarId)) busy.add(dateOf(o.start));
    const grid = h('div', { class: 'mini-grid' }, ...Array.from({ length: 7 }, (_, i) => h('div', { class: 'wd' }, WEEKDAYS_SHORT[(firstDay - 1 + i) % 7])));
    for (let i = 0; i < 42; ++i) {
      const date = addDays(first, i);
      grid.append(h('button', {
        class: [parts(date).m !== parts(month).m ? 'out' : '', date === today() ? 'today' : '', date === this.anchor ? 'sel' : '', busy.has(date) ? 'has' : ''],
        on: { click: () => this.go(['month', 'week', 'day', 'year'].includes(this.viewName) ? this.viewName : 'day', date) },
      }, String(parts(date).d)));
    }
    return h('div', { class: 'mini' },
      h('div', { class: 'mini-head' },
        h('button', { class: 'icon-btn', title: 'Предыдущий месяц', on: { click: () => { this.miniMonth = addMonths(month, -1); this.renderSidebar(); } } }, icon('left')),
        h('span', null, `${capitalize(MONTHS[parts(month).m - 1])} ${parts(month).y}`),
        h('button', { class: 'icon-btn', title: 'Следующий месяц', on: { click: () => { this.miniMonth = addMonths(month, 1); this.renderSidebar(); } } }, icon('right'))),
      grid);
  }

  /** Chips of the starred calendars: a tap shows or hides, holding shows that one alone. */
  renderFilterBar() {
    const starred = this.store.calendars().filter((c) => c.starred);
    const show = this.view.showFilterBar && starred.length > 0;
    this.filterBar.hidden = !show;
    if (!show) return;
    this.filterBar.className = ['filterbar', settings.get('filterBarSingleRow') ? 'compact' : ''].join(' ');
    this.filterBar.replaceChildren(...starred.map((calendar) => {
      const chip = h('button', { class: ['chip', calendar.visible ? '' : 'off'], style: calStyle(calendarColor(calendar)), title: calendar.name },
        h('span', { class: 'fill' }), h('span', { class: 'dot' }), h('span', { class: 'label' }, calendar.name));
      let timer = 0, held = false;
      const release = () => { clearTimeout(timer); chip.classList.remove('holding'); };
      chip.addEventListener('pointerdown', () => {
        held = false;
        chip.classList.add('holding');
        timer = setTimeout(() => {
          held = true;
          chip.classList.remove('holding');
          const visible = this.store.calendars().filter((c) => c.visible);
          if (visible.length === 1 && visible[0].id === calendar.id) {
            this.store.setVisibleCalendars(new Set(this.store.calendars().map((c) => c.id)));
            toast('Показаны все календари');
          } else {
            this.store.setVisibleCalendars(new Set([calendar.id]));
            toast(`Показан только «${calendar.name}»`);
          }
        }, 600);
      });
      chip.addEventListener('pointerup', release);
      chip.addEventListener('pointerleave', release);
      chip.addEventListener('pointercancel', release);
      chip.addEventListener('click', () => {
        if (held) return;
        this.store.setCalendarVisible(calendar.id, !calendar.visible);
        toast(`Календарь «${calendar.name}» ${calendar.visible ? 'скрыт' : 'показан'}`);
      });
      return chip;
    }));
  }

  renderStatus() {
    const state = this.sync?.state;
    const pending = this.store.journal.size;
    const offline = this.offline || state === 'offline';
    this.banner.hidden = !offline && state !== 'auth';
    this.banner.textContent = state === 'auth' ? 'Сервер не принимает ваш вход — войдите снова (Настройки → Аккаунт)'
      : `Нет связи с сервером синхронизации — правки сохраняются в браузере${pending ? ` (${pending})` : ''} и уйдут, когда связь вернётся`;
    const tasksOpen = this.store.openTasks().length;
    this.statusEl.className = ['status-line', state === 'error' ? 'warn' : ''].join(' ');
    this.statusEl.textContent = [
      state === 'error' ? `Ошибка синхронизации: ${this.sync.error}` : this.sync?.lastSync ? `Синхронизировано: ${this.sync.lastSync.replace('T', ' ').slice(0, 16)}` : '',
      pending ? `ждут отправки: ${pending}` : '',
      `открытых задач: ${tasksOpen}, просрочено: ${this.store.overdueCount()}`,
      this.serverAddress ? `сервер ${this.serverAddress}` : '',
    ].filter(Boolean).join(' · ');
  }

  // ---------------------------------------------------------- navigation

  go(viewName, date = null) {
    if (date && isValidDate(date)) this.anchor = date;
    if (viewName !== this.viewName) {
      this.view.destroy?.();
      this.viewName = viewName;
      settings.set('lastView', viewName, { quiet: true });
      if (viewName === 'week') {
        // A screen opened by its name comes in its own scale.
        this.views.week.scrollTop = null;
      }
    }
    this.miniMonth = null;
    this.render();
  }

  setAnchor(date) {
    this.anchor = date;
    this.miniMonth = null;
    this.render();
  }

  goToday() {
    this.anchor = today();
    this.views.week.scrollTop = null;
    this.views.day.scrollTop = null;
    this.render();
  }

  readHash() {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash.startsWith('join=')) {
      const token = hash.slice(5);
      history.replaceState(null, '', location.pathname);
      setTimeout(() => joinByLink(this, `${location.origin}/#join=${token}`), 50);
      return false;
    }
    const match = /^\/(\w+)(?:\/(\d{4}-\d{2}-\d{2}))?/.exec(hash);
    if (!match || !this.views?.[match[1]]) return false;
    const changed = match[1] !== this.viewName || (match[2] && match[2] !== this.anchor);
    this.viewName = match[1];
    if (match[2] && isValidDate(match[2])) this.anchor = match[2];
    return changed;
  }

  writeHash() {
    const hash = `#/${this.viewName}/${this.anchor}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  toggleDrawer(open) {
    this.shell?.classList.toggle('drawer-open', open && isMobile());
  }

  /** On a phone a swipe from the left edge opens the drawer, as in the planner. */
  edgeSwipe() {
    let start = null;
    document.addEventListener('touchstart', (e) => {
      start = e.touches.length === 1 && e.touches[0].clientX < 24 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!start || !isMobile()) return;
      const t = e.changedTouches[0];
      if (t.clientX - start.x > 60 && Math.abs(t.clientY - start.y) < 60) this.toggleDrawer(true);
      start = null;
    }, { passive: true });
  }

  setSearch(text) {
    this.search = text;
    if (text && this.viewName !== 'tasks' && this.viewName !== 'agenda') {
      this.beforeSearch = this.viewName;
      this.viewName = 'agenda';
    }
    if (!text && this.beforeSearch) {
      this.viewName = this.beforeSearch;
      this.beforeSearch = null;
    }
    this.render();
  }

  openSearch() {
    this.searchBox.classList.add('open');
    this.searchInput.focus();
  }

  closeSearch() {
    this.searchBox.classList.remove('open');
    if (this.search) {
      this.searchInput.value = '';
      this.setSearch('');
    }
  }

  onKey(e) {
    if (dialogOpen() || document.querySelector('.menu') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select')) {
      if (e.key === 'Escape' && e.target === this.searchInput) this.closeSearch();
      return;
    }
    const view = this.view;
    if (e.key === 'ArrowLeft' && view.hasDateNav) view.step(-1);
    else if (e.key === 'ArrowRight' && view.hasDateNav) view.step(1);
    else if (e.key === 't' || e.key === 'е') this.goToday();
    else if (e.key === 'n' || e.key === 'т') this.newEvent({ date: this.anchor });
    else if (e.key === '/') { e.preventDefault(); if (isMobile()) this.openSearch(); else this.searchInput.focus(); }
    else return;
    e.preventDefault();
  }

  midnightCheck() {
    const day = today();
    if (this.lastDay && this.lastDay !== day) this.render();
    this.lastDay = day;
  }

  // -------------------------------------------------------------- menus

  createMenu(anchor) {
    openMenu(anchor, [
      { label: 'Событие', icon: 'month', action: () => this.newEvent({ date: this.calendarDate() }) },
      { label: 'Задача', icon: 'tasks', action: () => this.newTask({ date: this.viewName === 'tasks' ? null : this.calendarDate() }) },
      { label: 'Напоминание', icon: 'bell', action: () => this.newReminder() },
      { label: 'Привычка', icon: 'habits', action: () => { this.go('habits'); this.views.habits.edit(null); } },
      'sep',
      { label: 'Календарь', icon: 'calendars', action: () => editCalendar(this, null) },
    ]);
  }

  moreMenu(anchor) {
    openMenu(anchor, [
      { label: 'Синхронизировать сейчас', icon: 'sync', action: () => this.sync?.syncNow() },
      { label: 'Календари…', icon: 'calendars', action: () => manageCalendars(this) },
      { label: 'Добавить календарь по ссылке…', icon: 'link', action: () => joinByLink(this, '') },
      { label: 'Настройки', icon: 'settings', action: () => openSettings(this) },
      'sep',
      { label: 'Выйти из аккаунта', icon: 'logout', action: () => this.signOut() },
    ]);
  }

  fabAction() {
    switch (this.viewName) {
      case 'tasks': return this.newTask({ date: null });
      case 'habits': return this.views.habits.edit(null);
      case 'reminders': return this.newReminder();
      case 'stats': return this.createMenu(this.fab);
      default: return this.newEvent({ date: this.calendarDate() });
    }
  }

  /** The day a new record of a calendar screen lands on. */
  calendarDate() {
    if (this.viewName === 'month') {
      const p = parts(this.anchor);
      return parts(today()).m === p.m && parts(today()).y === p.y ? today() : startOfMonth(this.anchor);
    }
    if (this.viewName === 'week') {
      const start = this.views.week.start();
      const days = this.views.week.days();
      return daysTo(start, today()) >= 0 && daysTo(start, today()) < days ? today() : start;
    }
    return this.viewName === 'day' ? this.anchor : today();
  }

  /** What a day holds and what can be made on it. */
  dayMenu(date, point) {
    const hidden = this.store.hiddenCalendars();
    const occurrences = this.store.occurrencesOn(date).filter((o) => !hidden.has(o.event.calendarId));
    const tasks = this.store.tasksOn(date).filter((t) => !hidden.has(t.calendarId));
    if (!point) {
      const dialog = new Dialog({ title: capitalize(longDate(date)), sheet: true, closeLabel: 'Закрыть' });
      dialog.body.append(
        ...occurrences.map((o) => { const line = eventLine(this, o); line.addEventListener('click', () => dialog.close(null), true); return line; }),
        ...tasks.map((t) => { const line = taskLine(this, t, { actions: false }); line.querySelector('.body').addEventListener('click', () => dialog.close(null), true); return line; }),
        !occurrences.length && !tasks.length ? h('div', { class: 'muted' }, 'В этот день записей нет') : null);
      dialog.addButton('Событие', () => { dialog.close(null); this.newEvent({ date }); }, { iconName: 'plus' });
      dialog.addButton('Задача', () => { dialog.close(null); this.newTask({ date }); }, { iconName: 'plus' });
      dialog.addButton('День', () => { dialog.close(null); this.go('day', date); }, { iconName: 'day' });
      dialog.open();
      return;
    }
    openMenu(point, [
      { title: capitalize(longDate(date)) },
      ...occurrences.slice(0, 8).map((o) => ({ label: o.event.title || 'Без названия', hint: o.event.allDay ? 'весь день' : o.start.slice(11, 16), dot: this.store.eventColor(o.event), action: () => this.openOccurrence(o) })),
      ...tasks.slice(0, 8).map((t) => ({ label: `${isClosed(t) ? '✓ ' : ''}${t.title || 'Без названия'}`, hint: t.hasDueTime ? t.dueAt.slice(11, 16) : 'задача', dot: this.store.taskColor(t), action: () => this.openTask(t) })),
      occurrences.length + tasks.length > 16 ? { label: `Ещё ${occurrences.length + tasks.length - 16}…`, action: () => this.go('day', date) } : null,
      occurrences.length || tasks.length ? 'sep' : null,
      { label: 'Новое событие…', icon: 'plus', action: () => this.newEvent({ date }) },
      { label: 'Новая задача…', icon: 'tasks', action: () => this.newTask({ date }) },
      { label: 'Открыть день', icon: 'day', action: () => this.go('day', date) },
    ]);
  }

  // ------------------------------------------------------ record actions

  openOccurrence(occurrence) {
    closeMenus();
    showEvent(this, occurrence);
  }

  openTask(task) {
    closeMenus();
    showTask(this, task);
  }

  /**
   * Asks the server for the record before it is changed (an edit made a
   * minute ago elsewhere wins over a stale copy); waits 2.5 s at most.
   */
  async freshen(kind, id) {
    if (!this.sync || this.sync.state === 'offline' || this.sync.state === 'auth') return;
    let overlay = null;
    const timer = setTimeout(() => {
      overlay = h('div', { class: 'busy' }, h('span', { class: 'spin' }, icon('sync')), 'Проверяем, нет ли правок с других устройств…');
      document.body.append(overlay);
    }, 300);
    try {
      await this.sync.refreshRecord(kind, id);
    } finally {
      clearTimeout(timer);
      overlay?.remove();
    }
  }

  refuseReadOnly(record) {
    if (this.store.canEdit(record)) return false;
    toast('Календарь открыт только для чтения — запись можно только скопировать');
    this.render();
    return true;
  }

  /** "Только это повторение или всю серию?" -> 'one', 'all' or null. */
  askSeries(title) {
    return ask({ title, text: 'Событие повторяется.', options: [
      { label: 'Отмена', value: null },
      { label: 'Только это', value: 'one' },
      { label: 'Все повторения', value: 'all', primary: true },
    ] });
  }

  async newEvent({ date = today(), minutes = null, endMinutes = null, allDay = false } = {}) {
    const startMinutes = allDay ? 0 : minutes ?? DEFAULT_START_MINUTES;
    const start = at(date, startMinutes);
    const end = allDay ? at(date, 23 * 60 + 59) : endMinutes != null ? at(date, Math.min(endMinutes, 1439)) : fromSeconds(toSeconds(start) + settings.get('defaultEventDuration') * 60);
    const draft = { title: '', start, end, allDay, reminders: defaultEventReminders(allDay), recurrence: normalizeRule(null) };
    const result = await editEvent(this, draft, { isNew: true });
    if (result) {
      this.store.saveEvent(result);
      toast('Событие сохранено');
    }
  }

  async editOccurrence(occurrence) {
    await this.freshen(Kind.event, occurrence.event.id);
    const event = this.store.event(occurrence.event.id);
    if (!event) return toast('Событие удалено на другом устройстве');
    if (this.refuseReadOnly(event)) return;
    let scope = 'all';
    if (isActive(event.recurrence)) {
      scope = await this.askSeries('Изменить повторяющееся событие');
      if (!scope) return;
    }
    const draft = scope === 'one'
      ? { ...structuredClone(event), start: occurrence.start, end: occurrence.end, recurrence: normalizeRule(null) }
      : event;
    const result = await editEvent(this, draft);
    if (!result) return;
    if (scope === 'one') {
      const detached = this.store.detachOccurrence(event.id, occurrence.seedDate);
      this.store.saveEvent({ ...result, id: detached.id, createdAt: detached.createdAt });
    } else {
      this.store.saveEvent(result);
    }
  }

  async deleteOccurrence(occurrence) {
    const event = this.store.event(occurrence.event.id);
    if (!event || this.refuseReadOnly(event)) return;
    if (isActive(event.recurrence)) {
      const choice = await ask({ title: 'Удалить повторяющееся событие', text: `«${event.title || 'Без названия'}»`, options: [
        { label: 'Отмена', value: null }, { label: 'Только это', value: 'one', danger: true }, { label: 'Все повторения', value: 'all', danger: true },
      ] });
      if (choice === 'one') this.store.excludeOccurrence(event.id, occurrence.seedDate);
      else if (choice === 'all') this.store.removeEvent(event.id);
      return;
    }
    if (await confirm({ title: 'Удаление', text: `Удалить событие «${event.title || 'Без названия'}»?`, ok: 'Удалить', danger: true })) {
      this.store.removeEvent(event.id);
    }
  }

  async toggleCancelled(occurrence) {
    const event = this.store.event(occurrence.event.id);
    if (!event || this.refuseReadOnly(event)) return;
    let scope = 'all';
    if (isActive(event.recurrence)) {
      scope = await this.askSeries(event.cancelled ? 'Вернуть событие' : 'Отменить событие');
      if (!scope) return;
    }
    if (scope === 'one') {
      const copy = this.store.detachOccurrence(event.id, occurrence.seedDate);
      this.store.saveEvent({ ...copy, cancelled: !event.cancelled });
    } else {
      this.store.saveEvent({ ...event, cancelled: !event.cancelled });
    }
  }

  /** Dragged to another day (and, on the week, another hour). */
  async moveOccurrence(occurrence, newDate, newStartMinute) {
    const event = this.store.event(occurrence.event.id);
    if (!event) return;
    if (this.refuseReadOnly(event)) return;
    const shift = daysTo(dateOf(occurrence.start), newDate) * DAY_SECONDS
      + (newStartMinute == null ? 0 : (newStartMinute - minuteOfDay(occurrence.start)) * 60);
    if (!shift) return;
    if (isActive(event.recurrence)) {
      const scope = await this.askSeries('Перенести повторяющееся событие');
      if (!scope) return this.render();
      if (scope === 'all') {
        this.store.saveEvent({ ...event, start: fromSeconds(toSeconds(event.start) + shift), end: fromSeconds(toSeconds(event.end) + shift) });
        return;
      }
    }
    this.store.moveOccurrence(occurrence, newDate, newStartMinute);
  }

  /** The bottom edge of a block pulled to @p endMinute of its first day. */
  async resizeOccurrence(occurrence, endMinute) {
    const event = this.store.event(occurrence.event.id);
    if (!event || this.refuseReadOnly(event)) return;
    const newEnd = endMinute >= 1440 ? at(addDays(dateOf(occurrence.start), 1), 0) : at(dateOf(occurrence.start), endMinute);
    const length = toSeconds(newEnd) - toSeconds(occurrence.start);
    if (length <= 0) return this.render();
    let scope = 'all';
    if (isActive(event.recurrence)) {
      scope = await this.askSeries('Изменить длительность повторяющегося события');
      if (!scope) return this.render();
    }
    const base = scope === 'one' ? this.store.detachOccurrence(event.id, occurrence.seedDate) : event;
    this.store.saveEvent({ ...base, end: fromSeconds(toSeconds(base.start) + length) });
  }

  /** «Дублировать», «Размножить», «Перенести» of the copy menu. */
  async copyOccurrence(occurrence, mode) {
    const event = this.store.event(occurrence.event.id) || occurrence.event;
    const days = await pickDays({ title: mode === 'many' ? 'Размножить на дни' : mode === 'move' ? 'Перенести на день' : 'Дублировать на день',
      start: dateOf(occurrence.start), multiple: mode === 'many', store: this.store });
    if (!days?.length) return;
    if (mode === 'move') return this.moveOccurrence(occurrence, days[0], null);
    const calendarId = this.store.canEdit(event) ? event.calendarId : this.store.defaultWritableCalendarId();
    const length = toSeconds(occurrence.end) - toSeconds(occurrence.start);
    for (const day of days) {
      const start = at(day, minuteOfDay(occurrence.start));
      this.store.saveEvent({ ...structuredClone(event), id: '', calendarId, start, end: fromSeconds(toSeconds(start) + length),
        recurrence: normalizeRule(null), createdAt: null, updatedAt: null });
    }
    toast(days.length === 1 ? 'Копия создана' : `Создано копий: ${days.length}`);
  }

  async newTask({ date = null } = {}) {
    const hasTime = false;
    const draft = { title: '', dueAt: date ? at(date, 0) : null, hasDueTime: hasTime, reminders: date ? defaultTaskReminders(hasTime) : [], subtasks: [], recurrence: normalizeRule(null) };
    const result = await editTask(this, draft, { isNew: true });
    if (result) {
      this.store.saveTask({ ...result, id: '' });
      toast('Задача сохранена');
    }
  }

  async editTask(task) {
    await this.freshen(Kind.task, task.id);
    const fresh = this.store.task(task.id);
    if (!fresh) return toast('Задача удалена на другом устройстве');
    if (this.refuseReadOnly(fresh)) return;
    const result = await editTask(this, fresh);
    if (result) this.store.saveTask(result);
  }

  async deleteTask(task) {
    if (this.refuseReadOnly(task)) return;
    if (await confirm({ title: 'Удаление', text: `Удалить задачу «${task.title || 'Без названия'}»?`, ok: 'Удалить', danger: true })) {
      this.store.removeTask(task.id);
    }
  }

  setTaskDone(task, done) {
    if (this.refuseReadOnly(task)) return;
    const repeating = isActive(task.recurrence) && task.dueAt;
    this.store.setTaskDone(task.id, done);
    if (done && repeating) {
      const next = this.store.task(task.id);
      toast(`Выполнено. Следующий раз — ${longDate(dateOf(next.dueAt))}`);
    }
  }

  setTaskFailed(task, failed) {
    if (this.refuseReadOnly(task)) return;
    this.store.setTaskFailed(task.id, failed);
  }

  setSubtaskDone(task, subtaskId, done) {
    if (this.refuseReadOnly(task)) return;
    this.store.setSubtaskDone(task.id, subtaskId, done);
  }

  async copyTask(task, mode) {
    const days = await pickDays({ title: mode === 'many' ? 'Размножить на дни' : mode === 'move' ? 'Перенести на день' : 'Дублировать на день',
      start: task.dueAt ? dateOf(task.dueAt) : today(), multiple: mode === 'many', store: this.store });
    if (!days?.length) return;
    const minute = task.dueAt ? minuteOfDay(task.dueAt) : 0;
    if (mode === 'move') {
      if (this.refuseReadOnly(task)) return;
      this.store.saveTask({ ...this.store.task(task.id), dueAt: at(days[0], minute) });
      return;
    }
    const calendarId = this.store.canEdit(task) ? task.calendarId : this.store.defaultWritableCalendarId();
    for (const day of days) {
      this.store.saveTask({ ...structuredClone(task), id: '', calendarId, dueAt: at(day, minute), done: false, failed: false, completedAt: null,
        recurrence: normalizeRule(null), reminders: task.dueAt ? task.reminders : [],
        subtasks: task.subtasks.map((s) => ({ ...s, id: '', done: false })), createdAt: null, updatedAt: null });
    }
    toast(days.length === 1 ? 'Копия создана' : `Создано копий: ${days.length}`);
  }

  async newReminder() {
    let moment = at(today(), DEFAULT_START_MINUTES);
    if (toSeconds(moment) <= nowSeconds()) moment = at(addDays(today(), 1), DEFAULT_START_MINUTES);
    const draft = { title: '', at: moment, alarm: settings.get('defaultReminderType') === 'alarm', enabled: true, recurrence: normalizeRule(null) };
    const result = await editReminder(this, draft, { isNew: true });
    if (result && result !== 'delete') {
      this.store.saveReminder(result);
      toast('Напоминание сохранено');
    }
  }

  async editReminder(reminder) {
    const result = await editReminder(this, reminder);
    if (result === 'delete') this.store.removeReminder(reminder.id);
    else if (result) this.store.saveReminder(result);
  }

  // ---------------------------------------------------------------- sync

  onSync(event) {
    if (event.type === 'state') {
      if (event.state === 'idle') this.offline = false;
      this.renderChrome();
      if (event.state === 'auth') this.onAuthLost?.();
      return;
    }
    if (event.type === 'synced') {
      this.offline = false;
      this.renderChrome();
      for (const conflict of event.conflicts || []) this.onConflict(conflict);
    }
    if (event.type === 'republish-offer') this.offerRepublish(false);
  }

  /** What a shared calendar could not take, told rather than swallowed. */
  async onConflict(conflict) {
    const title = conflict.data?.title || 'Без названия';
    if (conflict.reason === 'read_only') {
      toast(`Правка «${title}» не сохранена: календарь открыт вам только для чтения`, { timeout: 6000 });
      return;
    }
    if (conflict.reason !== 'deleted') return;
    const answer = await ask({ title: 'Запись удалена владельцем', text: `Владелец общего календаря удалил «${title}», пока вы её правили. Вернуть запись с вашей правкой?`,
      options: [{ label: 'Отказаться', value: false }, { label: 'Вернуть', value: true, primary: true }] });
    if (!answer) return;
    const record = normalize(conflict.kind, { ...conflict.data, calendarId: conflict.calendarId || conflict.data.calendarId }, conflict.id);
    if (!record) return;
    this.engine.markRestored(conflict.kind, conflict.id);
    if (conflict.kind === Kind.event) this.store.saveEvent(record);
    else if (conflict.kind === Kind.task) this.store.saveTask(record);
    else this.store.importAll([{ kind: conflict.kind, record }]);
    this.sync.syncNow();
  }

  /** The server lost what it had confirmed: everything of this device goes again. */
  async offerRepublish(asked) {
    const key = `cosmos.republishAsked.${this.account?.login}`;
    if (!asked) {
      try {
        if (localStorage.getItem(key)) return;
        localStorage.setItem(key, '1');
      } catch { /* asked again next time, no harm */ }
    }
    const ok = await confirm({ title: 'Выгрузить всё заново?', text: 'Сервер не знает записей, которые есть здесь (аккаунт создан заново или базу сервера восстановили из копии). Отправить на сервер все записи аккаунта из этого браузера?', ok: 'Выгрузить' });
    if (!ok) return;
    const count = this.store.republishAll();
    this.engine.reset();
    toast(`Записей к отправке: ${count}`);
    this.sync.syncNow();
  }

  async signOut() {
    const pending = this.store.journal.size;
    const text = pending
      ? `${pending} ${pluralRu(pending, 'правка ещё не отправлена', 'правки ещё не отправлены', 'правок ещё не отправлено')} на сервер и пропадёт при выходе. Всё равно выйти?`
      : 'Копия аккаунта в этом браузере удалится; записи останутся на сервере и в планере.';
    if (!await confirm({ title: 'Выйти из аккаунта?', text, ok: 'Выйти', danger: !!pending })) return;
    this.onSignOut?.();
  }
}

