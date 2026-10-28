// «Повестка»: the days ahead as a list, events and (when wanted) tasks. It
// does not look back - the period starts today. A search looks three years
// both ways.

import { h, isMobile } from '../dom.js';
import { addDays, today, parts, dayOfWeek, dateOf, addYears } from '../../model/dates.js';
import { WEEKDAYS_SHORT, MONTHS_GENITIVE, friendlyDate, containsText } from '../../model/text.js';
import { coversDate, isClosed } from '../../model/records.js';
import { settings } from '../settings.js';
import { taskLine, eventLine } from './rows.js';

const PERIODS = [[7, 'Ближайшая неделя'], [30, 'Ближайший месяц'], [91, 'Ближайшие 3 месяца'], [365, 'Ближайший год']];

export class AgendaView {
  constructor(app) {
    this.app = app;
    this.showFilterBar = true;
    this.hasDateNav = false;
  }

  title() {
    return this.app.search ? 'Поиск' : 'Повестка';
  }

  period() {
    const period = h('select', { title: 'Период', style: { width: 'auto' }, on: { change: () => { settings.set('agendaDays', +period.value); this.app.render(); } } },
      ...PERIODS.map(([days, title]) => h('option', { value: days, selected: settings.get('agendaDays') === days }, title)));
    return period;
  }

  toolbar() {
    return this.app.search || isMobile() ? null : this.period();
  }

  render(root) {
    const app = this.app;
    const store = app.store;
    const hidden = store.hiddenCalendars();
    const query = (app.search || '').trim();
    const from = query ? addYears(today(), -3) : today();
    const to = query ? addYears(today(), 3) : addDays(today(), (settings.get('agendaDays') || 30) - 1);
    const withTasks = settings.get('agendaShowsTasks');
    const withDone = settings.get('agendaShowsDone');

    const byDay = new Map();
    const add = (date, entry) => {
      if (!byDay.has(date)) byDay.set(date, []);
      byDay.get(date).push(entry);
    };
    let events = 0, tasks = 0;
    for (const occurrence of store.occurrences(from, to)) {
      const event = occurrence.event;
      if (hidden.has(event.calendarId)) continue;
      if (query && !(containsText(event.title, query) || containsText(event.description, query) || containsText(event.location, query))) continue;
      // A multi-day event shows on its first day in the period.
      const first = dateOf(occurrence.start) < from ? from : dateOf(occurrence.start);
      if (!coversDate(occurrence, first)) continue;
      add(first, { occurrence, sort: occurrence.event.allDay ? '' : occurrence.start });
      ++events;
    }
    if (withTasks || query) {
      for (const task of store.maps.task.values()) {
        if (hidden.has(task.calendarId) || !task.dueAt) continue;
        if (isClosed(task) && !withDone && !query) continue;
        if (query && !(containsText(task.title, query) || containsText(task.notes, query) || task.subtasks.some((s) => containsText(s.title, query)))) continue;
        let date = dateOf(task.dueAt);
        if (date > to) continue;
        // Overdue open tasks stand at today, where they are to be done.
        if (date < from) {
          if (query || isClosed(task)) continue;
          date = from;
        }
        add(date, { task, sort: task.hasDueTime ? task.dueAt : 'zz' });
        ++tasks;
      }
    }

    const list = h('div', { class: 'list' });
    const days = [...byDay.keys()].sort();
    if (!days.length) {
      list.append(h('div', { class: 'empty' }, query ? 'Ничего не найдено' : 'В выбранном периоде записей нет'));
    }
    for (const date of days) {
      const entries = byDay.get(date).sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
      const p = parts(date);
      list.append(h('div', { class: ['agenda-day', date === today() ? 'today' : ''] },
        h('div', { class: 'date', title: friendlyDate(date), on: { click: () => app.go('day', date) } },
          h('div', { class: 'n' }, String(p.d)),
          h('div', { class: 'w' }, `${MONTHS_GENITIVE[p.m - 1].slice(0, 3)}, ${WEEKDAYS_SHORT[dayOfWeek(date) - 1]}`),
          query && p.y !== parts(today()).y ? h('div', { class: 'w' }, String(p.y)) : null),
        h('div', null, ...entries.map((entry) => (entry.task ? taskLine(app, entry.task, { actions: false }) : eventLine(app, entry.occurrence))))));
    }
    list.prepend(h('div', { class: 'muted small', style: { padding: '8px 6px 0' } }, `Событий: ${events} · Задач: ${tasks}`,
      !query ? h('label', { class: 'row', style: { display: 'inline-flex', marginLeft: '14px', gap: '4px' } },
        h('input', { type: 'checkbox', checked: withTasks, on: { change: (e) => { settings.set('agendaShowsTasks', e.target.checked); app.render(); } } }), 'Задачи') : null,
      !query && withTasks ? h('label', { class: 'row', style: { display: 'inline-flex', marginLeft: '10px', gap: '4px' } },
        h('input', { type: 'checkbox', checked: withDone, on: { change: (e) => { settings.set('agendaShowsDone', e.target.checked); app.render(); } } }), 'Выполненные') : null));
    if (isMobile() && !query) list.prepend(h('div', { class: 'toolbar' }, this.period()));
    root.append(h('div', { class: 'scroll' }, list));
  }
}

