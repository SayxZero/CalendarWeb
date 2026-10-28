import test from 'node:test';
import assert from 'node:assert/strict';

import { setClock } from '../site/js/model/dates.js';
import {
  Kind, normalize, toData, spanDays, eventOccurrences, timeRangeText, dueText, taskReminderAt,
  reminderNextFiring, reminderFirings, habitExistedOn, isWritable,
} from '../site/js/model/records.js';
import { toSeconds } from '../site/js/model/dates.js';
import { ALARM_MARK } from '../site/js/model/reminders.js';

setClock(() => new Date(2026, 9, 28, 12, 0, 0));

// What the planner's JsonIo::toJson(Event) writes.
const plannerEvent = {
  id: 'e1', title: 'Встреча', description: '', location: 'Офис', calendarId: 'default',
  start: '2026-10-28T09:30:00', end: '2026-10-28T11:00:00', allDay: false, color: '',
  reminders: [15], alarm: false, alarmMelody: '', alarmVibration: -1, snoozeMinutes: 0, snoozeLimit: 3,
  cancelled: false,
  recurrence: { freq: 2, interval: 1, weekdays: 4, monthlyMode: 0, endMode: 0, count: 10, until: null, exceptions: [] },
  createdAt: '2026-10-01T10:00:00', updatedAt: '2026-10-01T10:00:00',
};

test('a planner event survives the trip unchanged', () => {
  const record = normalize(Kind.event, plannerEvent);
  assert.deepEqual(toData(Kind.event, record), plannerEvent);
});

test('fields of a newer planner are kept', () => {
  const record = normalize(Kind.task, { id: 't', title: 'x', futureField: { deep: 1 } });
  assert.deepEqual(toData(Kind.task, record).futureField, { deep: 1 });
});

test('records the planner throws away are thrown away here too', () => {
  assert.equal(normalize(Kind.event, { id: 'x', title: 'no start' }), null);
  assert.equal(normalize(Kind.habitMark, { id: 'm', habitId: 'h' }), null);
  assert.equal(normalize(Kind.reminder, { id: 'r' }), null);
  assert.equal(normalize(Kind.completion, { id: 'c', taskId: 't' }), null);
  assert.equal(normalize(Kind.melody, { id: 'm', title: 'no sound' }), null);
  assert.equal(normalize('category', { id: 'old' }), null);
});

test('old forms are read as the planner reads them', () => {
  const v1 = normalize(Kind.task, { id: 't', status: 2, reminderMinutes: 30 });
  assert.equal(v1.done, true);
  assert.deepEqual(v1.reminders, [30]);
  const oneFlag = normalize(Kind.event, { ...plannerEvent, reminders: [0, 15], alarm: true });
  assert.deepEqual(oneFlag.reminders, [ALARM_MARK, 15 | ALARM_MARK]);
  const both = normalize(Kind.task, { id: 't', done: true, failed: true });
  assert.equal(both.failed, false);
  const habit = normalize(Kind.habit, { id: 'h', title: 'Бег', createdAt: '2026-10-01T08:00:00' });
  assert.equal(habit.startedAt, '2026-10-01');
});

test('a moment with a zone is read as local time', () => {
  const record = normalize(Kind.event, { ...plannerEvent, start: '2026-10-28T09:30' });
  assert.equal(record.start, '2026-10-28T09:30:00');
});

test('occurrences of a repeating event keep its length', () => {
  const event = normalize(Kind.event, plannerEvent);
  const list = eventOccurrences(event, '2026-11-01', '2026-11-30');
  assert.deepEqual(list.map((o) => o.start), ['2026-11-04T09:30:00', '2026-11-11T09:30:00', '2026-11-18T09:30:00', '2026-11-25T09:30:00']);
  assert.equal(list[0].end, '2026-11-04T11:00:00');
  assert.equal(timeRangeText(event), '09:30 – 11:00');
});

test('an event ending at midnight belongs to the day before', () => {
  const night = normalize(Kind.event, { ...plannerEvent, start: '2026-10-28T22:00:00', end: '2026-10-29T00:00:00', recurrence: null });
  assert.equal(spanDays(night), 1);
  const multi = normalize(Kind.event, { ...plannerEvent, allDay: true, start: '2026-10-28T00:00:00', end: '2026-10-30T00:00:00', recurrence: null });
  assert.equal(spanDays(multi), 2);
  // ...and reaches into a window that starts after it began.
  assert.equal(eventOccurrences(multi, '2026-10-29', '2026-10-29').length, 1);
});

test('task due text and reminder moments', () => {
  const overdue = normalize(Kind.task, { id: 't', dueAt: '2026-10-27T00:00:00', hasDueTime: false });
  assert.equal(dueText(overdue), 'Просрочено · Вчера');
  const timed = normalize(Kind.task, { id: 't', dueAt: '2026-10-29T18:00:00', hasDueTime: true });
  assert.equal(dueText(timed), 'Завтра, 18:00');
  assert.equal(taskReminderAt(timed, 30), '2026-10-29T17:30:00');
  assert.equal(taskReminderAt(overdue, 1980), '2026-10-26T09:00:00');
});

test('a reminder of its own fires at its hour on every day of its rule', () => {
  const daily = normalize(Kind.reminder, { id: 'r', title: 'Витамины', at: '2026-10-01T21:00:00', recurrence: { freq: 1 } });
  assert.equal(reminderNextFiring(daily, '2026-10-28T12:00:00'), '2026-10-28T21:00:00');
  assert.equal(reminderNextFiring(daily, '2026-10-28T21:30:00'), '2026-10-29T21:00:00');
  assert.deepEqual(reminderFirings(daily, toSeconds('2026-10-28T00:00:00'), toSeconds('2026-10-29T23:59:59')),
    ['2026-10-28T21:00:00', '2026-10-29T21:00:00']);
  const once = normalize(Kind.reminder, { id: 'o', at: '2026-10-01T21:00:00' });
  assert.equal(reminderNextFiring(once, '2026-10-28T12:00:00'), null);
});

test('a habit did not exist before its start, after its removal and in a pause', () => {
  const habit = normalize(Kind.habit, { id: 'h', startedAt: '2026-10-01', pauses: [['2026-10-10', '2026-10-15']] });
  assert.ok(!habitExistedOn(habit, '2026-09-30'));
  assert.ok(habitExistedOn(habit, '2026-10-09'));
  assert.ok(!habitExistedOn(habit, '2026-10-12'));
  assert.ok(habitExistedOn(habit, '2026-10-15'));
});

test('a twin with the right to read takes no records', () => {
  assert.ok(isWritable(normalize(Kind.calendar, { id: 'c' })));
  assert.ok(!isWritable(normalize(Kind.calendar, { id: 'c', ownerLogin: 'anna', access: 'read' })));
  assert.ok(isWritable(normalize(Kind.calendar, { id: 'c', ownerLogin: 'anna', access: 'edit' })));
});

test('share links are read and written the way the planner does', async () => {
  const { plannerLink, tokenFromLink, sameServer } = await import('../site/js/model/share.js');
  const link = plannerLink('192.168.0.146:8765', 'Ab_c-1234567890123456');
  assert.equal(link, 'calendar-planner://share?server=http%3A%2F%2F192.168.0.146%3A8765&token=Ab_c-1234567890123456');
  assert.deepEqual(tokenFromLink(link), { token: 'Ab_c-1234567890123456', server: 'http://192.168.0.146:8765' });
  assert.equal(tokenFromLink('https://cal.example/#join=Ab_c-1234567890123456').token, 'Ab_c-1234567890123456');
  assert.ok(sameServer('http://192.168.0.146:8765/', '192.168.0.146:8765'));
  assert.ok(!sameServer('192.168.0.146:8765', '192.168.0.146:8766'));
});
