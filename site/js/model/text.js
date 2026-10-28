// Russian words for dates and numbers, as the planner spells them (types.cpp).

import { parts, dayOfWeek, daysTo, today, hhmm, dateOf } from './dates.js';

export const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль',
  'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
  'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WEEKDAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
export const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

export function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** pluralRu(2, 'минута', 'минуты', 'минут') -> 'минуты'. */
export function pluralRu(n, one, few, many) {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** "5 мая", "5 мая 2027". */
export function dayMonth(iso, withYear = false) {
  const p = parts(iso);
  if (!p) return '';
  return `${p.d} ${MONTHS_GENITIVE[p.m - 1]}${withYear ? ' ' + p.y : ''}`;
}

/** "Сегодня", "Завтра", "Вчера", "5 мая, вторник", "5 мая" or "5 мая 2027". */
export function friendlyDate(iso) {
  const p = parts(iso);
  if (!p) return 'Без даты';
  const delta = daysTo(today(), iso);
  if (delta === 0) return 'Сегодня';
  if (delta === 1) return 'Завтра';
  if (delta === -1) return 'Вчера';
  if (delta > 1 && delta < 7) return `${dayMonth(iso)}, ${WEEKDAYS[dayOfWeek(iso) - 1]}`;
  return dayMonth(iso, p.y !== parts(today()).y);
}

/** "5 мая 2026, вторник". */
export function longDate(iso) {
  if (!parts(iso)) return '';
  return `${dayMonth(iso, true)}, ${WEEKDAYS[dayOfWeek(iso) - 1]}`;
}

/** "Май 2026". */
export function monthTitle(iso) {
  const p = parts(iso);
  return `${capitalize(MONTHS[p.m - 1])} ${p.y}`;
}

/** "1 ч 30 мин". */
export function formatDuration(minutes) {
  if (minutes <= 0) return '0 мин';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const out = [];
  if (days) out.push(`${days} ${pluralRu(days, 'день', 'дня', 'дней')}`);
  if (hours) out.push(`${hours} ч`);
  if (mins) out.push(`${mins} мин`);
  return out.join(' ');
}

/** "1 час 30 минут", "2 недели". */
export function formatOffset(minutes) {
  if (minutes <= 0) return '0 минут';
  const week = 7 * 1440;
  if (minutes % week === 0) {
    const weeks = minutes / week;
    return `${weeks} ${pluralRu(weeks, 'неделя', 'недели', 'недель')}`;
  }
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const out = [];
  if (days) out.push(`${days} ${pluralRu(days, 'день', 'дня', 'дней')}`);
  if (hours) out.push(`${hours} ${pluralRu(hours, 'час', 'часа', 'часов')}`);
  if (mins) out.push(`${mins} ${pluralRu(mins, 'минута', 'минуты', 'минут')}`);
  return out.join(' ');
}

/** "5 мая, 18:00" of a moment, the date said the friendly way. */
export function friendlyMoment(text) {
  return `${friendlyDate(dateOf(text))}, ${hhmm(text)}`;
}

/** Case-insensitive "contains", the planner's search. */
export function containsText(haystack, needle) {
  return (haystack || '').toLocaleLowerCase('ru').includes(needle.toLocaleLowerCase('ru'));
}

/** Compares two strings as people expect them sorted. */
export const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });
