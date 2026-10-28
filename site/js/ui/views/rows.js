// Lines of the lists - a task, an event occurrence - shared by «Задачи»,
// «Повестка» and the menu of a day.

import { h, icon, calStyle, toast } from '../dom.js';
import { isClosed, isFailed, isOverdue, dueText, subtasksDone, timeRangeText } from '../../model/records.js';
import { isActive } from '../../model/recurrence.js';

/** The circle of a task: a tap closes or opens it. */
export function taskCheck(app, task) {
  const store = app.store;
  const locked = !store.canEdit(task);
  const closed = isClosed(task);
  return h('button', {
    class: ['check', task.done ? 'done' : '', isFailed(task) ? 'failed' : '', locked ? 'locked' : ''],
    style: calStyle(store.taskColor(task)),
    title: locked ? 'Календарь открыт только для чтения' : closed ? 'Вернуть в работу' : 'Выполнить',
    attrs: { 'aria-label': closed ? 'Вернуть в работу' : 'Выполнить' },
    on: { click: (e) => {
      e.stopPropagation();
      if (locked) {
        toast('Календарь открыт только для чтения');
        return;
      }
      app.setTaskDone(task, !closed);
    } },
  }, task.done ? icon('check') : isFailed(task) ? icon('close') : null);
}

export function taskLine(app, task, { actions = true, extra = null } = {}) {
  const store = app.store;
  const calendar = store.calendar(task.calendarId);
  const sub = [];
  if (task.dueAt || !isClosed(task)) sub.push(h('span', { class: isOverdue(task) ? 'overdue' : '' }, dueText(task)));
  if (isActive(task.recurrence)) sub.push(h('span', { title: 'Повторяется' }, icon('repeat')));
  if (task.subtasks.length) sub.push(h('span', { class: 'subtask-mini' }, `${subtasksDone(task)}/${task.subtasks.length}`));
  if (calendar && store.calendars().length > 1) sub.push(h('span', null, calendar.name));
  if (isFailed(task)) sub.push(h('span', null, 'не выполнена'));
  const buttons = [];
  if (actions && store.canEdit(task)) {
    buttons.push(h('button', {
      class: 'icon-btn', title: isFailed(task) ? 'В работу' : 'Не выполнена',
      on: { click: (e) => { e.stopPropagation(); app.setTaskFailed(task, !isFailed(task)); } },
    }, icon(isFailed(task) ? 'undo' : 'failed')));
    buttons.push(h('button', { class: 'icon-btn', title: 'Удалить', on: { click: (e) => { e.stopPropagation(); app.deleteTask(task); } } }, icon('trash')));
  }
  return h('div', { class: ['line', isClosed(task) ? 'closed' : ''], style: calStyle(store.taskColor(task)) },
    taskCheck(app, task),
    h('div', { class: 'body', on: { click: () => app.openTask(task) } },
      h('div', { class: 'title' }, task.title || 'Без названия'),
      h('div', { class: 'sub' }, ...sub)),
    extra,
    buttons.length ? h('div', { class: 'actions' }, ...buttons) : null);
}

export function eventLine(app, occurrence, { showDate = false, dateText = '' } = {}) {
  const event = occurrence.event;
  const store = app.store;
  return h('div', { class: ['line', event.cancelled ? 'closed' : ''], style: calStyle(store.eventColor(event)) },
    h('span', { class: 'bar' }),
    h('div', { class: 'body', on: { click: () => app.openOccurrence(occurrence) } },
      h('div', { class: 'title' }, event.title || 'Без названия'),
      h('div', { class: 'sub' },
        showDate ? h('span', null, dateText) : null,
        h('span', null, timeRangeText({ ...event, start: occurrence.start, end: occurrence.end })),
        isActive(event.recurrence) ? h('span', { title: 'Повторяется' }, icon('repeat')) : null,
        event.location ? h('span', null, event.location) : null,
        store.calendars().length > 1 ? h('span', null, store.calendarName(event.calendarId)) : null)));
}
