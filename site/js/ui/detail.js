// The screen of one record (the planner's DetailDialog): what it is, and what
// can be done with it. A record of a calendar open only for reading can be
// looked at and copied, nothing else.

import { h, icon, calStyle, openMenu } from './dom.js';
import { Dialog } from './dialog.js';
import { dateOf } from '../model/dates.js';
import { longDate, friendlyDate } from '../model/text.js';
import { describe, isActive } from '../model/recurrence.js';
import { formatReminder, formatDayReminder, reminderRingsAlarm } from '../model/reminders.js';
import { timeRangeText, isClosed, isFailed, isOverdue, dueText } from '../model/records.js';
import { melodyTitle } from '../core/tones.js';

function line(iconName, ...content) {
  return h('div', { class: 'detail-line' }, icon(iconName), h('div', { class: 'grow' }, ...content));
}

function reminderLines(record, dayMode, store) {
  if (!record.reminders?.length) return null;
  return line('bell', ...record.reminders.map((r) => h('div', null,
    (dayMode ? formatDayReminder(r) : formatReminder(r)) + (reminderRingsAlarm(r) ? ' · будильник' : ''))),
  record.alarm && record.alarmMelody ? h('div', { class: 'muted small' }, melodyTitle(record.alarmMelody, store)) : null);
}

function readOnlyNote(app, record) {
  const calendar = app.store.calendar(record.calendarId);
  return app.store.canEdit(record) ? null
    : h('div', { class: 'readonly-note' }, icon('lock'), ` Календарь «${calendar?.name || ''}» пользователя ${calendar?.ownerLogin || ''} открыт вам только для чтения. Запись можно скопировать в свой календарь.`);
}

export function showEvent(app, occurrence) {
  const store = app.store;
  const event = store.event(occurrence.event.id) || occurrence.event;
  const editable = store.canEdit(event);
  const dialog = new Dialog({ title: event.title || 'Без названия', closeLabel: 'Закрыть' });
  dialog.titleEl.textContent = 'Событие';
  const color = store.eventColor(event);
  dialog.body.append(
    h('div', { class: 'row', style: calStyle(color) }, h('span', { class: 'dot', style: { width: '14px', height: '14px' } }),
      h('div', { class: 'detail-title', style: event.cancelled ? { textDecoration: 'line-through' } : null }, event.title || 'Без названия')),
    event.cancelled ? h('div', { class: 'badge' }, 'Отменено') : null,
    line('clock', h('div', null, longDate(dateOf(occurrence.start))),
      h('div', { class: 'muted' }, timeRangeText({ ...event, start: occurrence.start, end: occurrence.end }))),
    isActive(event.recurrence) ? line('repeat', describe(event.recurrence)) : null,
    line('calendars', store.calendarName(event.calendarId)),
    event.location ? line('place', event.location) : null,
    event.description ? line('note', event.description) : null,
    reminderLines(event, event.allDay, store),
    readOnlyNote(app, event));

  if (editable) {
    dialog.addButton('Изменить', () => { dialog.close(null); app.editOccurrence(occurrence); }, { iconName: 'edit' });
    dialog.addButton('Удалить', () => { dialog.close(null); app.deleteOccurrence(occurrence); }, { danger: true, iconName: 'trash' });
  }
  dialog.addButton('Копировать', (e) => openMenu(e.currentTarget, [
    { label: 'Дублировать', icon: 'copy', action: () => { dialog.close(null); app.copyOccurrence(occurrence, 'one'); } },
    { label: 'Размножить', icon: 'calendars', action: () => { dialog.close(null); app.copyOccurrence(occurrence, 'many'); } },
    editable ? { label: 'Перенести', icon: 'right', action: () => { dialog.close(null); app.copyOccurrence(occurrence, 'move'); } } : null,
    editable ? 'sep' : null,
    editable ? { label: event.cancelled ? 'Вернуть событие' : 'Отменить событие', icon: event.cancelled ? 'undo' : 'failed',
      action: () => { dialog.close(null); app.toggleCancelled(occurrence); } } : null,
  ]), { iconName: 'more' });
  return dialog.open();
}

export function showTask(app, task0) {
  const store = app.store;
  const dialog = new Dialog({ title: 'Задача', closeLabel: 'Закрыть' });
  const content = h('div', { class: 'col', style: { gap: '14px' } });
  dialog.body.append(content);

  const render = () => {
    const task = store.task(task0.id);
    if (!task) {
      dialog.close(null);
      return;
    }
    const editable = store.canEdit(task);
    const color = store.taskColor(task);
    content.replaceChildren(
      h('div', { class: 'row', style: calStyle(color) },
        h('button', {
          class: ['check', task.done ? 'done' : '', isFailed(task) ? 'failed' : '', editable ? '' : 'locked'], disabled: !editable,
          on: { click: () => app.setTaskDone(task, !isClosed(task)) },
        }, task.done ? icon('check') : isFailed(task) ? icon('close') : null),
        h('div', { class: 'detail-title', style: isClosed(task) ? { textDecoration: 'line-through', color: 'var(--muted)' } : null }, task.title || 'Без названия')),
      isFailed(task) ? h('div', { class: 'badge' }, 'Не выполнена') : task.done ? h('div', { class: 'badge' }, 'Выполнена') : null,
      line('clock', h('span', { class: isOverdue(task) ? 'danger-text' : '' }, dueText(task))),
      isActive(task.recurrence) ? line('repeat', describe(task.recurrence)) : null,
      line('calendars', store.calendarName(task.calendarId)),
      task.dueAt ? reminderLines(task, !task.hasDueTime, store) : null,
      task.notes ? line('note', task.notes) : null,
      task.subtasks.length ? h('div', { class: 'col', style: { gap: '6px' } },
        h('div', { class: 'label muted small' }, `ПОДЗАДАЧИ · ${task.subtasks.filter((s) => s.done).length} из ${task.subtasks.length}`),
        ...task.subtasks.map((sub) => h('div', { class: 'subtask-row' },
          h('button', { class: ['check', 'square', sub.done ? 'done' : ''], disabled: !editable, style: calStyle(color),
            on: { click: () => app.setSubtaskDone(task, sub.id, !sub.done) } }, sub.done ? icon('check') : null),
          h('span', { style: sub.done || isClosed(task) ? { textDecoration: 'line-through', color: 'var(--muted)' } : null }, sub.title)))) : null,
      task.completedAt && isClosed(task) ? h('div', { class: 'muted small' }, `Закрыта ${friendlyDate(dateOf(task.completedAt)).toLowerCase()}`) : null,
      readOnlyNote(app, task));
    dialog.extras.replaceChildren();
    if (editable) {
      dialog.addButton('Изменить', () => { dialog.close(null); app.editTask(task); }, { iconName: 'edit' });
      dialog.addButton(isFailed(task) ? 'В работу' : 'Не выполнена', () => app.setTaskFailed(task, !isFailed(task)), { iconName: isFailed(task) ? 'undo' : 'failed' });
      dialog.addButton('Удалить', () => { dialog.close(null); app.deleteTask(task); }, { danger: true, iconName: 'trash' });
    }
    dialog.addButton('Копировать', (e) => openMenu(e.currentTarget, [
      { label: 'Дублировать', icon: 'copy', action: () => { dialog.close(null); app.copyTask(task, 'one'); } },
      { label: 'Размножить', icon: 'calendars', action: () => { dialog.close(null); app.copyTask(task, 'many'); } },
      editable ? { label: 'Перенести', icon: 'right', action: () => { dialog.close(null); app.copyTask(task, 'move'); } } : null,
    ]), { iconName: 'more' });
  };
  render();
  const unsubscribe = store.subscribe(render);
  return dialog.open().finally(unsubscribe);
}
