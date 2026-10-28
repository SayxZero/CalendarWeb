// Editors of an event, a task and a reminder of its own: the planner's
// EventDialog, TaskDialog and ReminderDialog. They build the record and hand
// it back; what is saved and how (one repetition or the series) is decided by
// the caller (app.js), as MainWindow does.

import { h, icon, isMobile } from './dom.js';
import { Dialog, field, toggle } from './dialog.js';
import { ReminderList, RecurrenceEditor, colorPicker, calendarSelect, alarmOptions, dateTimeInputs } from './fields.js';
import {
  dateOf, minuteOfDay, at, toSeconds, fromSeconds, today, parseTime, nowSeconds, minutesText,
} from '../model/dates.js';
import { formatDuration, pluralRu } from '../model/text.js';
import { normalizeRule, isActive } from '../model/recurrence.js';
import { toDayReminders, reminderWithKind, DEFAULT_START_MINUTES } from '../model/reminders.js';
import { settings } from './settings.js';

/**
 * The event editor. @p event: an existing one (or the copy to edit), or for a
 * new one {start, end, allDay} only. Resolves to the event to save, or null.
 */
export function editEvent(app, event, { isNew = false } = {}) {
  const store = app.store;
  const allDay0 = !!event.allDay;
  let startDate = dateOf(event.start), startMinute = allDay0 ? 0 : minuteOfDay(event.start);
  let endDate = dateOf(event.end || event.start), endMinute = allDay0 ? 0 : minuteOfDay(event.end || event.start);
  let duration = Math.max(0, (toSeconds(event.end || event.start) - toSeconds(event.start)) / 60);

  const title = h('input', { type: 'text', class: 'title-input', value: event.title || '', placeholder: 'Название', maxLength: 500 });
  const allDay = toggle('Весь день', allDay0, () => onAllDay());
  const start = dateTimeInputs(startDate, startMinute, () => onStart());
  const end = dateTimeInputs(endDate, endMinute, () => onEnd());
  const hint = h('div', { class: 'hint muted small' });
  const calendarId0 = isNew
    ? (store.isCalendarWritable(settings.get('lastCalendarId')) && store.calendar(settings.get('lastCalendarId')) ? settings.get('lastCalendarId') : store.defaultWritableCalendarId())
    : event.calendarId;
  const calendar = calendarSelect(store, calendarId0, null, { includeId: event.calendarId });
  let color = event.color || '';
  const colors = colorPicker(color, (c) => { color = c; }, { allowNone: true });
  const reminders = new ReminderList({
    reminders: event.reminders || [], dayMode: allDay0, recordMinute: allDay0 ? DEFAULT_START_MINUTES : startMinute,
    defaultAlarm: settings.get('defaultReminderType') === 'alarm', onChange: () => { alarmBox.hidden = !reminders.hasAlarm(); },
  });
  const recurrence = new RecurrenceEditor(event.recurrence || normalizeRule(null), startDate);
  const alarmBox = alarmOptions(event, store);
  alarmBox.hidden = !reminders.hasAlarm();
  const location = h('input', { type: 'text', value: event.location || '', placeholder: 'Место' });
  const description = h('textarea', { value: event.description || '', placeholder: 'Описание' });
  const cancelled = toggle('Отменено — остаётся в календаре зачёркнутым, без напоминаний', event.cancelled);
  const error = h('div', { class: 'error' });

  function readStart() {
    const s = start.read();
    return { date: s.date, minutes: allDay.input.checked ? 0 : s.minutes };
  }

  function refreshHint() {
    const s = start.read(), e = end.read();
    if (!s.date || !e.date) return;
    const a = toSeconds(at(s.date, allDay.input.checked ? 0 : s.minutes));
    const b = toSeconds(at(e.date, allDay.input.checked ? 1439 : e.minutes));
    if (b < a) {
      hint.textContent = 'Окончание раньше начала';
      hint.className = 'error';
      return;
    }
    hint.className = 'hint muted small';
    if (allDay.input.checked) {
      const days = Math.round((b - a) / 86400) + 1;
      hint.textContent = `Длительность: ${days} ${pluralRu(days, 'день', 'дня', 'дней')}`;
    } else {
      hint.textContent = `Длительность: ${formatDuration(Math.round((b - a) / 60))}`;
    }
  }

  function onStart() {
    const s = readStart();
    if (!s.date || Number.isNaN(s.minutes)) return;
    // The end follows the start, the length stays.
    const finish = fromSeconds(toSeconds(at(s.date, s.minutes)) + duration * 60);
    end.dateInput.value = dateOf(finish);
    if (!allDay.input.checked) end.timeInput.value = minutesText(minuteOfDay(finish));
    recurrence.setSeed(s.date);
    reminders.setDayMode(allDay.input.checked, allDay.input.checked ? DEFAULT_START_MINUTES : s.minutes);
    refreshHint();
  }

  function onEnd() {
    const s = readStart(), e = end.read();
    const a = toSeconds(at(s.date, s.minutes));
    const b = toSeconds(at(e.date, allDay.input.checked ? 0 : e.minutes));
    if (b >= a) duration = (b - a) / 60;
    refreshHint();
  }

  function onAllDay() {
    const on = allDay.input.checked;
    // Taking "весь день" off gives the event the hour a new one gets.
    if (!on && start.timeInput.value === '00:00') {
      start.timeInput.value = minutesText(DEFAULT_START_MINUTES);
      end.timeInput.value = minutesText(DEFAULT_START_MINUTES + settings.get('defaultEventDuration'));
      end.dateInput.value = start.dateInput.value;
      duration = settings.get('defaultEventDuration');
    }
    start.showTime(!on);
    end.showTime(!on);
    reminders.setDayMode(on, on ? DEFAULT_START_MINUTES : parseTime(start.timeInput.value));
    refreshHint();
  }

  start.showTime(!allDay0);
  end.showTime(!allDay0);
  refreshHint();

  let result = null;
  const dialog = new Dialog({ title: isNew ? 'Новое событие' : 'Событие', onSave: () => {
    const s = start.read(), e = end.read();
    if (!s.date || !e.date || (!allDay.input.checked && (Number.isNaN(s.minutes) || Number.isNaN(e.minutes)))) {
      error.textContent = 'Укажите дату и время';
      return false;
    }
    const startText = at(s.date, allDay.input.checked ? 0 : s.minutes);
    const endText = at(e.date, allDay.input.checked ? 23 * 60 + 59 : e.minutes);
    if (endText < startText) {
      error.textContent = 'Окончание раньше начала';
      return false;
    }
    if (!calendar.select.value || !store.isCalendarWritable(calendar.select.value)) {
      error.textContent = 'Выберите календарь, в который можно писать';
      return false;
    }
    result = {
      ...event,
      title: title.value.trim(),
      allDay: allDay.input.checked,
      start: startText,
      end: endText,
      calendarId: calendar.select.value,
      color,
      reminders: reminders.reminders(),
      recurrence: recurrence.value(),
      location: location.value.trim(),
      description: description.value,
      cancelled: cancelled.input.checked,
      ...alarmBox.read(),
    };
    if (isNew) settings.set('lastCalendarId', result.calendarId, { quiet: true });
    return result;
  } });
  dialog.body.append(
    title,
    allDay,
    field('Начало', start),
    field('Окончание', h('div', { class: 'col', style: { gap: '4px' } }, end, hint)),
    field('Календарь', calendar),
    field('Повтор', recurrence.el),
    field('Напоминания', reminders.el),
    alarmBox,
    field('Место', location),
    field('Описание', description),
    field('Цвет события', colors),
    isNew ? null : cancelled,
    error);
  if (!isMobile()) setTimeout(() => { title.focus(); title.select(); }, 40);
  return dialog.open().then((ok) => (ok ? result : null));
}

/** The task editor; resolves to the task to save (with .requestedState) or null. */
export function editTask(app, task, { isNew = false } = {}) {
  const store = app.store;
  const hasDue0 = !!task.dueAt;
  const title = h('input', { type: 'text', class: 'title-input', value: task.title || '', placeholder: 'Что сделать', maxLength: 500 });
  const hasDue = toggle('Срок', hasDue0, () => apply());
  const dueDate = h('input', { type: 'date', value: hasDue0 ? dateOf(task.dueAt) : today(), on: { change: () => apply() } });
  const hasTime = toggle('Время', !!task.hasDueTime, () => apply());
  const dueTime = h('input', { type: 'time', value: minutesText(task.hasDueTime ? minuteOfDay(task.dueAt) : DEFAULT_START_MINUTES), on: { change: () => apply() } });
  const calendarId0 = isNew
    ? (store.isCalendarWritable(settings.get('lastCalendarId')) && store.calendar(settings.get('lastCalendarId')) ? settings.get('lastCalendarId') : store.defaultWritableCalendarId())
    : task.calendarId;
  const calendar = calendarSelect(store, calendarId0, null, { includeId: task.calendarId });
  const reminders = new ReminderList({
    reminders: task.reminders || [], dayMode: !task.hasDueTime, recordMinute: task.hasDueTime ? minuteOfDay(task.dueAt) : DEFAULT_START_MINUTES,
    defaultAlarm: settings.get('defaultReminderType') === 'alarm', onChange: () => { alarmBox.hidden = !reminders.hasAlarm(); },
  });
  const recurrence = new RecurrenceEditor(task.recurrence || normalizeRule(null), hasDue0 ? dateOf(task.dueAt) : today());
  const alarmBox = alarmOptions(task, store);
  alarmBox.hidden = !reminders.hasAlarm();
  const notes = h('textarea', { value: task.notes || '', placeholder: 'Примечание' });
  const followSubtasks = toggle('Выполнить вместе с подзадачами', task.doneWithSubtasks);
  const subtasks = (task.subtasks || []).map((s) => ({ ...s }));
  const subtaskBox = h('div', { class: 'col', style: { gap: '4px' } });
  const remindersField = field('Напоминания', reminders.el);
  const recurrenceField = field('Повтор', recurrence.el);
  const timeRow = h('div', { class: 'row wrap' }, dueDate, hasTime, dueTime);
  const error = h('div', { class: 'error' });
  let lastTimed = !!task.hasDueTime;

  function apply() {
    const due = hasDue.input.checked;
    timeRow.hidden = !due;
    dueTime.hidden = !hasTime.input.checked;
    remindersField.hidden = !due;
    recurrenceField.hidden = !due;
    const timed = due && hasTime.input.checked;
    const minute = parseTime(dueTime.value);
    if (timed !== lastTimed) {
      reminders.setDayMode(!timed, timed ? (Number.isNaN(minute) ? DEFAULT_START_MINUTES : minute) : DEFAULT_START_MINUTES);
      lastTimed = timed;
    } else if (timed && !Number.isNaN(minute)) {
      reminders.recordMinute = minute;
    }
    recurrence.setSeed(dueDate.value || today());
  }

  function renderSubtasks() {
    subtaskBox.replaceChildren(...subtasks.map((sub, index) => {
      const input = h('input', { type: 'text', value: sub.title, placeholder: 'Подзадача', on: { input: () => { sub.title = input.value; } } });
      return h('div', { class: 'subtask-row' },
        h('button', { class: ['check', 'square', sub.done ? 'done' : ''], type: 'button', on: { click: () => { sub.done = !sub.done; renderSubtasks(); } } }, sub.done ? icon('check') : null),
        input,
        h('button', { class: 'icon-btn', title: 'Выше', disabled: index === 0, on: { click: () => { subtasks.splice(index - 1, 0, subtasks.splice(index, 1)[0]); renderSubtasks(); } } }, icon('up')),
        h('button', { class: 'icon-btn', title: 'Убрать', on: { click: () => { subtasks.splice(index, 1); renderSubtasks(); } } }, icon('close')));
    }), h('button', { class: 'btn flat', style: { alignSelf: 'flex-start' }, on: { click: () => {
      subtasks.push({ id: '', title: '', done: false, sortOrder: subtasks.length });
      renderSubtasks();
      subtaskBox.querySelectorAll('input[type=text]')[subtasks.length - 1]?.focus();
    } } }, icon('plus'), 'Добавить подзадачу'));
  }
  renderSubtasks();
  apply();

  let result = null;
  const dialog = new Dialog({ title: isNew ? 'Новая задача' : 'Задача', onSave: () => {
    const due = hasDue.input.checked;
    const timed = due && hasTime.input.checked;
    const minute = parseTime(dueTime.value);
    if (due && !dueDate.value) {
      error.textContent = 'Укажите дату срока';
      return false;
    }
    if (!calendar.select.value || !store.isCalendarWritable(calendar.select.value)) {
      error.textContent = 'Выберите календарь, в который можно писать';
      return false;
    }
    result = {
      ...task,
      title: title.value.trim(),
      calendarId: calendar.select.value,
      dueAt: due ? at(dueDate.value, timed ? (Number.isNaN(minute) ? DEFAULT_START_MINUTES : minute) : 0) : null,
      hasDueTime: timed,
      reminders: due ? reminders.reminders() : [],
      recurrence: due ? recurrence.value() : normalizeRule(null),
      notes: notes.value,
      doneWithSubtasks: followSubtasks.input.checked,
      subtasks: subtasks.filter((s) => s.title.trim()).map((s, i) => ({ ...s, title: s.title.trim(), sortOrder: i })),
      ...alarmBox.read(),
    };
    if (isNew) settings.set('lastCalendarId', result.calendarId, { quiet: true });
    return result;
  } });
  dialog.body.append(title, field('Календарь', calendar), hasDue, timeRow, recurrenceField, remindersField, alarmBox,
    field('Подзадачи', subtaskBox), followSubtasks, field('Примечание', notes), error);
  if (!isMobile()) setTimeout(() => { title.focus(); title.select(); }, 40);
  return dialog.open().then((ok) => (ok ? result : null));
}

/** The editor of a reminder of its own. */
export function editReminder(app, reminder, { isNew = false } = {}) {
  const store = app.store;
  const title = h('input', { type: 'text', class: 'title-input', value: reminder.title || '', placeholder: 'О чём напомнить', maxLength: 500 });
  const when = dateTimeInputs(dateOf(reminder.at), minuteOfDay(reminder.at), () => recurrence.setSeed(when.read().date));
  const recurrence = new RecurrenceEditor(reminder.recurrence || normalizeRule(null), dateOf(reminder.at));
  const kind = h('div', { class: 'seg' });
  let alarm = !!reminder.alarm;
  const alarmBox = alarmOptions(reminder, store);
  const paintKind = () => {
    kind.replaceChildren(
      h('button', { class: alarm ? '' : 'on', on: { click: () => { alarm = false; paintKind(); } } }, icon('bell'), ' Уведомление'),
      h('button', { class: alarm ? 'on' : '', on: { click: () => { alarm = true; paintKind(); } } }, icon('alarm'), ' Будильник'));
    alarmBox.hidden = !alarm;
  };
  paintKind();
  const notes = h('textarea', { value: reminder.notes || '', placeholder: 'Примечание' });
  const enabled = toggle('Включено', reminder.enabled !== false);
  const error = h('div', { class: 'error' });
  let result = null;
  const original = reminder.at;
  const dialog = new Dialog({ title: isNew ? 'Новое напоминание' : 'Напоминание', onSave: () => {
    const w = when.read();
    if (!w.date || Number.isNaN(w.minutes)) {
      error.textContent = 'Укажите дату и время';
      return false;
    }
    const moment = at(w.date, w.minutes);
    const rule = recurrence.value();
    // A moment already behind would never ring; an old one opened to fix
    // its text is saved as it is.
    if ((isNew || moment !== original) && !isActive(rule) && toSeconds(moment) < nowSeconds()) {
      error.textContent = 'Это время уже прошло';
      return false;
    }
    result = { ...reminder, title: title.value.trim(), at: moment, recurrence: rule, alarm, notes: notes.value, enabled: enabled.input.checked, ...alarmBox.read() };
    return result;
  } });
  dialog.body.append(title, field('Когда', when), field('Повтор', recurrence.el), field('Как напомнить', kind), alarmBox,
    field('Примечание', notes), isNew ? null : enabled, error);
  if (!isNew) dialog.addButton('Удалить', () => dialog.close('delete'), { danger: true, iconName: 'trash' });
  return dialog.open().then((value) => (value === 'delete' ? 'delete' : value ? result : null));
}

/** Reminders a new record starts with, from the settings. */
export function defaultEventReminders(allDay) {
  const setting = settings.get('defaultEventReminder');
  if (setting < 0) return [];
  const rings = settings.get('defaultReminderType') === 'alarm';
  return (allDay ? toDayReminders([setting], DEFAULT_START_MINUTES) : [setting]).map((r) => reminderWithKind(r, rings));
}

export function defaultTaskReminders(hasTime) {
  const setting = settings.get('defaultTaskReminder');
  if (setting < 0) return [];
  const rings = settings.get('defaultReminderType') === 'alarm';
  return (hasTime ? [setting] : toDayReminders([setting], DEFAULT_START_MINUTES)).map((r) => reminderWithKind(r, rings));
}
