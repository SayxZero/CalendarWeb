import test from 'node:test';
import assert from 'node:assert/strict';

import { occurrences, nextOccurrence, matches, describe, normalizeRule, nthWeekdayOfMonth, weekdayBit, Freq, End, MonthlyMode } from '../site/js/model/recurrence.js';

const rule = (fields) => normalizeRule({ ...fields });

test('a rule without a frequency is the seed alone', () => {
  assert.deepEqual(occurrences(rule({}), '2026-05-05', '2026-05-01', '2026-05-31'), ['2026-05-05']);
  assert.deepEqual(occurrences(rule({}), '2026-05-05', '2026-06-01', '2026-06-30'), []);
});

test('daily every second day, skipping ahead into a late window', () => {
  const daily = rule({ freq: Freq.Daily, interval: 2 });
  assert.deepEqual(occurrences(daily, '2016-01-01', '2026-01-01', '2026-01-06'), ['2026-01-02', '2026-01-04', '2026-01-06']);
});

test('weekly on chosen weekdays, Monday is bit 0', () => {
  const weekly = rule({ freq: Freq.Weekly, weekdays: weekdayBit(1) | weekdayBit(4) });
  assert.deepEqual(occurrences(weekly, '2026-10-28', '2026-10-26', '2026-11-08'),
    ['2026-10-29', '2026-11-02', '2026-11-05']);
  // Without weekdays the rule repeats on the weekday of its seed.
  assert.deepEqual(occurrences(rule({ freq: Freq.Weekly }), '2026-10-28', '2026-10-28', '2026-11-11'),
    ['2026-10-28', '2026-11-04', '2026-11-11']);
});

test('monthly on the 31st clamps to the end of shorter months', () => {
  const monthly = rule({ freq: Freq.Monthly });
  assert.deepEqual(occurrences(monthly, '2026-01-31', '2026-01-01', '2026-04-30'),
    ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('monthly by weekday takes the last one when the fifth is missing', () => {
  // 2026-10-29 is the fifth Thursday of October.
  const monthly = rule({ freq: Freq.Monthly, monthlyMode: MonthlyMode.WeekdayOfMonth });
  assert.deepEqual(occurrences(monthly, '2026-10-29', '2026-10-01', '2026-12-31'),
    ['2026-10-29', '2026-11-26', '2026-12-31']);
  assert.equal(nthWeekdayOfMonth(2026, 2, 1, 5), '2026-02-23');
});

test('yearly on 29 February falls on the 28th in ordinary years', () => {
  assert.deepEqual(occurrences(rule({ freq: Freq.Yearly }), '2024-02-29', '2024-01-01', '2026-12-31'),
    ['2024-02-29', '2025-02-28', '2026-02-28']);
});

test('the count follows RFC 5545: an exception does not move it', () => {
  const counted = rule({ freq: Freq.Daily, endMode: End.AfterCount, count: 3, exceptions: ['2026-01-02'] });
  assert.deepEqual(occurrences(counted, '2026-01-01', '2026-01-01', '2026-01-31'), ['2026-01-01', '2026-01-03']);
});

test('an end date is the last day there may be one', () => {
  const until = rule({ freq: Freq.Daily, endMode: End.OnDate, until: '2026-01-03' });
  assert.deepEqual(occurrences(until, '2026-01-01', '2026-01-01', '2026-01-31'), ['2026-01-01', '2026-01-02', '2026-01-03']);
  assert.equal(nextOccurrence(until, '2026-01-01', '2026-01-03'), null);
});

test('next occurrence and matches', () => {
  const weekly = rule({ freq: Freq.Weekly, weekdays: weekdayBit(5) });
  assert.equal(nextOccurrence(weekly, '2026-10-30', '2026-10-30'), '2026-11-06');
  assert.ok(matches(weekly, '2026-10-30', '2026-11-13'));
  assert.ok(!matches(weekly, '2026-10-30', '2026-11-12'));
});

test('descriptions in Russian, as the planner writes them', () => {
  assert.equal(describe(rule({})), 'Не повторяется');
  assert.equal(describe(rule({ freq: Freq.Weekly, interval: 2, weekdays: 1 | 8 })), 'Каждые 2 недели: пн, чт');
  assert.equal(describe(rule({ freq: Freq.Monthly, endMode: End.AfterCount, count: 5 })), 'Каждый месяц, по числу · 5 раз');
  assert.equal(describe(rule({ freq: Freq.Daily, endMode: End.OnDate, until: '2027-01-15' })), 'Каждый день · до 15 января 2027');
});

test('a rule read from JSON gets the planner defaults', () => {
  assert.deepEqual(normalizeRule({ freq: 1, interval: 0, count: 0, until: 'nonsense', exceptions: ['2026-01-01', 'x'] }),
    { freq: 1, interval: 1, weekdays: 0, monthlyMode: 0, endMode: 0, count: 1, until: null, exceptions: ['2026-01-01'] });
});
