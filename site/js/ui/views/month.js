// The month: weeks of seven days, each day with its events and (when the
// setting says so) its tasks. A multi-day event runs through its days as one
// bar. On a computer a record can be dragged to another day; a click on a day
// opens its menu, a double click starts an event there.

import { h, calStyle, isMobile, onSwipe } from '../dom.js';
import {
  addDays, addMonths, startOfMonth, startOfWeek, parts, today, dayOfWeek, isoWeek, dateOf, hhmm,
} from '../../model/dates.js';
import { WEEKDAYS_SHORT, monthTitle } from '../../model/text.js';
import { coversDate, isClosed } from '../../model/records.js';
import { settings } from '../settings.js';

const LINE = 20;

export class MonthView {
  constructor(app) {
    this.app = app;
    this.showFilterBar = true;
    this.hasDateNav = true;
  }

  title() {
    return monthTitle(this.app.anchor);
  }

  step(n) {
    this.app.setAnchor(addMonths(startOfMonth(this.app.anchor), n));
  }

  render(root) {
    const app = this.app;
    const store = app.store;
    const firstDay = settings.get('firstDayOfWeek');
    const weeks = settings.get('monthWeeks') || 6;
    const month = parts(app.anchor).m;
    const first = startOfWeek(startOfMonth(app.anchor), firstDay);
    const last = addDays(first, weeks * 7 - 1);
    const hidden = store.hiddenCalendars();
    const todayDate = today();
    const weekNumbers = settings.get('showWeekNumbers');
    const columns = `${weekNumbers ? '28px ' : ''}repeat(7, minmax(0, 1fr))`;

    const occurrences = store.occurrences(first, last).filter((o) => !hidden.has(o.event.calendarId));
    const tasksByDay = new Map();
    if (settings.get('tasksInCalendar')) {
      for (const task of store.maps.task.values()) {
        if (!task.dueAt || hidden.has(task.calendarId)) continue;
        const day = dateOf(task.dueAt);
        if (day < first || day > last) continue;
        if (!tasksByDay.has(day)) tasksByDay.set(day, []);
        tasksByDay.get(day).push(task);
      }
    }

    const head = h('div', { class: 'month-head', style: { gridTemplateColumns: columns } },
      weekNumbers ? h('div') : null,
      ...Array.from({ length: 7 }, (_, i) => h('div', null, WEEKDAYS_SHORT[(firstDay - 1 + i) % 7])));
    const grid = h('div', { class: 'month-grid', style: { gridTemplateColumns: columns, gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` } });
    const cells = [];

    for (let w = 0; w < weeks; ++w) {
      const weekStart = addDays(first, w * 7);
      if (weekNumbers) grid.append(h('div', { class: 'weeknum' }, String(isoWeek(addDays(weekStart, (8 - firstDay) % 7)))));
      for (let d = 0; d < 7; ++d) {
        const date = addDays(weekStart, d);
        const dow = dayOfWeek(date);
        const cell = h('div', {
          class: ['month-cell', parts(date).m !== month ? 'out' : '', date === todayDate ? 'today' : '',
            settings.get('highlightWeekends') && dow >= 6 ? 'weekend' : ''],
          dataset: { date },
        }, h('span', { class: 'num', title: 'Открыть день', on: { click: (e) => { e.stopPropagation(); app.go('day', date); } } }, String(parts(date).d)));
        const items = [];
        for (const occurrence of occurrences) {
          if (!coversDate(occurrence, date)) continue;
          items.push(this.eventItem(occurrence, date, d));
        }
        for (const task of (tasksByDay.get(date) || []).sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1))) items.push(this.taskItem(task));
        cell.items = items;
        cell.append(...items);
        cell.addEventListener('click', (e) => {
          if (e.target.closest('.item, .more')) return;
          app.dayMenu(date, isMobile() ? null : { x: e.clientX, y: e.clientY });
        });
        cell.addEventListener('dblclick', (e) => {
          if (e.target.closest('.item, .more, .num') || isMobile()) return;
          app.newEvent({ date });
        });
        this.dropTarget(cell, date);
        cells.push(cell);
        grid.append(cell);
      }
    }

    const view = h('div', { class: 'month' }, head, grid);
    root.append(view);
    onSwipe(view, (dir) => this.step(dir));
    view.addEventListener('wheel', (e) => {
      if (isMobile() || Math.abs(e.deltaY) < 30 || this.wheelLock) return;
      this.wheelLock = true;
      setTimeout(() => { this.wheelLock = false; }, 350);
      this.step(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
    requestAnimationFrame(() => this.fit(cells));
  }

  /** Leaves as many lines as fit in a cell and says how many more there are. */
  fit(cells) {
    if (!cells.length || !cells[0].isConnected) return;
    const height = cells[0].clientHeight;
    const lines = Math.max(1, Math.floor((height - 24) / LINE));
    for (const cell of cells) {
      const items = cell.items;
      if (items.length <= lines) continue;
      const keep = Math.max(0, lines - 1);
      items.slice(keep).forEach((item) => item.remove());
      cell.append(h('div', { class: 'more', on: { click: (e) => { e.stopPropagation(); this.app.dayMenu(cell.dataset.date, isMobile() ? null : { x: e.clientX, y: e.clientY }); } } },
        `ещё ${items.length - keep}`));
    }
  }

  eventItem(occurrence, date, column) {
    const event = occurrence.event;
    const color = this.app.store.eventColor(event);
    const startDay = dateOf(occurrence.start);
    // All-day and longer than a day: a bar through its days.
    const asBar = event.allDay || coversDate(occurrence, addDays(startDay, 1));
    const item = h('div', {
      class: ['item', asBar ? 'bar' : '', event.cancelled ? 'cancelled' : '',
        asBar && startDay < date && column > 0 ? 'cont-left' : '',
        asBar && coversDate(occurrence, addDays(date, 1)) && column < 6 ? 'cont-right' : ''],
      style: calStyle(color),
      title: `${event.title || 'Без названия'}${event.location ? ' · ' + event.location : ''}`,
      draggable: !isMobile() && this.app.store.canEdit(event),
      on: {
        click: (e) => { e.stopPropagation(); this.app.openOccurrence(occurrence); },
        dragstart: (e) => {
          this.dragged = occurrence;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', event.id);
        },
      },
    },
    asBar ? null : h('span', { class: 'dot' }),
    !asBar && !event.allDay && startDay === date ? h('span', { class: 'time' }, hhmm(occurrence.start)) : null,
    h('span', { class: 'ellipsis' }, asBar && startDay < date && column > 0 ? '' : event.title || 'Без названия'));
    return item;
  }

  taskItem(task) {
    const color = this.app.store.taskColor(task);
    return h('div', {
      class: ['item', 'task', isClosed(task) ? 'closed' : ''], style: calStyle(color), title: task.title,
      on: { click: (e) => { e.stopPropagation(); this.app.openTask(task); } },
    }, h('span', { class: ['check', isClosed(task) ? 'done' : ''] }),
    task.hasDueTime ? h('span', { class: 'time' }, hhmm(task.dueAt)) : null,
    h('span', { class: 'ellipsis' }, task.title || 'Без названия'));
  }

  dropTarget(cell, date) {
    if (isMobile()) return;
    cell.addEventListener('dragover', (e) => {
      if (!this.dragged) return;
      e.preventDefault();
      cell.classList.add('drop');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop'));
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.classList.remove('drop');
      const occurrence = this.dragged;
      this.dragged = null;
      if (occurrence) this.app.moveOccurrence(occurrence, date, null);
    });
  }
}

