import test from 'node:test';
import assert from 'node:assert/strict';

import { setClock } from '../site/js/model/dates.js';
import { Store } from '../site/js/core/store.js';
import { Kind, normalize, HabitDay } from '../site/js/model/records.js';
import { Freq } from '../site/js/model/recurrence.js';

let clock = new Date(2026, 9, 28, 12, 0, 0);
setClock(() => clock);

function fresh() {
  const store = new Store();
  store.ensureSeed();
  return store;
}

test('the seed calendar is not journaled, a saved one is', () => {
  const store = fresh();
  assert.equal(store.calendars().length, 1);
  assert.equal(store.journal.size, 0);
  const id = store.saveCalendar({ name: 'Работа', color: '#0f9d58' });
  assert.ok(store.journal.has(`calendar/${id}`));
  assert.equal(store.calendar(id).sortOrder, 1);
});

test('a repeating task rolls on and logs each closing', () => {
  const store = fresh();
  const id = store.saveTask({
    title: 'Полить цветы', dueAt: '2026-10-28T00:00:00',
    recurrence: { freq: Freq.Weekly }, subtasks: [{ title: 'кухня', done: true }],
  });
  store.setTaskDone(id, true);
  const task = store.task(id);
  assert.equal(task.dueAt, '2026-11-04T00:00:00');
  assert.equal(task.done, false);
  assert.equal(task.subtasks[0].done, false, 'the checklist starts over');
  assert.equal(store.completions().length, 1);
  assert.equal(store.completedInLastDays(30), 1);
});

test('re-opening takes the newest log entry away, trading answers counts once', () => {
  const store = fresh();
  const id = store.saveTask({ title: 'Позвонить' });
  store.setTaskFailed(id, true);
  assert.equal(store.task(id).failed, true);
  assert.equal(store.completedInLastDays(30), 0, 'given up is not done');
  store.setTaskDone(id, true);
  assert.equal(store.task(id).done, true);
  assert.equal(store.task(id).failed, false);
  assert.equal(store.completions().length, 1);
  store.setTaskDone(id, false);
  assert.equal(store.completions().length, 0);
  assert.ok(store.journal.get(`completion/${[...store.journal.values()].find((e) => e.kind === 'completion').id}`).deleted);
});

test('a task that follows its checklist closes with the last tick and opens again', () => {
  const store = fresh();
  const id = store.saveTask({ title: 'Сборы', doneWithSubtasks: true, subtasks: [{ title: 'a' }, { title: 'b' }] });
  const [a, b] = store.task(id).subtasks;
  store.setSubtaskDone(id, a.id, true);
  assert.equal(store.task(id).done, false);
  store.setSubtaskDone(id, b.id, true);
  assert.equal(store.task(id).done, true);
  store.setSubtaskDone(id, b.id, false);
  assert.equal(store.task(id).done, false);
});

test('one repetition is detached or excluded, the series stays', () => {
  const store = fresh();
  const id = store.saveEvent({ title: 'Йога', start: '2026-10-26T19:00:00', end: '2026-10-26T20:00:00', recurrence: { freq: Freq.Daily } });
  const copy = store.detachOccurrence(id, '2026-10-28');
  assert.equal(copy.start, '2026-10-28T19:00:00');
  assert.equal(copy.recurrence.freq, 0);
  assert.deepEqual(store.event(id).recurrence.exceptions, ['2026-10-28']);
  store.excludeOccurrence(id, '2026-10-29');
  const days = store.occurrences('2026-10-26', '2026-10-30').map((o) => o.start.slice(0, 10));
  assert.deepEqual(days, ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-30']);
});

test('moving one occurrence of a series moves only it', () => {
  const store = fresh();
  const id = store.saveEvent({ title: 'Планёрка', start: '2026-10-26T10:00:00', end: '2026-10-26T10:30:00', recurrence: { freq: Freq.Daily } });
  const occurrence = store.occurrencesOn('2026-10-27')[0];
  store.moveOccurrence(occurrence, '2026-10-27', 14 * 60);
  const on27 = store.occurrencesOn('2026-10-27');
  assert.equal(on27.length, 1);
  assert.equal(on27[0].start, '2026-10-27T14:00:00');
  assert.notEqual(on27[0].event.id, id);
  assert.equal(on27[0].end, '2026-10-27T14:30:00');
});

test('a calendar goes with its records or hands them over; the last one stays', () => {
  const store = fresh();
  const work = store.saveCalendar({ name: 'Работа' });
  const event = store.saveEvent({ title: 'x', calendarId: work, start: '2026-10-28T09:00:00' });
  assert.equal(store.removeCalendar('default', work), true);
  assert.equal(store.removeCalendar(work), false, 'the last calendar stays');
  const other = store.saveCalendar({ name: 'Дом' });
  assert.equal(store.removeCalendar(work, other), true);
  assert.equal(store.event(event).calendarId, other);
  const gone = store.saveEvent({ title: 'y', calendarId: other, start: '2026-10-28T09:00:00' });
  store.saveCalendar({ name: 'Ещё' });
  store.removeCalendar(other);
  assert.equal(store.event(gone), null);
  assert.ok(store.journal.get(`event/${gone}`).deleted);
});

test('giving a shared calendar back leaves the owner\'s records alone', () => {
  const store = fresh();
  const twin = store.saveCalendar({ name: 'Семья', ownerLogin: 'anna', originId: 'orig', access: 'edit' });
  store.tracking = false;
  store.saveEvent({ id: 'shared-e', title: 'Ужин', calendarId: twin, start: '2026-10-28T19:00:00' });
  store.tracking = true;
  store.journal.clear();
  assert.ok(store.dropSharedCalendar(twin));
  assert.equal(store.event('shared-e'), null);
  assert.deepEqual([...store.journal.keys()], [`calendar/${twin}`], 'only the twin goes to the server');
});

test('a calendar open for reading takes no ticks', () => {
  const store = fresh();
  const twin = store.saveCalendar({ name: 'Чужой', ownerLogin: 'anna', originId: 'o', access: 'read' });
  const id = store.saveTask({ title: 't', calendarId: twin });
  store.setTaskDone(id, true);
  assert.equal(store.task(id).done, false);
  assert.equal(store.defaultWritableCalendarId(), 'default');
});

test('the habit chart: absent, missed, done, and today still pending', () => {
  const store = fresh();
  clock = new Date(2026, 9, 25, 9, 0, 0);
  const id = store.saveHabit({ title: 'Зарядка' });
  clock = new Date(2026, 9, 28, 9, 0, 0);
  store.setHabitDone(id, '2026-10-26', true);
  const chart = store.habitChart(store.habit(id), '2026-10-28', 5);
  assert.deepEqual(chart, [HabitDay.Absent, HabitDay.Missed, HabitDay.Done, HabitDay.Missed, HabitDay.Pending]);
  assert.ok(store.journal.has(`habitmark/${id}@2026-10-26`));
  store.setHabitDone(id, '2026-10-26', false);
  assert.ok(store.journal.get(`habitmark/${id}@2026-10-26`).deleted);
  clock = new Date(2026, 9, 28, 12, 0, 0);
});

test('a habit brought back did not miss the days it was away', () => {
  const store = fresh();
  clock = new Date(2026, 9, 20, 9, 0, 0);
  const id = store.saveHabit({ title: 'Чтение' });
  clock = new Date(2026, 9, 22, 9, 0, 0);
  store.archiveHabit(id);
  assert.equal(store.habits().length, 0);
  clock = new Date(2026, 9, 26, 9, 0, 0);
  store.restoreHabit(id);
  assert.deepEqual(store.habit(id).pauses, [['2026-10-22', '2026-10-26']]);
  assert.equal(store.habitChart(store.habit(id), '2026-10-26', 5)[1], HabitDay.Absent);
  clock = new Date(2026, 9, 28, 12, 0, 0);
});

test('a reminder of its own is kept to the minute', () => {
  const store = fresh();
  const id = store.saveReminder({ title: ' Духовка ', at: '2026-10-28T21:00:37' });
  assert.equal(store.reminder(id).at, '2026-10-28T21:00:00');
  assert.equal(store.reminder(id).title, 'Духовка');
  assert.equal(store.activeReminders('2026-10-28T12:00:00'), 1);
  store.setReminderEnabled(id, false);
  assert.equal(store.activeReminders('2026-10-28T12:00:00'), 0);
});

test('removing a melody sends the records that rang it back to the settings', () => {
  const store = fresh();
  const melody = store.saveMelody({ title: 'Песня', format: 'mp3', data: 'AAAA' });
  const task = store.saveTask({ title: 't', alarmMelody: `melody:${melody}` });
  store.removeMelody(melody);
  assert.equal(store.task(task).alarmMelody, '');
});

test('a remote record of somebody else\'s calendar keeps this member\'s reminders', () => {
  const store = fresh();
  const twin = store.saveCalendar({ name: 'Семья', ownerLogin: 'anna', originId: 'o', access: 'edit' });
  store.tracking = false;
  store.saveEvent({ id: 'e', title: 'old', calendarId: twin, start: '2026-10-28T19:00:00', reminders: [10] });
  store.tracking = true;
  const arriving = normalize(Kind.event, { id: 'e', title: 'new', calendarId: twin, start: '2026-10-28T19:00:00', reminders: [60] });
  store.applyRemote({ records: [{ kind: Kind.event, record: arriving }], removals: [] });
  assert.equal(store.event('e').title, 'new');
  assert.deepEqual(store.event('e').reminders, [10]);
  assert.deepEqual(store.ownerReminders(Kind.event, 'e'), [60]);
});

test('the first sync drops untouched seeds when the account has calendars', () => {
  const store = fresh();
  const arriving = normalize(Kind.calendar, { id: 'acc-cal', name: 'Из аккаунта' });
  store.applyRemote({ records: [{ kind: Kind.calendar, record: arriving }], removals: [] }, true);
  assert.deepEqual(store.calendars().map((c) => c.id), ['acc-cal']);
});

test('republishing leaves somebody else\'s records out', () => {
  const store = fresh();
  const twin = store.saveCalendar({ name: 'Чужой', ownerLogin: 'anna', originId: 'o', access: 'edit' });
  store.saveEvent({ title: 'своё', start: '2026-10-28T10:00:00' });
  store.tracking = false;
  store.saveEvent({ id: 'foreign', title: 'чужое', calendarId: twin, start: '2026-10-28T10:00:00' });
  store.tracking = true;
  store.journal.clear();
  store.republishAll();
  assert.ok(!store.journal.has('event/foreign'));
  assert.ok(store.journal.has(`calendar/${twin}`));
  assert.ok(store.journal.has('calendar/default'));
});
