import test from 'node:test';
import assert from 'node:assert/strict';

import { setClock } from '../site/js/model/dates.js';
import { Store } from '../site/js/core/store.js';
import { buildDocument, importText, fileNameFor } from '../site/js/core/ics.js';
import { Freq, End, weekdayBit } from '../site/js/model/recurrence.js';
import { ALARM_MARK } from '../site/js/model/reminders.js';

setClock(() => new Date(2026, 9, 28, 12, 0, 0));

function storeWith() {
  const store = new Store();
  store.ensureSeed();
  return store;
}

test('a calendar goes out and comes back the same', () => {
  const source = storeWith();
  const calendarId = source.saveCalendar({ name: 'Работа; отдел, «Север»', color: '#0f9d58' });
  source.saveEvent({
    title: 'Планёрка, еженедельно', calendarId, start: '2026-10-26T10:00:00', end: '2026-10-26T10:30:00',
    location: 'Переговорная', description: 'Строка 1\nСтрока 2',
    reminders: [15, 60 | ALARM_MARK],
    recurrence: { freq: Freq.Weekly, weekdays: weekdayBit(1) | weekdayBit(3), endMode: End.AfterCount, count: 6, exceptions: ['2026-10-28'] },
  });
  source.saveEvent({ title: 'Отпуск', calendarId, allDay: true, start: '2026-11-02T00:00:00', end: '2026-11-05T23:59:00', reminders: [1980] });
  source.saveTask({ title: 'Отчёт', calendarId, dueAt: '2026-10-30T18:00:00', hasDueTime: true, reminders: [30],
    subtasks: [{ title: 'таблица', done: true }] });
  source.saveTask({ title: 'Без часа', calendarId, dueAt: '2026-10-31T00:00:00', reminders: [540 | ALARM_MARK],
    recurrence: { freq: Freq.Monthly } });

  const calendar = source.calendar(calendarId);
  const text = buildDocument(source.events().filter((e) => e.calendarId === calendarId),
    source.tasks().filter((t) => t.calendarId === calendarId), calendar);
  assert.ok(text.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75), 'lines are folded');
  assert.match(text, /X-WR-CALNAME:Работа\\; отдел\\, «Север»/);

  const target = storeWith();
  const result = importText(text, target, 'file');
  assert.equal(result.calendarName, 'Работа; отдел, «Север»');
  assert.equal(result.importedEvents, 2);
  assert.equal(result.importedTasks, 2);
  const imported = target.calendars().find((c) => c.name === result.calendarName);
  assert.equal(imported.color, '#0f9d58');

  const weekly = target.events().find((e) => e.title === 'Планёрка, еженедельно');
  assert.equal(weekly.description, 'Строка 1\nСтрока 2');
  assert.deepEqual(weekly.reminders, [15, 60 | ALARM_MARK]);
  assert.deepEqual({ ...weekly.recurrence }, { freq: 2, interval: 1, weekdays: 5, monthlyMode: 0, endMode: 1, count: 6, until: null, exceptions: ['2026-10-28'] });
  const vacation = target.events().find((e) => e.title === 'Отпуск');
  assert.equal(vacation.allDay, true);
  assert.equal(vacation.end, '2026-11-05T23:59:00');
  assert.match(text, /DTEND;VALUE=DATE:20261106/);
  assert.deepEqual(vacation.reminders, [1980]);

  const report = target.tasks().find((t) => t.title === 'Отчёт');
  assert.equal(report.dueAt, '2026-10-30T18:00:00');
  assert.equal(report.hasDueTime, true);
  assert.equal(report.notes, '[x] таблица');
  const noHour = target.tasks().find((t) => t.title === 'Без часа');
  assert.deepEqual(noHour.reminders, [540 | ALARM_MARK]);
  assert.equal(noHour.recurrence.freq, Freq.Monthly);

  // The same file again fills the same calendar instead of making a copy.
  importText(text, target, 'file');
  assert.equal(target.calendars().filter((c) => c.name === result.calendarName).length, 1);
});

test('a file of another calendar app: UTC, statuses, triggers in hours', () => {
  const text = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Other//EN',
    'BEGIN:VEVENT', 'DTSTART:20261029T070000Z', 'DTEND:20261029T080000Z', 'SUMMARY:Звонок', 'STATUS:CANCELLED',
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'END:VALARM', 'END:VEVENT',
    'BEGIN:VTODO', 'SUMMARY:Сделано', 'STATUS:COMPLETED', 'END:VTODO',
    'BEGIN:VTODO', 'END:VTODO',
    'END:VCALENDAR',
  ].join('\r\n');
  const store = storeWith();
  const result = importText(text, store, 'Другое');
  assert.equal(result.calendarName, 'Другое');
  assert.equal(result.skipped, 1);
  const call = store.events()[0];
  assert.equal(call.cancelled, true);
  assert.deepEqual(call.reminders, [60]);
  assert.match(call.start, /^2026-10-29T\d\d:00:00$/);
  assert.equal(store.tasks()[0].done, true);
});

test('what is not a calendar file is said so', () => {
  assert.equal(importText('hello', storeWith()).error, 'Это не файл календаря (iCalendar)');
  assert.equal(fileNameFor({ name: 'a/b:c?' }), 'abc.ics');
  assert.equal(fileNameFor({ name: '...' }), 'calendar.ics');
});
