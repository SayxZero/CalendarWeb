// The year: twelve small months, each day tinted by how much it holds. A day
// opens itself, a month's name opens the month.

import { h, isMobile, onSwipe } from '../dom.js';
import { addDays, makeDate, startOfWeek, parts, today, dayOfWeek, addYears, dateOf } from '../../model/dates.js';
import { MONTHS, WEEKDAYS_SHORT, capitalize, pluralRu } from '../../model/text.js';
import { coversDate } from '../../model/records.js';
import { settings } from '../settings.js';

export class YearView {
  constructor(app) {
    this.app = app;
    this.showFilterBar = false;
    this.hasDateNav = true;
  }

  title() {
    return String(parts(this.app.anchor).y);
  }

  step(n) {
    this.app.setAnchor(addYears(this.app.anchor, n));
  }

  render(root) {
    const app = this.app;
    const store = app.store;
    const year = parts(app.anchor).y;
    const first = makeDate(year, 1, 1);
    const last = makeDate(year, 12, 31);
    const hidden = store.hiddenCalendars();
    const counts = new Map();
    const bump = (date) => counts.set(date, (counts.get(date) || 0) + 1);
    for (const occurrence of store.occurrences(first, last)) {
      if (hidden.has(occurrence.event.calendarId)) continue;
      for (let d = dateOf(occurrence.start) < first ? first : dateOf(occurrence.start); d <= last && coversDate(occurrence, d); d = addDays(d, 1)) bump(d);
    }
    for (const task of store.maps.task.values()) {
      if (task.dueAt && !hidden.has(task.calendarId)) {
        const d = dateOf(task.dueAt);
        if (d >= first && d <= last) bump(d);
      }
    }
    const firstDay = settings.get('firstDayOfWeek');
    const todayDate = today();
    const grid = h('div', { class: 'year' });
    for (let m = 1; m <= 12; ++m) {
      const monthStart = makeDate(year, m, 1);
      const days = h('div', { class: 'm-grid' }, ...Array.from({ length: 7 }, (_, i) => h('div', { class: 'wd' }, WEEKDAYS_SHORT[(firstDay - 1 + i) % 7])));
      const start = startOfWeek(monthStart, firstDay);
      for (let i = 0; i < 42; ++i) {
        const date = addDays(start, i);
        if (parts(date).m !== m) {
          days.append(h('span'));
          continue;
        }
        const count = counts.get(date) || 0;
        const level = count === 0 ? '' : count === 1 ? 'l1' : count <= 3 ? 'l2' : 'l3';
        days.append(h('button', {
          class: [level, date === todayDate ? 'today' : '', settings.get('highlightWeekends') && dayOfWeek(date) >= 6 && !level ? 'weekend' : ''],
          title: count ? `${count} ${pluralRu(count, 'запись', 'записи', 'записей')}` : '',
          on: { click: () => app.go('day', date) },
        }, String(parts(date).d)));
      }
      grid.append(h('div', null, h('div', { class: 'm-title', on: { click: () => app.go('month', monthStart) } }, capitalize(MONTHS[m - 1])), days));
    }
    const scroll = h('div', { class: 'scroll' }, grid);
    root.append(scroll);
    if (isMobile()) onSwipe(scroll, (dir) => this.step(dir));
  }
}
