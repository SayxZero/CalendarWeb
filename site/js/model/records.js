// Records of the planner in the form they travel in: the JSON of the planner's
// backup (core/jsonio.cpp, format 11), which is also the "data" of a record in
// the sync. normalize() reads one the way JsonIo reads it - the same defaults,
// the same records thrown away - and keeps every field it does not know, so
// that a record written by a newer planner goes back with all of them.

import {
  toSeconds, fromSeconds, isValidDate, dateOf, minuteOfDay, today, now, addDays, at,
  daysTo, toDayNumber, isoOfDay, DAY_SECONDS, nowSeconds, hhmm, shiftDays,
} from './dates.js';
import { normalizeRule, occurrences, isActive, matches, nextOccurrence } from './recurrence.js';
import {
  normalizedReminders, remindersWithRecordAlarm, anyReminderRingsAlarm, reminderOffset,
  dayReminderDays, dayReminderMinute,
} from './reminders.js';
import { friendlyDate, dayMonth } from './text.js';

export const Kind = {
  calendar: 'calendar',
  event: 'event',
  task: 'task',
  completion: 'completion',
  melody: 'melody',
  alarmStop: 'alarmstop',
  habit: 'habit',
  habitMark: 'habitmark',
  reminder: 'reminder',
};

export const KINDS = Object.values(Kind);

export const DEFAULT_CALENDAR_ID = 'default';
export const DEFAULT_COLOR = '#4f6bed';

/** The colours the pickers offer, types.cpp paletteColors(). */
export const PALETTE_COLORS = ['#4f6bed', '#0f9d58', '#e8710a', '#d93025', '#8e24aa', '#00897b',
  '#3949ab', '#c2185b', '#546e7a', '#f4b400', '#7cb342', '#00acc1'];

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // Older browsers on plain http: still a version 4 UUID, as QUuid makes.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A moment as the planner writes it, or null. */
export function moment(value) {
  const seconds = toSeconds(value);
  return Number.isNaN(seconds) ? null : fromSeconds(seconds);
}

function day(value) {
  return isValidDate(value) ? String(value).slice(0, 10) : null;
}

function str(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function int(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function bool(value, fallback = false) {
  return typeof value === 'boolean' ? value : value == null ? fallback : !!value;
}

function remindersOf(raw) {
  const list = Array.isArray(raw.reminders)
    ? raw.reminders.map((v) => int(v, -1))
    : [int(raw.reminderMinutes, -1)];
  return remindersWithRecordAlarm(normalizedReminders(list), bool(raw.alarm));
}

function alarmFields(raw) {
  return {
    alarmMelody: str(raw.alarmMelody),
    alarmVibration: int(raw.alarmVibration, -1),
    snoozeMinutes: int(raw.snoozeMinutes, 0),
    snoozeLimit: int(raw.snoozeLimit, 3),
  };
}

const SHARE_MODES = ['read', 'edit', 'custom'];

/**
 * One record read as the planner reads it; null for a record the planner
 * would throw away (an event without a start, a mark without a day...).
 * @p id, when given, wins over the id inside the data, as in the sync.
 */
export function normalize(kind, data, id) {
  const raw = data && typeof data === 'object' ? data : {};
  const out = { ...raw };
  out.id = str(id ?? raw.id) || newId();
  switch (kind) {
    case Kind.calendar:
      out.name = str(raw.name);
      out.color = str(raw.color);
      out.visible = bool(raw.visible, true);
      out.starred = bool(raw.starred);
      out.sortOrder = int(raw.sortOrder, 0);
      out.source = str(raw.source);
      out.shared = bool(raw.shared);
      out.shareMode = SHARE_MODES.includes(raw.shareMode) ? raw.shareMode : 'custom';
      out.ownerLogin = str(raw.ownerLogin);
      out.originId = str(raw.originId);
      out.access = raw.access === 'edit' ? 'edit' : 'read';
      return out;
    case Kind.event: {
      out.title = str(raw.title);
      out.description = str(raw.description);
      out.location = str(raw.location);
      out.calendarId = str(raw.calendarId);
      out.start = moment(raw.start);
      out.end = moment(raw.end);
      out.allDay = bool(raw.allDay);
      out.color = str(raw.color);
      out.reminders = remindersOf(raw);
      out.alarm = anyReminderRingsAlarm(out.reminders);
      Object.assign(out, alarmFields(raw));
      out.cancelled = bool(raw.cancelled);
      out.recurrence = normalizeRule(raw.recurrence);
      out.createdAt = moment(raw.createdAt);
      out.updatedAt = moment(raw.updatedAt);
      return out.start ? out : null;
    }
    case Kind.task: {
      out.title = str(raw.title);
      out.notes = str(raw.notes);
      out.calendarId = str(raw.calendarId);
      out.dueAt = moment(raw.dueAt);
      out.hasDueTime = bool(raw.hasDueTime);
      out.done = 'done' in raw ? bool(raw.done) : int(raw.status, 0) === 2;
      out.failed = !out.done && bool(raw.failed);
      out.completedAt = moment(raw.completedAt);
      out.doneWithSubtasks = bool(raw.doneWithSubtasks);
      out.reminders = remindersOf(raw);
      out.alarm = anyReminderRingsAlarm(out.reminders);
      Object.assign(out, alarmFields(raw));
      out.sortOrder = int(raw.sortOrder, 0);
      out.recurrence = normalizeRule(raw.recurrence);
      out.createdAt = moment(raw.createdAt);
      out.updatedAt = moment(raw.updatedAt);
      out.subtasks = (Array.isArray(raw.subtasks) ? raw.subtasks : []).map((sub) => ({
        ...(sub && typeof sub === 'object' ? sub : {}),
        id: str(sub?.id) || newId(),
        title: str(sub?.title),
        done: bool(sub?.done),
        sortOrder: int(sub?.sortOrder, 0),
      }));
      return out;
    }
    case Kind.completion:
      out.taskId = str(raw.taskId);
      out.taskTitle = str(raw.taskTitle);
      out.calendarId = str(raw.calendarId);
      out.completedAt = moment(raw.completedAt);
      out.failed = bool(raw.failed);
      return out.completedAt ? out : null;
    case Kind.habit: {
      out.title = str(raw.title);
      out.color = str(raw.color);
      out.startedAt = day(raw.startedAt);
      out.archivedAt = day(raw.archivedAt);
      out.pauses = (Array.isArray(raw.pauses) ? raw.pauses : [])
        .filter((pair) => Array.isArray(pair) && day(pair[0]))
        .map((pair) => [day(pair[0]), day(pair[1])]);
      out.sortOrder = int(raw.sortOrder, 0);
      out.createdAt = moment(raw.createdAt);
      out.updatedAt = moment(raw.updatedAt);
      if (!out.startedAt) out.startedAt = out.createdAt ? dateOf(out.createdAt) : today();
      return out;
    }
    case Kind.habitMark:
      out.habitId = str(raw.habitId);
      out.day = day(raw.day);
      out.markedAt = moment(raw.markedAt);
      return out.habitId && out.day ? out : null;
    case Kind.reminder:
      out.title = str(raw.title);
      out.notes = str(raw.notes);
      out.at = moment(raw.at);
      out.alarm = bool(raw.alarm);
      out.enabled = bool(raw.enabled, true);
      Object.assign(out, alarmFields(raw));
      out.recurrence = normalizeRule(raw.recurrence);
      out.createdAt = moment(raw.createdAt);
      out.updatedAt = moment(raw.updatedAt);
      return out.at ? out : null;
    case Kind.alarmStop:
      out.itemId = str(raw.itemId);
      out.fireAt = moment(raw.fireAt);
      out.stoppedAt = moment(raw.stoppedAt);
      return out.fireAt ? out : null;
    case Kind.melody:
      out.title = str(raw.title);
      out.format = str(raw.format);
      out.durationMs = int(raw.durationMs, 0);
      out.data = str(raw.data);
      out.createdAt = moment(raw.createdAt);
      return out.data ? out : null;
    default:
      return null;
  }
}

/** The JSON a record goes out as: what normalize() keeps, derived fields recomputed. */
export function toData(kind, record) {
  const data = structuredClone(record);
  if (kind === Kind.event || kind === Kind.task) {
    data.reminders = normalizedReminders(data.reminders);
    data.alarm = anyReminderRingsAlarm(data.reminders);
  }
  if (kind === Kind.task) data.failed = !data.done && !!data.failed;
  return data;
}

// ---------------------------------------------------------------- calendars

export function isForeign(calendar) {
  return !!calendar && !!calendar.ownerLogin;
}

/** A record may be put into it here: an own calendar always, a twin with the right to edit. */
export function isWritable(calendar) {
  return !calendar || !isForeign(calendar) || calendar.access === 'edit';
}

export function calendarColor(calendar) {
  return /^#[0-9a-f]{6}$/i.test(calendar?.color || '') ? calendar.color : DEFAULT_COLOR;
}

// ------------------------------------------------------------------- events

/** How many calendar days one occurrence covers, at least one. */
export function spanDays(event) {
  const start = toSeconds(event.start);
  if (Number.isNaN(start)) return 1;
  let last = toSeconds(event.end);
  if (Number.isNaN(last)) return 1;
  // An event ending exactly at midnight belongs to the day before.
  if (last % DAY_SECONDS === 0 && last > start) last -= 1;
  return Math.max(1, Math.floor(last / DAY_SECONDS) - Math.floor(start / DAY_SECONDS) + 1);
}

export function durationMinutes(event) {
  const s = toSeconds(event.start), e = toSeconds(event.end);
  return Number.isNaN(s) || Number.isNaN(e) ? 0 : Math.round((e - s) / 60);
}

/**
 * The occurrences of one event that reach into [from, to]: {event, start, end,
 * seedDate}. An event that started earlier can still reach into the window, so
 * the search starts its length before it.
 */
export function eventOccurrences(event, from, to) {
  if (!event.start) return [];
  const span = spanDays(event);
  const seed = dateOf(event.start);
  const dates = occurrences(event.recurrence, seed, addDays(from, -(span - 1)), to);
  const startSec = toSeconds(event.start);
  const endSec = event.end ? toSeconds(event.end) : startSec + 3600;
  return dates.map((date) => {
    const shift = daysTo(seed, date) * DAY_SECONDS;
    return { event, seedDate: date, start: fromSeconds(startSec + shift), end: fromSeconds(endSec + shift) };
  });
}

/** Whether an occurrence covers @p date at all. */
export function coversDate(occurrence, date) {
  const start = toSeconds(occurrence.start);
  let last = toSeconds(occurrence.end || occurrence.start);
  if (last % DAY_SECONDS === 0 && last > start) last -= 1;
  const n = toDayNumber(date);
  return n >= Math.floor(start / DAY_SECONDS) && n <= Math.floor(last / DAY_SECONDS);
}

/** "09:30 – 11:00", "Весь день", "Весь день, 3 дн.". */
export function timeRangeText(event) {
  if (event.allDay) {
    const span = spanDays(event);
    return span > 1 ? `Весь день, ${span} дн.` : 'Весь день';
  }
  if (!event.start) return '';
  const from = hhmm(event.start);
  if (!event.end || event.end <= event.start) return from;
  if (dateOf(event.start) === dateOf(event.end)) return `${from} – ${hhmm(event.end)}`;
  return `${from} – ${dayMonth(dateOf(event.end))}, ${hhmm(event.end)}`;
}

// -------------------------------------------------------------------- tasks

export function isClosed(task) {
  return !!(task.done || task.failed);
}

export function isFailed(task) {
  return !!task.failed && !task.done;
}

export function isOverdue(task) {
  if (isClosed(task) || !task.dueAt) return false;
  if (task.hasDueTime) return toSeconds(task.dueAt) < nowSeconds();
  return dateOf(task.dueAt) < today();
}

export function isDueToday(task) {
  return !isClosed(task) && !!task.dueAt && dateOf(task.dueAt) === today();
}

export function subtasksDone(task) {
  return task.subtasks.filter((s) => s.done).length;
}

export function allSubtasksDone(task) {
  return task.subtasks.length > 0 && subtasksDone(task) === task.subtasks.length;
}

/** "Сегодня, 18:00", "Просрочено · вчера", "Без срока". */
export function dueText(task) {
  if (!task.dueAt) return 'Без срока';
  let text = friendlyDate(dateOf(task.dueAt));
  if (task.hasDueTime) text += `, ${hhmm(task.dueAt)}`;
  if (isOverdue(task)) text = `Просрочено · ${text}`;
  return text;
}

/** The moment @p reminder of a task fires, null without a due date. */
export function taskReminderAt(task, reminder) {
  const offset = reminderOffset(reminder);
  if (offset < 0 || !task.dueAt) return null;
  if (!task.hasDueTime) {
    return at(addDays(dateOf(task.dueAt), -dayReminderDays(offset)), dayReminderMinute(offset));
  }
  return fromSeconds(toSeconds(task.dueAt) - 60 * offset);
}

/** The moment @p reminder of an event occurrence fires. */
export function eventReminderAt(event, occurrenceStart, reminder) {
  const offset = reminderOffset(reminder);
  if (offset < 0) return null;
  if (event.allDay) {
    return at(addDays(dateOf(occurrenceStart), -dayReminderDays(offset)), dayReminderMinute(offset));
  }
  return fromSeconds(toSeconds(occurrenceStart) - 60 * offset);
}

// --------------------------------------------------------- own reminders

/** Moments in [from, to] (naive seconds) the reminder goes off, earliest first. */
export function reminderFirings(reminder, fromSec, toSec) {
  const result = [];
  const atSec = toSeconds(reminder.at);
  if (Number.isNaN(atSec) || toSec < fromSec) return result;
  if (!isActive(reminder.recurrence)) {
    if (atSec >= fromSec && atSec <= toSec) result.push(reminder.at);
    return result;
  }
  const minute = minuteOfDay(reminder.at);
  const dates = occurrences(reminder.recurrence, dateOf(reminder.at),
    isoOfDay(Math.floor(fromSec / DAY_SECONDS)), isoOfDay(Math.floor(toSec / DAY_SECONDS)));
  for (const date of dates) {
    const moment = at(date, minute);
    const sec = toSeconds(moment);
    if (sec >= fromSec && sec <= toSec) result.push(moment);
  }
  return result;
}

/** The first moment at or after now, null when there is none ahead. */
export function reminderNextFiring(reminder, nowText = now()) {
  if (!reminder.at) return null;
  if (reminder.at >= nowText) return reminder.at;
  if (!isActive(reminder.recurrence)) return null;
  const seed = dateOf(reminder.at);
  const todayDate = dateOf(nowText);
  const todayMoment = at(todayDate, minuteOfDay(reminder.at));
  if (todayMoment >= nowText && matches(reminder.recurrence, seed, todayDate)) return todayMoment;
  const next = nextOccurrence(reminder.recurrence, seed, todayDate);
  return next ? at(next, minuteOfDay(reminder.at)) : null;
}

// ------------------------------------------------------------------- habits

export const HABIT_CHART_DAYS = 30;

export function habitExistedOn(habit, date) {
  if (!date || !habit.startedAt || date < habit.startedAt) return false;
  if (habit.archivedAt && date >= habit.archivedAt) return false;
  for (const [from, to] of habit.pauses) {
    if (date >= from && (!to || date < to)) return false;
  }
  return true;
}

/** The id a mark of @p habitId on @p date has on every device. */
export function habitMarkKey(habitId, date) {
  return habitId && date ? `${habitId}@${date}` : '';
}

export const HabitDay = { Absent: 'absent', Done: 'done', Missed: 'missed', Pending: 'pending' };

// ---------------------------------------------------------------- copying

/** A copy of an event moved to @p date, without a rule: the days were named one by one. */
export function eventCopyOn(event, occurrenceStart, date) {
  const shift = daysTo(dateOf(occurrenceStart), date);
  const length = toSeconds(event.end) - toSeconds(event.start);
  const start = shiftDays(occurrenceStart, shift);
  const copy = structuredClone(event);
  copy.id = '';
  copy.start = start;
  copy.end = fromSeconds(toSeconds(start) + (Number.isNaN(length) ? 3600 : length));
  copy.recurrence = normalizeRule(null);
  copy.createdAt = null;
  copy.updatedAt = null;
  return copy;
}
