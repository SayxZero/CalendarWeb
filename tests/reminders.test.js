import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALARM_MARK, reminderOffset, reminderRingsAlarm, reminderWithKind, normalizedReminders, packDayReminder,
  toDayReminders, toOffsetReminders, dayReminderToOffset, dayReminderFromOffset, formatReminder,
  formatDayReminder, remindersWithRecordAlarm,
} from '../site/js/model/reminders.js';

test('the kind rides in the same number as the offset', () => {
  const alarm = reminderWithKind(15, true);
  assert.equal(alarm, 15 | ALARM_MARK);
  assert.ok(reminderRingsAlarm(alarm));
  assert.equal(reminderOffset(alarm), 15);
  assert.equal(reminderWithKind(alarm, false), 15);
  assert.equal(reminderWithKind(-1, true), -1);
});

test('one distance is one reminder, the first keeps its kind', () => {
  assert.deepEqual(normalizedReminders([60, 15 | ALARM_MARK, 15, -1, 0]), [0, 15 | ALARM_MARK, 60]);
});

test('a day reminder packs days and the minute of the day', () => {
  assert.equal(packDayReminder(0, 540), 540);
  assert.equal(packDayReminder(1, 540), 1980);
  assert.equal(formatDayReminder(1980), 'За 1 день, в 09:00');
  assert.equal(formatDayReminder(540), 'В этот день, в 09:00');
  assert.equal(formatReminder(0), 'В момент начала');
  assert.equal(formatReminder(1), 'За 1 минуту');
  assert.equal(formatReminder(7 * 1440), 'За 1 неделю');
  assert.equal(formatReminder(90), 'За 1 час 30 минут');
});

test('switching the kind of a record keeps the moment of every reminder', () => {
  // A record at nine: "в момент начала" is "в этот день, в 09:00"; 13 hours
  // before is eight in the evening the day before.
  const offsets = [0, 13 * 60 | ALARM_MARK, 1440];
  const packed = toDayReminders(offsets, 540);
  assert.deepEqual(packed, [540, 1980, 1440 + 1200 | ALARM_MARK]);
  assert.deepEqual(toOffsetReminders(packed, 540), [0, 13 * 60 | ALARM_MARK, 1440]);
});

test('iCalendar counts a day reminder from midnight, later that day negative', () => {
  assert.equal(dayReminderToOffset(540), -540);
  assert.equal(dayReminderToOffset(1980), 900);
  assert.equal(dayReminderFromOffset(-540), 540);
  assert.equal(dayReminderFromOffset(960), 1440 + 480);
});

test('a record written with one alarm flag rings with every reminder', () => {
  assert.deepEqual(remindersWithRecordAlarm([0, 15], true), [ALARM_MARK, 15 | ALARM_MARK]);
  assert.deepEqual(remindersWithRecordAlarm([0, 15 | ALARM_MARK], true), [0, 15 | ALARM_MARK]);
  assert.deepEqual(remindersWithRecordAlarm([0, 15], false), [0, 15]);
});
