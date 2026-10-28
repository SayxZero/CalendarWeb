// «Привычки»: big buttons for today and the report of the last 30 days. To
// tick is one press; to take a tick back asks first; the cross of the edit
// mode removes a habit without losing its days, and brings it back.

import { h, icon, calStyle, toast, isMobile } from '../dom.js';
import { today, addDays, parts } from '../../model/dates.js';
import { HabitDay, HABIT_CHART_DAYS } from '../../model/records.js';
import { MONTHS_GENITIVE, pluralRu } from '../../model/text.js';
import { confirm, Dialog, field } from '../dialog.js';
import { colorPicker } from '../fields.js';

export class HabitsView {
  constructor(app) {
    this.app = app;
    this.showFilterBar = false;
    this.hasDateNav = false;
    this.page = 'list';
    this.editing = false;
  }

  title() {
    return 'Привычки';
  }

  pages() {
    return h('div', { class: 'seg' },
      h('button', { class: this.page === 'list' ? 'on' : '', on: { click: () => { this.page = 'list'; this.app.render(); } } }, 'Сегодня'),
      h('button', { class: this.page === 'chart' ? 'on' : '', on: { click: () => { this.page = 'chart'; this.app.render(); } } }, 'Отчёт'));
  }

  /** The pencil belongs to the screen, as in the planner; on a phone the pages go under the bar. */
  toolbar() {
    return h('div', { class: 'row' }, isMobile() ? null : this.pages(),
      h('button', { class: ['icon-btn', this.editing ? 'on' : ''], title: this.editing ? 'Готово' : 'Править', on: { click: () => { this.editing = !this.editing; this.app.render(); } } }, icon(this.editing ? 'check' : 'edit')));
  }

  render(root) {
    const list = h('div', { class: ['list', this.editing ? 'habits-edit' : ''] });
    if (isMobile()) list.append(h('div', { class: 'toolbar' }, this.pages()));
    if (this.page === 'list') this.renderList(list);
    else this.renderChart(list);
    root.append(h('div', { class: 'scroll' }, list));
  }

  renderList(list) {
    const store = this.app.store;
    const day = today();
    const habits = store.habits();
    const done = habits.filter((habit) => store.isHabitDone(habit.id, day)).length;
    list.append(h('div', { class: 'muted small', style: { padding: '8px 6px 0' } },
      habits.length ? `Сегодня: ${done} из ${habits.length}` : ''));
    const grid = h('div', { class: 'habit-list' });
    for (const habit of habits) {
      const isDone = store.isHabitDone(habit.id, day);
      const streak = this.streak(habit);
      grid.append(h('button', {
        class: ['habit-btn', isDone ? 'done' : ''], style: calStyle(habit.color || '#4f6bed'),
        on: { click: () => (this.editing ? this.edit(habit) : this.toggle(habit, isDone)) },
      },
      h('span', { class: 'h-title' }, habit.title || 'Без названия'),
      h('span', { class: 'h-sub' }, this.editing ? 'Нажмите, чтобы изменить' : isDone ? 'Сделано сегодня' : streak ? `Подряд: ${streak} ${pluralRu(streak, 'день', 'дня', 'дней')}` : 'Нажмите, когда сделаете'),
      this.editing ? h('span', { class: 'remove icon-btn', title: 'Удалить привычку', on: { click: (e) => {
        e.stopPropagation();
        store.archiveHabit(habit.id);
        toast(`Привычка «${habit.title}» удалена`, { action: 'Вернуть', onAction: () => store.restoreHabit(habit.id) });
      } } }, icon('close')) : null));
    }
    if (this.editing || !habits.length) {
      grid.append(h('button', { class: 'habit-btn', style: { borderStyle: 'dashed', ...calStyle('#9aa0aa') }, on: { click: () => this.edit(null) } },
        h('span', { class: 'h-title' }, icon('plus'), ' Новая привычка'), h('span', { class: 'h-sub' }, 'Например, «Зарядка»')));
    }
    list.append(grid);
    const removed = store.habits(true).filter((x) => x.archivedAt);
    if (this.editing && removed.length) {
      list.append(h('div', { class: 'group-title' }, 'Удалённые'));
      for (const habit of removed) {
        list.append(h('div', { class: 'line', style: calStyle(habit.color || '#4f6bed') }, h('span', { class: 'dot' }),
          h('div', { class: 'body' }, h('div', { class: 'title' }, habit.title)),
          h('button', { class: 'btn', on: { click: () => store.restoreHabit(habit.id) } }, icon('undo'), 'Вернуть привычку')));
      }
    }
  }

  /** Days in a row up to yesterday (today still pending), plus today when done. */
  streak(habit) {
    const store = this.app.store;
    let day = today();
    if (!store.isHabitDone(habit.id, day)) day = addDays(day, -1);
    let n = 0;
    while (store.isHabitDone(habit.id, day) && n < 3660) {
      ++n;
      day = addDays(day, -1);
    }
    return n;
  }

  async toggle(habit, isDone) {
    const store = this.app.store;
    if (isDone) {
      const ok = await confirm({ title: 'Снять отметку?', text: `«${habit.title}» будет считаться не сделанной сегодня`, ok: 'Снять отметку' });
      if (!ok) return;
    }
    store.setHabitDone(habit.id, today(), !isDone);
  }

  async edit(habit) {
    const store = this.app.store;
    const title = h('input', { type: 'text', value: habit?.title || '', placeholder: 'Например, «Зарядка»', maxLength: 200 });
    let color = habit?.color || '';
    const palette = colorPicker(color || '#4f6bed', (c) => { color = c; });
    const dialog = new Dialog({ title: habit ? 'Привычка' : 'Новая привычка', size: 'narrow', onSave: () => {
      if (!title.value.trim()) {
        title.focus();
        return false;
      }
      store.saveHabit({ ...(habit || {}), title: title.value, color: color || '' });
      return true;
    } });
    dialog.body.append(field('Название', title), field('Цвет', palette));
    if (habit) dialog.addButton('Удалить привычку', () => { store.archiveHabit(habit.id); dialog.close(null); }, { danger: true, iconName: 'trash' });
    await dialog.open();
  }

  renderChart(list) {
    const store = this.app.store;
    const day = today();
    const habits = store.habits(this.editing);
    const first = addDays(day, -(HABIT_CHART_DAYS - 1));
    const a = parts(first), b = parts(day);
    list.append(h('div', { class: 'muted small', style: { padding: '8px 6px 0' } },
      `${a.d} ${MONTHS_GENITIVE[a.m - 1]} – ${b.d} ${MONTHS_GENITIVE[b.m - 1]}`,
      this.editing ? ' · Нажмите на кружок, чтобы изменить день' : ''));
    if (!habits.length) list.append(h('div', { class: 'empty' }, 'Привычек нет — добавьте первую на странице «Сегодня»'));
    const chart = h('div', { class: 'habit-chart' });
    for (const habit of habits) {
      const days = store.habitChart(habit, day, HABIT_CHART_DAYS);
      const done = days.filter((d) => d === HabitDay.Done).length;
      // Days it existed and that are over, and today once it is done.
      const counted = days.filter((d) => d === HabitDay.Done || d === HabitDay.Missed).length;
      chart.append(h('div', { class: 'habit-block', style: calStyle(habit.color || '#4f6bed') },
        h('div', { class: 'h-head' }, h('span', { class: 'dot' }), h('span', { class: 'grow' }, habit.title),
          h('span', { class: 'muted small' }, counted ? `${done} из ${counted}` : '')),
        h('div', { class: 'circles' }, ...days.map((state, i) => {
          const date = addDays(first, i);
          return h('button', {
            class: ['circle', state], disabled: !this.editing || state === HabitDay.Absent,
            title: `${parts(date).d} ${MONTHS_GENITIVE[parts(date).m - 1]}: ${{ done: 'сделано', missed: 'пропущено', absent: 'привычки не было', pending: 'сегодня' }[state]}`,
            on: { click: () => store.setHabitDone(habit.id, date, state !== HabitDay.Done) },
          });
        }))));
    }
    list.append(chart);
  }
}
