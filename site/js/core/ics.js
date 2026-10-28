// iCalendar import and export, a port of the planner's core/icsio.cpp: one
// calendar is one file, X-WR-CALNAME names it, and an import fills the
// calendar of that name instead of piling up copies.

import { toSeconds, fromSeconds, dateOf, addDays, at, minuteOfDay, isValidDate, parts, makeDate } from '../model/dates.js';
import { Freq, MonthlyMode, End, isActive, weekdayBit, emptyRule } from '../model/recurrence.js';
import {
  normalizedReminders, reminderOffset, reminderRingsAlarm, reminderWithKind, anyReminderRingsAlarm,
  dayReminderToOffset, dayReminderFromOffset,
} from '../model/reminders.js';
import { calendarColor, PALETTE_COLORS, newId } from '../model/records.js';

const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function escapeText(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n').replace(/\n/g, '\\n');
}

function unescapeText(value) {
  let out = '';
  for (let i = 0; i < value.length; ++i) {
    const ch = value[i];
    if (ch === '\\' && i + 1 < value.length) {
      const next = value[++i];
      out += next === 'n' || next === 'N' ? '\n' : next;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Folds a content line at 75 octets (RFC 5545), never inside a UTF-8 sequence. */
function foldLine(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const decoder = new TextDecoder();
  const pieces = [];
  let consumed = 0;
  let first = true;
  while (consumed < bytes.length) {
    let take = Math.min(first ? 75 : 74, bytes.length - consumed);
    while (take > 1 && consumed + take < bytes.length && (bytes[consumed + take] & 0xc0) === 0x80) --take;
    pieces.push(decoder.decode(bytes.subarray(consumed, consumed + take)));
    consumed += take;
    first = false;
  }
  return pieces.join('\r\n ');
}

function compactDate(date) {
  return date.replace(/-/g, '');
}

function compactMoment(text) {
  return text.slice(0, 19).replace(/[-:]/g, '');
}

/** {moment, dateOnly} of "20261028", "20261028T093000" or "20261028T093000Z". */
function parseDateTime(raw) {
  let value = raw.trim();
  const utc = value.endsWith('Z');
  if (utc) value = value.slice(0, -1);
  if (/^\d{8}$/.test(value)) {
    const date = makeDate(+value.slice(0, 4), +value.slice(4, 6), +value.slice(6, 8));
    return { moment: date ? `${date}T00:00:00` : null, dateOnly: true };
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/.exec(value);
  if (!match) return { moment: null, dateOnly: false };
  const text = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}${utc ? 'Z' : ''}`;
  const seconds = toSeconds(text);
  return { moment: Number.isNaN(seconds) ? null : fromSeconds(seconds), dateOnly: false };
}

function buildRRule(rule, seed) {
  if (!isActive(rule)) return '';
  const out = [`FREQ=${['', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'][rule.freq]}`];
  if (rule.interval > 1) out.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === Freq.Weekly && rule.weekdays) {
    const days = WEEKDAY_CODES.filter((_, i) => rule.weekdays & weekdayBit(i + 1));
    if (days.length) out.push(`BYDAY=${days.join(',')}`);
  }
  if (rule.freq === Freq.Monthly && rule.monthlyMode === MonthlyMode.WeekdayOfMonth && isValidDate(seed)) {
    const p = parts(seed);
    const dow = (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7;
    out.push(`BYDAY=${Math.floor((p.d - 1) / 7) + 1}${WEEKDAY_CODES[dow]}`);
  }
  if (rule.endMode === End.AfterCount) out.push(`COUNT=${rule.count}`);
  else if (rule.endMode === End.OnDate && rule.until) out.push(`UNTIL=${compactDate(rule.until)}`);
  return out.join(';');
}

function parseRRule(value, seed) {
  const rule = emptyRule();
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toUpperCase();
    const val = part.slice(eq + 1).trim();
    if (key === 'FREQ') {
      rule.freq = { DAILY: Freq.Daily, WEEKLY: Freq.Weekly, MONTHLY: Freq.Monthly, YEARLY: Freq.Yearly }[val.toUpperCase()] ?? Freq.None;
    } else if (key === 'INTERVAL') {
      rule.interval = Math.max(1, parseInt(val, 10) || 1);
    } else if (key === 'COUNT') {
      rule.endMode = End.AfterCount;
      rule.count = Math.max(1, parseInt(val, 10) || 1);
    } else if (key === 'UNTIL') {
      const until = parseDateTime(val);
      if (until.moment) {
        rule.endMode = End.OnDate;
        rule.until = dateOf(until.moment);
      }
    } else if (key === 'BYDAY') {
      let positional = false;
      for (const day of val.split(',').filter(Boolean)) {
        const code = day.slice(-2).toUpperCase();
        if (day.length > 2) positional = true;
        const index = WEEKDAY_CODES.indexOf(code);
        if (index >= 0) rule.weekdays |= weekdayBit(index + 1);
      }
      if (positional) rule.monthlyMode = MonthlyMode.WeekdayOfMonth;
    }
  }
  if (rule.freq === Freq.Weekly && !rule.weekdays && isValidDate(seed)) {
    const p = parts(seed);
    rule.weekdays = weekdayBit(((new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7) + 1);
  }
  if (rule.freq === Freq.Monthly && rule.monthlyMode === MonthlyMode.WeekdayOfMonth) rule.weekdays = 0;
  return rule;
}

function appendAlarms(lines, reminders, title, dayMode) {
  for (const reminder of normalizedReminders(reminders)) {
    const packed = reminderOffset(reminder);
    const minutes = dayMode ? dayReminderToOffset(packed) : packed;
    lines.push('BEGIN:VALARM', reminderRingsAlarm(reminder) ? 'ACTION:AUDIO' : 'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(title)}`,
      minutes >= 0 ? `TRIGGER:-PT${minutes}M` : `TRIGGER:PT${-minutes}M`, 'END:VALARM');
  }
}

function readAlarms(triggers, sounds, dayMode) {
  return normalizedReminders(triggers.map((minutes, i) =>
    reminderWithKind(dayMode ? dayReminderFromOffset(minutes) : minutes, !!sounds[i])));
}

/** Minutes of "-PT15M", "-P1D", "PT8H": before the moment positive, after it negative. */
function parseTrigger(value) {
  const text = value.trim().toUpperCase();
  const before = text.includes('-');
  let minutes = 0;
  let number = 0;
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') number = number * 10 + (ch.charCodeAt(0) - 48);
    else if (ch === 'D') { minutes += number * 1440; number = 0; }
    else if (ch === 'H') { minutes += number * 60; number = 0; }
    else if (ch === 'M') { minutes += number; number = 0; }
    else if (ch === 'W') { minutes += number * 7 * 1440; number = 0; }
    else if (ch === 'S') number = 0;
  }
  return before ? minutes : -minutes;
}

function unfold(text) {
  const lines = [];
  for (let line of text.split(/\n/)) {
    line = line.replace(/\r+$/, '');
    if (lines.length && (line.startsWith(' ') || line.startsWith('\t'))) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  }
  return lines;
}

function splitLine(line) {
  const colon = line.indexOf(':');
  if (colon < 0) return { name: line.trim().toUpperCase(), params: {}, value: '' };
  const head = line.slice(0, colon).split(';').filter(Boolean);
  const params = {};
  for (const param of head.slice(1)) {
    const eq = param.indexOf('=');
    if (eq > 0) params[param.slice(0, eq).trim().toUpperCase()] = param.slice(eq + 1).trim();
  }
  return { name: (head[0] || '').trim().toUpperCase(), params, value: line.slice(colon + 1) };
}

/** The file of one calendar: its events and tasks. */
export function buildDocument(events, tasks, calendar, stamp = new Date()) {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Calendar Planner//Qt//RU', 'CALSCALE:GREGORIAN'];
  if (calendar?.name) lines.push(`X-WR-CALNAME:${escapeText(calendar.name)}`, `NAME:${escapeText(calendar.name)}`);
  if (calendar?.color) {
    const hex = calendarColor(calendar);
    lines.push(`COLOR:${hex}`, `X-APPLE-CALENDAR-COLOR:${hex}`);
  }
  for (const event of events) {
    if (!event.start) continue;
    lines.push('BEGIN:VEVENT', `UID:${event.id}`, `DTSTAMP:${dtstamp}`);
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(dateOf(event.start))}`);
      lines.push(`DTEND;VALUE=DATE:${compactDate(addDays(dateOf(event.end || event.start), 1))}`);
    } else {
      lines.push(`DTSTART:${compactMoment(event.start)}`);
      if (event.end) lines.push(`DTEND:${compactMoment(event.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    const rrule = buildRRule(event.recurrence, dateOf(event.start));
    if (rrule) {
      lines.push(`RRULE:${rrule}`);
      if (event.recurrence.exceptions.length) {
        const exdates = event.recurrence.exceptions.map((d) =>
          event.allDay ? compactDate(d) : compactMoment(at(d, minuteOfDay(event.start))));
        lines.push(`EXDATE${event.allDay ? ';VALUE=DATE' : ''}:${exdates.join(',')}`);
      }
    }
    if (event.cancelled) lines.push('STATUS:CANCELLED');
    appendAlarms(lines, event.reminders, event.title, event.allDay);
    lines.push('END:VEVENT');
  }
  for (const task of tasks) {
    lines.push('BEGIN:VTODO', `UID:${task.id}`, `DTSTAMP:${dtstamp}`, `SUMMARY:${escapeText(task.title)}`);
    if (task.dueAt) {
      lines.push(task.hasDueTime ? `DUE:${compactMoment(task.dueAt)}` : `DUE;VALUE=DATE:${compactDate(dateOf(task.dueAt))}`);
    }
    let notes = task.notes || '';
    if (task.subtasks.length) {
      const checklist = task.subtasks.map((s) => `${s.done ? '[x]' : '[ ]'} ${s.title}`).join('\n');
      notes += (notes ? '\n' : '') + checklist;
    }
    if (notes) lines.push(`DESCRIPTION:${escapeText(notes)}`);
    lines.push(task.done ? 'STATUS:COMPLETED' : task.failed ? 'STATUS:CANCELLED' : 'STATUS:NEEDS-ACTION');
    if (task.completedAt) lines.push(`COMPLETED:${compactMoment(task.completedAt)}`);
    const rrule = buildRRule(task.recurrence, task.dueAt ? dateOf(task.dueAt) : null);
    if (rrule) lines.push(`RRULE:${rrule}`);
    if (task.dueAt) appendAlarms(lines, task.reminders, task.title, !task.hasDueTime);
    lines.push('END:VTODO');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** A file name for the calendar's .ics: what a file system accepts. */
export function fileNameFor(calendar) {
  let safe = [...(calendar?.name || '').trim()].filter((ch) => ch >= ' ' && !'<>:"/\\|?*'.includes(ch)).join('').trim();
  safe = safe.replace(/^\.+/, '');
  return (safe || 'calendar') + '.ics';
}

/**
 * Reads a document into @p store: the calendar of its name (made when there is
 * none), then every event and task saved through the store, as the planner's
 * import does. Returns {calendarName, importedEvents, importedTasks, skipped, error}.
 */
export function importText(text, store, fallbackName = '') {
  const result = { calendarName: '', importedEvents: 0, importedTasks: 0, skipped: 0, error: '' };
  const lines = unfold(text.replace(/^\uFEFF/, ''));
  if (!lines.some((l) => l.trim())) {
    result.error = 'Файл пуст';
    return result;
  }
  if (!lines.some((l) => l.trim().toUpperCase() === 'BEGIN:VCALENDAR')) {
    result.error = 'Это не файл календаря (iCalendar)';
    return result;
  }

  let calendarName = '';
  let colorValue = '';
  let depth = 0;
  for (const raw of lines) {
    const line = splitLine(raw);
    if (line.name === 'BEGIN') {
      if (line.value.trim().toUpperCase() !== 'VCALENDAR') ++depth;
      continue;
    }
    if (line.name === 'END') {
      if (line.value.trim().toUpperCase() !== 'VCALENDAR') depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth) continue;
    if (line.name === 'X-WR-CALNAME' || (line.name === 'NAME' && !calendarName)) calendarName = unescapeText(line.value).trim();
    else if ((line.name === 'COLOR' || line.name === 'X-APPLE-CALENDAR-COLOR') && /^#[0-9a-f]{6}/i.test(line.value.trim())) {
      colorValue = line.value.trim().slice(0, 7).toLowerCase();
    }
  }
  if (!calendarName) calendarName = fallbackName.trim();
  if (!calendarName) calendarName = 'Импорт';

  let calendarId = store.calendars().find((c) => c.name.localeCompare(calendarName, 'ru', { sensitivity: 'accent' }) === 0
    || c.name.toLowerCase() === calendarName.toLowerCase())?.id;
  if (calendarId && !store.isCalendarWritable(calendarId)) {
    result.error = `Календарь «${calendarName}» открыт вам только для чтения`;
    return result;
  }
  if (!calendarId) {
    calendarId = store.saveCalendar({
      name: calendarName,
      color: colorValue || PALETTE_COLORS[store.calendars().length % PALETTE_COLORS.length],
      source: fallbackName,
    });
  }
  result.calendarName = calendarName;

  let section = null;
  let alarmOwner = null;
  let event = null;
  let task = null;
  let allDay = false;
  let triggers = [];
  let sounds = [];
  let trigger = 0;
  let audio = false;
  let rrule = '';
  let exdates = [];

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const line = splitLine(raw);
    if (line.name === 'BEGIN') {
      const kind = line.value.trim().toUpperCase();
      if (kind === 'VEVENT') {
        section = 'event';
        event = { title: '', description: '', location: '', start: null, end: null, cancelled: false };
        allDay = false; triggers = []; sounds = []; rrule = ''; exdates = [];
      } else if (kind === 'VTODO') {
        section = 'todo';
        task = { title: '', notes: '', dueAt: null, hasDueTime: false, done: false, failed: false, completedAt: null };
        triggers = []; sounds = []; rrule = '';
      } else if (kind === 'VALARM') {
        alarmOwner = section;
        section = section ? 'alarm' : null;
        trigger = 0; audio = false;
      }
      continue;
    }
    if (line.name === 'END') {
      const kind = line.value.trim().toUpperCase();
      if (kind === 'VALARM') {
        if (section === 'alarm') { triggers.push(trigger); sounds.push(audio); }
        section = alarmOwner;
      } else if (kind === 'VEVENT' && section === 'event') {
        if (event.start) {
          const record = { ...event, id: newId(), allDay, calendarId };
          record.reminders = readAlarms(triggers, sounds, allDay);
          record.alarm = anyReminderRingsAlarm(record.reminders);
          record.recurrence = rrule ? parseRRule(rrule, dateOf(event.start)) : emptyRule();
          for (const ex of exdates) {
            const parsed = parseDateTime(ex);
            if (parsed.moment) record.recurrence.exceptions.push(dateOf(parsed.moment));
          }
          if (!record.end) record.end = fromSeconds(toSeconds(record.start) + 3600);
          // DTEND of an all-day event is exclusive. The last day it covers
          // ends at 23:59, as the planner's editor writes it: at 00:00 that
          // day would count as the end of the day before (spanDays()).
          if (allDay && record.end > record.start) record.end = at(addDays(dateOf(record.end), -1), 23 * 60 + 59);
          store.saveEvent(record);
          ++result.importedEvents;
        } else {
          ++result.skipped;
        }
        section = null;
      } else if (kind === 'VTODO' && section === 'todo') {
        if (task.title || task.dueAt) {
          const record = { ...task, id: '', calendarId };
          record.reminders = task.dueAt ? readAlarms(triggers, sounds, !task.hasDueTime) : [];
          record.recurrence = rrule && task.dueAt ? parseRRule(rrule, dateOf(task.dueAt)) : emptyRule();
          store.saveTask(record);
          ++result.importedTasks;
        } else {
          ++result.skipped;
        }
        section = null;
      }
      continue;
    }
    if (!section) continue;
    const value = line.value;
    if (section === 'alarm') {
      if (line.name === 'TRIGGER') trigger = parseTrigger(value);
      else if (line.name === 'ACTION') audio = value.trim().toUpperCase() === 'AUDIO';
      continue;
    }
    if (section === 'event') {
      if (line.name === 'SUMMARY') event.title = unescapeText(value);
      else if (line.name === 'DESCRIPTION') event.description = unescapeText(value);
      else if (line.name === 'LOCATION') event.location = unescapeText(value);
      else if (line.name === 'DTSTART') {
        const parsed = parseDateTime(value);
        event.start = parsed.moment;
        allDay = parsed.dateOnly || (line.params.VALUE || '').toUpperCase() === 'DATE';
      } else if (line.name === 'DTEND') event.end = parseDateTime(value).moment;
      else if (line.name === 'RRULE') rrule = value;
      else if (line.name === 'EXDATE') exdates.push(...value.split(',').filter(Boolean));
      else if (line.name === 'STATUS') event.cancelled = value.trim().toUpperCase() === 'CANCELLED';
      continue;
    }
    if (line.name === 'SUMMARY') task.title = unescapeText(value);
    else if (line.name === 'DESCRIPTION') task.notes = unescapeText(value);
    else if (line.name === 'DUE') {
      const parsed = parseDateTime(value);
      task.dueAt = parsed.moment;
      task.hasDueTime = !parsed.dateOnly && (line.params.VALUE || '').toUpperCase() !== 'DATE';
    } else if (line.name === 'STATUS') {
      const status = value.trim().toUpperCase();
      task.done = status === 'COMPLETED';
      task.failed = status === 'CANCELLED';
    } else if (line.name === 'COMPLETED') task.completedAt = parseDateTime(value).moment;
    else if (line.name === 'RRULE') rrule = value;
  }
  return result;
}
