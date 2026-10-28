// «Напоминания»: notifications and alarm clocks with nothing behind them.
// Grouped into «Сегодня», «Завтра», «Позже», «Выключены» and «Прошли»; the
// screen rebuilds itself every minute, since time moves reminders between
// the groups without any edit.

import { h, icon, toast } from '../dom.js';
import { today, addDays, dateOf, hhmm, now } from '../../model/dates.js';
import { reminderNextFiring } from '../../model/records.js';
import { describe, isActive } from '../../model/recurrence.js';
import { friendlyDate } from '../../model/text.js';
import { confirm } from '../dialog.js';

export class RemindersView {
  constructor(app) {
    this.app = app;
    this.showFilterBar = false;
    this.hasDateNav = false;
  }

  title() {
    return 'Напоминания';
  }

  render(root) {
    const app = this.app;
    const store = app.store;
    const moment = now();
    const groups = { today: [], tomorrow: [], later: [], off: [], past: [] };
    for (const reminder of store.reminders()) {
      const next = reminderNextFiring(reminder, moment);
      const entry = { reminder, next };
      if (!reminder.enabled) groups.off.push(entry);
      else if (!next) groups.past.push(entry);
      else if (dateOf(next) === today()) groups.today.push(entry);
      else if (dateOf(next) === addDays(today(), 1)) groups.tomorrow.push(entry);
      else groups.later.push(entry);
    }
    const list = h('div', { class: 'list' });
    const titles = { today: 'Сегодня', tomorrow: 'Завтра', later: 'Позже', off: 'Выключены', past: 'Прошли' };
    let any = false;
    for (const key of Object.keys(titles)) {
      const items = groups[key].sort((a, b) => ((a.next || a.reminder.at) < (b.next || b.reminder.at) ? -1 : 1));
      if (!items.length) continue;
      any = true;
      list.append(h('div', { class: 'group-title' }, titles[key], h('span', { class: 'count' }, String(items.length))));
      for (const { reminder, next } of items) {
        const when = next || reminder.at;
        list.append(h('div', { class: ['line', !reminder.enabled || !next ? 'closed' : ''] },
          h('span', { class: 'muted' }, icon(reminder.alarm ? 'alarm' : 'bell')),
          h('div', { class: 'body', on: { click: () => app.editReminder(reminder) } },
            h('div', { class: 'title' }, reminder.title || 'Напоминание'),
            h('div', { class: 'sub' },
              h('span', null, `${friendlyDate(dateOf(when))}, ${hhmm(when)}`),
              isActive(reminder.recurrence) ? h('span', null, describe(reminder.recurrence)) : null,
              reminder.notes ? h('span', { class: 'ellipsis' }, reminder.notes) : null)),
          h('div', { class: 'actions', style: { display: 'flex' } },
            h('button', { class: 'icon-btn', title: reminder.enabled ? 'Выключить' : 'Включить',
              on: { click: () => {
                store.setReminderEnabled(reminder.id, !reminder.enabled);
                toast(reminder.enabled ? 'Напоминание выключено' : 'Напоминание включено');
              } } }, icon(reminder.enabled ? 'eye' : 'eyeOff')),
            h('button', { class: 'icon-btn', title: 'Удалить', on: { click: async () => {
              if (await confirm({ title: 'Удаление', text: `Удалить напоминание «${reminder.title || 'Напоминание'}»?`, ok: 'Удалить', danger: true })) {
                store.removeReminder(reminder.id);
              }
            } } }, icon('trash')))));
      }
    }
    if (!any) list.append(h('div', { class: 'empty' }, 'Напоминаний нет — нажмите «+», чтобы добавить'));
    root.append(h('div', { class: 'scroll' }, list));
    clearInterval(this.timer);
    this.timer = setInterval(() => { if (root.isConnected) app.render(); else clearInterval(this.timer); }, 60000);
  }

  destroy() {
    clearInterval(this.timer);
  }
}
