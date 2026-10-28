// The repetition rule, a port of the planner's model/recurrence.cpp. The rule
// keeps no start date of its own: the seed is the date of the record that owns
// it (Event.start, Task.dueAt), so moving the record moves the whole series.

import {
  parts, makeDate, daysInMonth, toDayNumber, isoOfDay, addDays, addMonths, addYears,
  dayOfWeek, daysTo, isValidDate,
} from './dates.js';
import { pluralRu, WEEKDAYS_SHORT, dayMonth } from './text.js';

export const Freq = { None: 0, Daily: 1, Weekly: 2, Monthly: 3, Yearly: 4 };
export const MonthlyMode = { DayOfMonth: 0, WeekdayOfMonth: 1 };
export const End = { Never: 0, AfterCount: 1, OnDate: 2 };

const GUARD_LIMIT = 200000;

/** The rule as JsonIo writes it, every field present. */
export function emptyRule() {
  return { freq: 0, interval: 1, weekdays: 0, monthlyMode: 0, endMode: 0, count: 10, until: null, exceptions: [] };
}

/** A rule read the way JsonIo::recurrenceFromJson() reads it, unknown fields kept. */
export function normalizeRule(raw) {
  const rule = { ...emptyRule(), ...(raw && typeof raw === 'object' ? raw : {}) };
  rule.freq = clampInt(rule.freq, 0, 4, 0);
  rule.interval = Math.max(1, toInt(rule.interval, 1));
  rule.weekdays = toInt(rule.weekdays, 0) & 0x7f;
  rule.monthlyMode = toInt(rule.monthlyMode, 0) === 1 ? 1 : 0;
  rule.endMode = clampInt(rule.endMode, 0, 2, 0);
  rule.count = Math.max(1, toInt(rule.count, 10));
  rule.until = isValidDate(rule.until) ? rule.until.slice(0, 10) : null;
  rule.exceptions = Array.isArray(rule.exceptions)
    ? rule.exceptions.filter(isValidDate).map((d) => d.slice(0, 10))
    : [];
  return rule;
}

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clampInt(value, lo, hi, fallback) {
  const n = toInt(value, fallback);
  return n < lo || n > hi ? fallback : n;
}

export function isActive(rule) {
  return !!rule && rule.freq !== Freq.None;
}

export function weekdayBit(dow) {
  return 1 << (dow - 1);
}

/** Date of the @p nth @p dow (1..7) of a month; a position past the last falls back to the last. */
export function nthWeekdayOfMonth(y, m, dow, nth) {
  const first = makeDate(y, m, 1);
  if (!first) return null;
  const shift = (dow - dayOfWeek(first) + 7) % 7;
  let candidate = addDays(first, shift + 7 * (nth - 1));
  if (parts(candidate).m === m && parts(candidate).y === y) return candidate;
  candidate = addDays(first, shift);
  while (parts(addDays(candidate, 7)).m === m) candidate = addDays(candidate, 7);
  return candidate;
}

function monthsBetween(from, to) {
  const a = parts(from), b = parts(to);
  return (b.y - a.y) * 12 + (b.m - a.m);
}

/**
 * Every occurrence date in [from, to], ascending, at most @p limit of them.
 * The count of an AfterCount rule follows RFC 5545: exceptions take dates out
 * of the result without moving the counter.
 */
export function occurrences(rule, seed, from, to, limit = 4000) {
  const result = [];
  if (!isValidDate(seed) || !isValidDate(from) || !isValidDate(to) || from > to || limit <= 0) return result;
  if (!isActive(rule)) {
    if (seed >= from && seed <= to) result.push(seed);
    return result;
  }

  const step = Math.max(1, rule.interval);
  const maxCount = Math.max(1, rule.count);
  const exceptions = new Set(rule.exceptions);
  let emitted = 0;
  let stopped = false;

  const consider = (date) => {
    if (!date || date < seed) return true;
    if (rule.endMode === End.AfterCount && emitted >= maxCount) return false;
    if (rule.endMode === End.OnDate && rule.until && date > rule.until) return false;
    if (date > to) return false;
    ++emitted;
    if (date >= from && !exceptions.has(date)) result.push(date);
    return result.length < limit;
  };

  // Skipping ahead is only safe when occurrences do not have to be counted.
  let n = 0;
  if (rule.endMode !== End.AfterCount && from > seed) {
    switch (rule.freq) {
      case Freq.Daily: n = Math.floor(daysTo(seed, from) / step); break;
      case Freq.Weekly: n = Math.floor(daysTo(seed, from) / (7 * step)); break;
      case Freq.Monthly: n = Math.floor(monthsBetween(seed, from) / step); break;
      case Freq.Yearly: n = Math.floor((parts(from).y - parts(seed).y) / step); break;
      default: break;
    }
    n = Math.max(0, n - 1);
  }

  let guard = 0;
  const seedParts = parts(seed);
  switch (rule.freq) {
    case Freq.Daily: {
      const base = toDayNumber(seed);
      for (; !stopped && guard++ < GUARD_LIMIT; ++n) {
        if (!consider(isoOfDay(base + step * n))) stopped = true;
      }
      break;
    }
    case Freq.Weekly: {
      const mask = rule.weekdays || weekdayBit(dayOfWeek(seed));
      const weekStart = toDayNumber(seed) - (dayOfWeek(seed) - 1);
      for (; !stopped && guard++ < GUARD_LIMIT; ++n) {
        const blockStart = weekStart + 7 * step * n;
        for (let wd = 0; wd < 7; ++wd) {
          if (!(mask & (1 << wd))) continue;
          if (!consider(isoOfDay(blockStart + wd))) {
            stopped = true;
            break;
          }
        }
      }
      break;
    }
    case Freq.Monthly: {
      const monthStart = makeDate(seedParts.y, seedParts.m, 1);
      const nth = Math.floor((seedParts.d - 1) / 7) + 1;
      const dow = dayOfWeek(seed);
      for (; !stopped && guard++ < GUARD_LIMIT; ++n) {
        const base = parts(addMonths(monthStart, step * n));
        if (base.y > 9999) break;
        const date = rule.monthlyMode === MonthlyMode.DayOfMonth
          ? makeDate(base.y, base.m, Math.min(seedParts.d, daysInMonth(base.y, base.m)))
          : nthWeekdayOfMonth(base.y, base.m, dow, nth);
        if (!consider(date)) stopped = true;
      }
      break;
    }
    case Freq.Yearly: {
      for (; !stopped && guard++ < GUARD_LIMIT; ++n) {
        const year = seedParts.y + step * n;
        if (year > 9999) break;
        const date = makeDate(year, seedParts.m, Math.min(seedParts.d, daysInMonth(year, seedParts.m)));
        if (!consider(date)) stopped = true;
      }
      break;
    }
    default:
      break;
  }
  return result;
}

/** The first occurrence strictly after @p after, null when the rule has ended. */
export function nextOccurrence(rule, seed, after) {
  if (!isValidDate(seed) || !isValidDate(after)) return null;
  if (!isActive(rule)) return seed > after ? seed : null;
  let cursor = addDays(after, 1);
  for (let window = 0; window < 12; ++window) {
    const windowEnd = addYears(cursor, 1);
    const found = occurrences(rule, seed, cursor, windowEnd, 1);
    if (found.length) return found[0];
    if (rule.endMode === End.OnDate && rule.until && windowEnd > rule.until) break;
    cursor = addDays(windowEnd, 1);
  }
  return null;
}

export function matches(rule, seed, date) {
  return occurrences(rule, seed, date, date, 1).length > 0;
}

/** "пн, ср, пт" of a weekday mask. */
export function weekdaysText(mask) {
  const names = [];
  for (let wd = 1; wd <= 7; ++wd) {
    if (mask & weekdayBit(wd)) names.push(WEEKDAYS_SHORT[wd - 1]);
  }
  return names.join(', ');
}

/** "Каждые 2 недели: пн, чт · 5 раз", as Recurrence::describe(). */
export function describe(rule) {
  if (!isActive(rule)) return 'Не повторяется';
  const step = Math.max(1, rule.interval);
  let base = '';
  switch (rule.freq) {
    case Freq.Daily:
      base = step === 1 ? 'Каждый день' : `Каждые ${step} ${pluralRu(step, 'день', 'дня', 'дней')}`;
      break;
    case Freq.Weekly:
      base = step === 1 ? 'Каждую неделю' : `Каждые ${step} ${pluralRu(step, 'неделю', 'недели', 'недель')}`;
      if (rule.weekdays) base += `: ${weekdaysText(rule.weekdays)}`;
      break;
    case Freq.Monthly:
      base = step === 1 ? 'Каждый месяц' : `Каждые ${step} ${pluralRu(step, 'месяц', 'месяца', 'месяцев')}`;
      base += rule.monthlyMode === MonthlyMode.DayOfMonth ? ', по числу' : ', по дню недели';
      break;
    case Freq.Yearly:
      base = step === 1 ? 'Каждый год' : `Каждые ${step} ${pluralRu(step, 'год', 'года', 'лет')}`;
      break;
    default:
      break;
  }
  if (rule.endMode === End.AfterCount) {
    base += ` · ${rule.count} ${pluralRu(rule.count, 'раз', 'раза', 'раз')}`;
  } else if (rule.endMode === End.OnDate && rule.until) {
    base += ` · до ${dayMonth(rule.until, true)}`;
  }
  return base;
}
