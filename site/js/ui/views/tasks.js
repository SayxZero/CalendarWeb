// «Задачи»: the list, grouped by due date or by state. Inside a group the
// nearest due date comes first and tasks without one last; the order the user
// gave (sortOrder) only settles two tasks due at the same moment - and that is
// the only place "выше/ниже" is offered.

import { h, icon, isMobile, openMenu } from '../dom.js';
import { today, dateOf, addDays, startOfWeek } from '../../model/dates.js';
import { isClosed, isFailed, isOverdue } from '../../model/records.js';
import { settings } from '../settings.js';
import { taskLine } from './rows.js';

const DONE_FILTERS = [['none', 'Выполненные задачи скрыты'], ['today', 'Видны задачи, выполненные сегодня'], ['all', 'Видны все выполненные задачи']];

function byDue(a, b) {
  if (!!a.dueAt !== !!b.dueAt) return a.dueAt ? -1 : 1;
  if (a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
  return a.sortOrder - b.sortOrder;
}

export class TasksView {
  constructor(app) {
    this.app = app;
    this.showFilterBar = true;
    this.hasDateNav = false;
  }

  title() {
    return 'Задачи';
  }

  toolbar() {
    const grouping = settings.get('taskGrouping');
    const done = settings.get('doneFilter');
    return h('div', { class: 'row' },
      h('button', { class: 'btn flat', title: 'Группировка', on: { click: () => { settings.set('taskGrouping', grouping === 'due' ? 'status' : 'due'); this.app.render(); } } },
        icon('agenda'), isMobile() ? null : grouping === 'due' ? 'Группы: по сроку' : 'Группы: по статусу'),
      h('button', { class: 'icon-btn', title: DONE_FILTERS.find(([k]) => k === done)?.[1], on: { click: (e) => openMenu(e.currentTarget, DONE_FILTERS.map(([key, label]) => ({
        label, icon: key === done ? 'check' : null, action: () => { settings.set('doneFilter', key); this.app.render(); },
      }))) } }, icon(done === 'none' ? 'eyeOff' : 'eye')));
  }

  visibleTasks() {
    const store = this.app.store;
    const hidden = store.hiddenCalendars();
    const query = (this.app.search || '').trim();
    const done = settings.get('doneFilter');
    const list = query ? store.searchTasks(query) : store.tasks();
    return list.filter((task) => {
      if (hidden.has(task.calendarId)) return false;
      if (!isClosed(task) || query) return true;
      if (done === 'all') return true;
      if (done === 'today') return task.completedAt && dateOf(task.completedAt) === today();
      return false;
    });
  }

  groups(tasks) {
    const todayDate = today();
    if (settings.get('taskGrouping') === 'status') {
      return [
        ['Открытые', tasks.filter((t) => !isClosed(t))],
        ['Выполнено', tasks.filter((t) => t.done)],
        ['Не выполнено', tasks.filter((t) => isFailed(t))],
      ];
    }
    const weekEnd = addDays(startOfWeek(todayDate, settings.get('firstDayOfWeek')), 6);
    const open = tasks.filter((t) => !isClosed(t));
    const due = (t) => (t.dueAt ? dateOf(t.dueAt) : null);
    return [
      ['Просрочено', open.filter(isOverdue), 'overdue'],
      ['Сегодня', open.filter((t) => due(t) === todayDate && !isOverdue(t))],
      ['Завтра', open.filter((t) => due(t) === addDays(todayDate, 1))],
      ['На этой неделе', open.filter((t) => due(t) > addDays(todayDate, 1) && due(t) <= weekEnd)],
      ['Позже', open.filter((t) => due(t) > weekEnd && due(t) > addDays(todayDate, 1))],
      ['Без срока', open.filter((t) => !t.dueAt)],
      ['Выполненные', tasks.filter(isClosed)],
    ];
  }

  render(root) {
    const app = this.app;
    const store = app.store;
    const tasks = this.visibleTasks();
    const list = h('div', { class: 'list' });

    if (!isMobile() && !app.search) {
      const input = h('input', { type: 'text', placeholder: 'Новая задача — Enter, чтобы добавить', on: { keydown: (e) => {
        if (e.key !== 'Enter' || !input.value.trim()) return;
        const calendarId = store.isCalendarWritable(settings.get('lastCalendarId')) && store.calendar(settings.get('lastCalendarId'))
          ? settings.get('lastCalendarId') : store.defaultWritableCalendarId();
        store.saveTask({ title: input.value.trim(), calendarId, reminders: [] });
        input.value = '';
        this.keepFocus = true;
      } } });
      list.append(h('div', { class: 'quick-add' }, input));
      if (this.keepFocus) {
        this.keepFocus = false;
        setTimeout(() => input.focus(), 0);
      }
    }

    const openCount = store.openTasks().length;
    list.append(h('div', { class: 'muted small', style: { padding: '6px 6px 0' } },
      `Открыто: ${openCount} · просрочено: ${store.overdueCount()}`));

    let any = false;
    for (const [title, items, tone] of this.groups(tasks)) {
      if (!items.length) continue;
      any = true;
      const sorted = [...items].sort(byDue);
      list.append(h('div', { class: ['group-title', tone || ''] }, title, h('span', { class: 'count' }, String(sorted.length))));
      sorted.forEach((task, index) => {
        const prev = sorted[index - 1], next = sorted[index + 1];
        const sameDue = (other) => other && other.dueAt === task.dueAt && !isClosed(other) && !isClosed(task);
        const more = store.canEdit(task) && (sameDue(prev) || sameDue(next))
          ? h('button', { class: 'icon-btn', title: 'Переместить', on: { click: (e) => {
            e.stopPropagation();
            openMenu(e.currentTarget, [
              sameDue(prev) ? { label: 'Переместить выше', icon: 'up', action: () => this.swap(task, prev) } : null,
              sameDue(next) ? { label: 'Переместить ниже', icon: 'down', action: () => this.swap(task, next) } : null,
            ]);
          } } }, icon('more')) : null;
        list.append(taskLine(app, task, { extra: more }));
      });
    }
    if (!any) {
      list.append(h('div', { class: 'empty' }, app.search ? 'Ничего не найдено'
        : isMobile() ? 'Задач нет — нажмите «+», чтобы добавить' : 'Задач нет — добавьте первую в поле сверху'));
    }
    root.append(h('div', { class: 'scroll' }, list));
  }

  /** Swaps two neighbours of one due date in the user's order. */
  swap(a, b) {
    const ids = this.app.store.tasks().map((t) => t.id);
    const i = ids.indexOf(a.id), j = ids.indexOf(b.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    this.app.store.reorderTasks(ids);
  }
}

