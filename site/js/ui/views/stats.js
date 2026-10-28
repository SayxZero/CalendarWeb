// «Статистика»: what was done, counted from the log of completions - not from
// the flag of a task, since a repeating task never closes.

import { h, calStyle } from '../dom.js';
import { today, addDays, dateOf, parts } from '../../model/dates.js';
import { MONTHS_GENITIVE, pluralRu } from '../../model/text.js';
import { isOverdue } from '../../model/records.js';

export class StatsView {
  constructor(app) {
    this.app = app;
    this.showFilterBar = false;
    this.hasDateNav = false;
  }

  title() {
    return 'Статистика';
  }

  render(root) {
    const store = this.app.store;
    const day = today();
    const perDay = new Map();
    for (const completion of store.completions()) {
      if (completion.failed) continue;
      const d = dateOf(completion.completedAt);
      perDay.set(d, (perDay.get(d) || 0) + 1);
    }
    let streak = 0;
    for (let d = perDay.get(day) ? day : addDays(day, -1); perDay.get(d); d = addDays(d, -1)) ++streak;
    const open = store.openTasks();
    const overdue = [...store.maps.task.values()].filter(isOverdue).length;
    const card = (value, label) => h('div', { class: 'card' }, h('div', { class: 'v' }, String(value)), h('div', { class: 'k' }, label));

    const list = h('div', { class: 'list' });
    list.append(h('div', { class: 'cards' },
      card(perDay.get(day) || 0, 'Выполнено сегодня'),
      card(store.completedInLastDays(7), 'За 7 дней'),
      card(store.completedInLastDays(30), 'За 30 дней'),
      card(streak, `${pluralRu(streak, 'День', 'Дня', 'Дней')} подряд`),
      card(open.length, 'Открытых задач'),
      card(overdue, 'Просрочено'),
      card(`${store.habitsDoneOn(day)}/${store.habits().length}`, 'Привычек сегодня')));

    const days = Array.from({ length: 30 }, (_, i) => addDays(day, i - 29));
    const max = Math.max(1, ...days.map((d) => perDay.get(d) || 0));
    list.append(h('div', { class: 'group-title' }, 'Выполнено задач за последние 30 дней',
      h('span', { class: 'count' }, `максимум за день: ${Math.max(0, ...days.map((d) => perDay.get(d) || 0))}`)));
    list.append(h('div', { class: 'bars' }, ...days.map((d) => {
      const n = perDay.get(d) || 0;
      return h('div', { class: n ? '' : 'zero', style: { height: `${(n / max) * 100}%` }, title: `${parts(d).d} ${MONTHS_GENITIVE[parts(d).m - 1]}: ${n}` });
    })));

    list.append(h('div', { class: 'group-title' }, 'Открытые задачи по календарям'));
    const byCalendar = store.calendars().map((c) => ({ c, n: open.filter((t) => t.calendarId === c.id).length })).filter((x) => x.n);
    if (!byCalendar.length) list.append(h('div', { class: 'empty' }, 'Открытых задач нет'));
    const top = Math.max(1, ...byCalendar.map((x) => x.n));
    list.append(h('div', { class: 'per-calendar' }, ...byCalendar.map(({ c, n }) => h('div', { style: calStyle(store.calendarColor(c.id)) },
      h('div', { class: 'row' }, h('span', { class: 'dot' }), h('span', { class: 'grow' }, c.name), h('span', { class: 'muted' }, String(n))),
      h('div', { class: 'meter' }, h('div', { style: { width: `${(n / top) * 100}%` } }))))));
    root.append(h('div', { class: 'scroll' }, list));
  }
}
