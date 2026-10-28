// Reminder offsets of events and tasks, a port of the reminder half of the
// planner's model/types.cpp. A reminder is one number:
//
//   - minutes before the moment of a record that has a time;
//   - for a record without one (an all-day event, a task without an hour),
//     days * 1440 + the minute of the day it rings at - "за 1 день, в 09:00"
//     is 1980;
//   - and either way one bit above every such value says that it rings as an
//     alarm clock rather than coming as a quiet notification.
//
// The list stays a list of numbers, which is what the planner's database, its
// backup and the sync carry. Everything that reads the offset goes through
// reminderOffset(), so the mark never reaches arithmetic.

import { pluralRu, formatOffset } from './text.js';
import { minutesText } from './dates.js';

const DAY_MINUTES = 1440;
export const ALARM_MARK = 1 << 24;

/** The hour a record starts at when nobody said when: nine. */
export const DEFAULT_START_MINUTES = 9 * 60;

export function reminderRingsAlarm(reminder) {
  return reminder > 0 && (reminder & ALARM_MARK) !== 0;
}

export function reminderOffset(reminder) {
  return reminder < 0 ? reminder : reminder & ~ALARM_MARK;
}

export function reminderWithKind(reminder, alarm) {
  const offset = reminderOffset(reminder);
  if (offset < 0) return offset;
  return alarm ? (offset | ALARM_MARK) : offset;
}

export function anyReminderRingsAlarm(list) {
  return (list || []).some(reminderRingsAlarm);
}

/**
 * A record written when the kind was one flag for all of it: nothing carries a
 * mark, so @p alarm decides for every reminder.
 */
export function remindersWithRecordAlarm(list, alarm) {
  if (!alarm || anyReminderRingsAlarm(list)) return list;
  return list.map((r) => reminderWithKind(r, true));
}

/** Each distance once, the first keeps its kind; sorted by offset, negatives dropped. */
export function normalizedReminders(list) {
  const result = [];
  for (const raw of list || []) {
    const value = Math.trunc(Number(raw));
    if (!Number.isFinite(value)) continue;
    const offset = reminderOffset(value);
    if (offset < 0) continue;
    if (!result.some((kept) => reminderOffset(kept) === offset)) result.push(value);
  }
  return result.sort((a, b) => reminderOffset(a) - reminderOffset(b));
}

export function dayReminderDays(packed) {
  return Math.floor(Math.max(0, reminderOffset(packed)) / DAY_MINUTES);
}

/** Minutes since midnight a packed day reminder rings at. */
export function dayReminderMinute(packed) {
  return Math.max(0, reminderOffset(packed)) % DAY_MINUTES;
}

export function packDayReminder(days, minuteOfDay = DEFAULT_START_MINUTES) {
  return Math.max(0, days) * DAY_MINUTES + minuteOfDay;
}

/** Offsets of a record with a time, re-expressed for the same record without one. */
export function toDayReminders(offsets, recordMinute) {
  const start = recordMinute || 0;
  const result = [];
  for (const value of offsets) {
    const offset = reminderOffset(value);
    if (offset < 0) continue;
    const fromMidnight = start - offset;
    const days = fromMidnight >= 0 ? 0 : Math.floor((DAY_MINUTES - 1 - fromMidnight) / DAY_MINUTES);
    const minute = fromMidnight + days * DAY_MINUTES;
    result.push(reminderWithKind(packDayReminder(days, minute), reminderRingsAlarm(value)));
  }
  return normalizedReminders(result);
}

/** And back: packed day reminders as offsets before @p recordMinute. */
export function toOffsetReminders(packed, recordMinute) {
  const start = recordMinute || 0;
  const result = [];
  for (const value of packed) {
    const offset = reminderOffset(value);
    if (offset < 0) continue;
    const minutes = dayReminderDays(offset) * DAY_MINUTES + start - dayReminderMinute(offset);
    result.push(reminderWithKind(Math.max(0, minutes), reminderRingsAlarm(value)));
  }
  return normalizedReminders(result);
}

/** Minutes before midnight of the day, the iCalendar form; later that day is negative. */
export function dayReminderToOffset(packed) {
  return dayReminderDays(packed) * DAY_MINUTES - dayReminderMinute(packed);
}

export function dayReminderFromOffset(minutes) {
  let days = minutes >= 0 ? Math.floor((minutes + DAY_MINUTES - 1) / DAY_MINUTES)
    : -Math.floor(-minutes / DAY_MINUTES);
  days = Math.max(0, days);
  const minute = Math.min(Math.max(days * DAY_MINUTES - minutes, 0), DAY_MINUTES - 1);
  return days * DAY_MINUTES + minute;
}

/** "За 15 минут", "В момент начала", "Без напоминания". */
export function formatReminder(reminder) {
  const minutes = reminderOffset(reminder);
  if (minutes < 0) return 'Без напоминания';
  if (minutes === 0) return 'В момент начала';
  const offset = formatOffset(minutes).replace('минута', 'минуту').replace('неделя', 'неделю');
  return `За ${offset}`;
}

/** "В этот день, в 09:00", "За 2 дня, в 20:00". */
export function formatDayReminder(packed) {
  const at = minutesText(dayReminderMinute(packed));
  const days = dayReminderDays(packed);
  if (days === 0) return `В этот день, в ${at}`;
  return `За ${days} ${pluralRu(days, 'день', 'дня', 'дней')}, в ${at}`;
}

export function reminderPresets() {
  return [0, 5, 10, 15, 30, 60, 120, 240, 1440, 2 * 1440, 7 * 1440];
}

export function dayReminderPresets() {
  return [packDayReminder(0), packDayReminder(1), packDayReminder(2), packDayReminder(7)];
}

export const MAX_REMINDERS = 10;

/** How late an alarm may be and still ring, in minutes. */
export const ALARM_GRACE_MINUTES = 5;
