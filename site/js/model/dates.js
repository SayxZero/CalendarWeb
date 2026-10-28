// Dates and moments the way the planner keeps them: ISO 8601 in local time
// without a zone ("2026-10-28" and "2026-10-28T09:30:00"), see DesDoc.md of the
// planner, "Локальное время". Arithmetic goes through plain numbers - days and
// seconds counted from 1970-01-01 as if every day had 24 hours - so that a
// daylight saving switch never moves an event by an hour, exactly as the
// planner's QDateTime in local time does not.

const DAY_SECONDS = 86400;

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

/** Days since 1970-01-01 of a valid y/m/d; m is 1..12. */
export function dayNumber(y, m, d) {
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** "YYYY-MM-DD" of a day number. */
export function isoOfDay(n) {
  const date = new Date(n * 86400000);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** {y, m, d} of "YYYY-MM-DD", or null when it is not a real day. */
export function parts(iso) {
  if (typeof iso !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const y = +match[1], m = +match[2], d = +match[3];
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export function isValidDate(iso) {
  return parts(iso) !== null;
}

/** "YYYY-MM-DD" of y/m/d, or null when there is no such day. */
export function makeDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function toDayNumber(iso) {
  const p = parts(iso);
  return p ? dayNumber(p.y, p.m, p.d) : NaN;
}

export function addDays(iso, n) {
  return isoOfDay(toDayNumber(iso) + n);
}

/** Days from @p a to @p b, negative when b is earlier. */
export function daysTo(a, b) {
  return toDayNumber(b) - toDayNumber(a);
}

/** 1 = Monday ... 7 = Sunday, as Qt's dayOfWeek(). */
export function dayOfWeek(iso) {
  const n = toDayNumber(iso);
  // 1970-01-01 was a Thursday.
  return ((n + 3) % 7 + 7) % 7 + 1;
}

/** Qt's addMonths(): the day is clamped to the length of the month it lands in. */
export function addMonths(iso, months) {
  const p = parts(iso);
  const total = p.y * 12 + (p.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  return makeDate(y, m, Math.min(p.d, daysInMonth(y, m)));
}

export function addYears(iso, years) {
  const p = parts(iso);
  return makeDate(p.y + years, p.m, Math.min(p.d, daysInMonth(p.y + years, p.m)));
}

export function startOfMonth(iso) {
  const p = parts(iso);
  return makeDate(p.y, p.m, 1);
}

/** The first day of the week holding @p iso; @p firstDay is 1 (Monday) .. 7. */
export function startOfWeek(iso, firstDay = 1) {
  const shift = (dayOfWeek(iso) - firstDay + 7) % 7;
  return addDays(iso, -shift);
}

/** ISO 8601 week number. */
export function isoWeek(iso) {
  const thursday = addDays(iso, 4 - dayOfWeek(iso));
  const p = parts(thursday);
  const first = makeDate(p.y, 1, 1);
  return Math.floor(daysTo(first, thursday) / 7) + 1;
}

// ------------------------------------------------------------------ moments

/** Seconds since 1970-01-01T00:00:00 of a naive local moment, NaN when unreadable. */
export function toSeconds(text) {
  if (typeof text !== 'string' || !text) return NaN;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(text.trim());
  if (!match) return NaN;
  const day = toDayNumber(match[1]);
  if (Number.isNaN(day)) return NaN;
  const h = +(match[2] || 0), mi = +(match[3] || 0), s = +(match[4] || 0);
  if (h > 23 || mi > 59 || s > 59) return NaN;
  let seconds = day * DAY_SECONDS + h * 3600 + mi * 60 + s;
  if (match[5]) {
    // A moment with a zone (written by somebody else): as the clock here reads it.
    const utc = match[5] === 'Z' ? seconds : seconds - zoneSeconds(match[5]);
    seconds = localSecondsOf(new Date(utc * 1000));
  }
  return seconds;
}

function zoneSeconds(text) {
  const sign = text[0] === '-' ? -1 : 1;
  const digits = text.slice(1).replace(':', '');
  return sign * (+digits.slice(0, 2) * 3600 + +digits.slice(2, 4) * 60);
}

/** "YYYY-MM-DDTHH:MM:SS" of naive seconds. */
export function fromSeconds(seconds) {
  const day = Math.floor(seconds / DAY_SECONDS);
  let rest = seconds - day * DAY_SECONDS;
  const h = Math.floor(rest / 3600);
  rest -= h * 3600;
  const m = Math.floor(rest / 60);
  const s = Math.floor(rest - m * 60);
  return `${isoOfDay(day)}T${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function isValidMoment(text) {
  return !Number.isNaN(toSeconds(text));
}

/** The date part of a moment. */
export function dateOf(text) {
  const seconds = toSeconds(text);
  return Number.isNaN(seconds) ? null : isoOfDay(Math.floor(seconds / DAY_SECONDS));
}

/** Minutes since midnight of a moment. */
export function minuteOfDay(text) {
  const seconds = toSeconds(text);
  if (Number.isNaN(seconds)) return 0;
  return Math.floor((seconds - Math.floor(seconds / DAY_SECONDS) * DAY_SECONDS) / 60);
}

/** A moment from a date and minutes since its midnight. */
export function at(date, minutes = 0) {
  return fromSeconds(toDayNumber(date) * DAY_SECONDS + Math.round(minutes) * 60);
}

export function addSeconds(text, seconds) {
  return fromSeconds(toSeconds(text) + seconds);
}

export function addMinutes(text, minutes) {
  return addSeconds(text, minutes * 60);
}

/** Shifts the date of a moment, the time of day stays. */
export function shiftDays(text, days) {
  return addSeconds(text, days * DAY_SECONDS);
}

export function secondsBetween(a, b) {
  return toSeconds(b) - toSeconds(a);
}

/** "HH:MM" of a moment. */
export function hhmm(text) {
  const minutes = minuteOfDay(text);
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** "HH:MM" of minutes since midnight. */
export function minutesText(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Minutes since midnight of "HH:MM", or NaN. */
export function parseTime(text) {
  const match = /^(\d{1,2}):(\d{2})/.exec(text || '');
  if (!match || +match[1] > 23 || +match[2] > 59) return NaN;
  return +match[1] * 60 + +match[2];
}

function localSecondsOf(date) {
  return dayNumber(date.getFullYear(), date.getMonth() + 1, date.getDate()) * DAY_SECONDS
    + date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

// The clock. Tests replace it to stand on a known day.
let clock = () => new Date();

export function setClock(fn) {
  clock = fn || (() => new Date());
}

export function nowSeconds() {
  return localSecondsOf(clock());
}

/** "YYYY-MM-DDTHH:MM:SS" of now, local time. */
export function now() {
  return fromSeconds(nowSeconds());
}

export function today() {
  return isoOfDay(Math.floor(nowSeconds() / DAY_SECONDS));
}

/** Milliseconds since the epoch: the sync's "modified". */
export function nowMs() {
  return clock().getTime();
}

/** The real Date of a naive moment, for timers. */
export function toDate(text) {
  const p = parts(text);
  const minutes = minuteOfDay(text);
  const seconds = toSeconds(text) % 60;
  return new Date(p.y, p.m - 1, p.d, Math.floor(minutes / 60), minutes % 60, seconds);
}

export { DAY_SECONDS };
