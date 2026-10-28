// Reminders while the page is open, a port of the planner's ReminderService:
// a look every 30 seconds plus a timer on the nearest moment, over the window
// (last look, now] - opening the page in the evening does not pour out the
// whole day. A reminder that rings as an alarm clock rings here with sound;
// switched off, it is written down as an "alarmstop" record, and the other
// devices of the account stay quiet. One that is more than five minutes late
// comes as a quiet notification instead.

import { nowSeconds, fromSeconds, toSeconds, dateOf, addDays, today, hhmm, DAY_SECONDS } from '../model/dates.js';
import { reminderOffset, reminderRingsAlarm, ALARM_GRACE_MINUTES } from '../model/reminders.js';
import { isClosed, taskReminderAt, eventReminderAt, reminderFirings, timeRangeText } from '../model/records.js';
import { friendlyDate } from '../model/text.js';

const POLL_MS = 30000;

/** The key of one reminder of one occurrence: the same on every device (ReminderHit::key()). */
export function hitKey(itemId, happensAt, fireAt) {
  return `${itemId}@${happensAt || ''}/${fireAt}`;
}

/** Every reminder that fires in (fromSec, toSec], earliest first. */
export function collectHits(store, fromSec, toSec) {
  const hits = [];
  const fromDay = dateOf(fromSeconds(fromSec));
  const toDay = dateOf(fromSeconds(toSec));
  // Reminders reach days ahead of what they remind of.
  const maxLead = 31;
  for (const occurrence of store.occurrences(fromDay, addDays(toDay, maxLead))) {
    const event = occurrence.event;
    if (event.cancelled) continue;
    for (const reminder of event.reminders) {
      const fireAt = eventReminderAt(event, occurrence.start, reminder);
      if (!fireAt) continue;
      const sec = toSeconds(fireAt);
      if (sec <= fromSec || sec > toSec) continue;
      hits.push({
        kind: 'event', itemId: event.id, title: event.title || 'Без названия',
        subtitle: `${friendlyDate(dateOf(occurrence.start))}, ${timeRangeText({ ...event, start: occurrence.start, end: occurrence.end })}`,
        happensAt: occurrence.start, fireAt, alarm: reminderRingsAlarm(reminder), record: event,
      });
    }
  }
  for (const task of store.maps.task.values()) {
    if (isClosed(task) || !task.dueAt) continue;
    for (const reminder of task.reminders) {
      if (reminderOffset(reminder) < 0) continue;
      const fireAt = taskReminderAt(task, reminder);
      const sec = toSeconds(fireAt);
      if (!fireAt || sec <= fromSec || sec > toSec) continue;
      hits.push({
        kind: 'task', itemId: task.id, title: task.title || 'Без названия',
        subtitle: task.hasDueTime ? `Срок: ${friendlyDate(dateOf(task.dueAt))}, ${hhmm(task.dueAt)}` : `Срок: ${friendlyDate(dateOf(task.dueAt))}`,
        happensAt: task.dueAt, fireAt, alarm: reminderRingsAlarm(reminder), record: task,
      });
    }
  }
  for (const reminder of store.maps.reminder.values()) {
    if (!reminder.enabled) continue;
    for (const moment of reminderFirings(reminder, fromSec + 1, toSec)) {
      hits.push({
        kind: 'reminder', itemId: reminder.id, title: reminder.title || 'Напоминание', subtitle: reminder.notes || '',
        happensAt: moment, fireAt: moment, alarm: reminder.alarm, record: reminder,
      });
    }
  }
  return hits
    .map((hit) => ({ ...hit, key: hitKey(hit.itemId, hit.happensAt, hit.fireAt) }))
    .filter((hit) => !store.isAlarmStopped(hit.key))
    .sort((a, b) => (a.fireAt < b.fireAt ? -1 : 1));
}

export class AlarmService {
  /**
   * @p notify(hit) shows a quiet one, @p ring(hit) an alarm. Snoozed alarms
   * come back at their moment; the count of snoozes is kept per key.
   */
  constructor(store, { notify, ring }) {
    this.store = store;
    this.notify = notify;
    this.ring = ring;
    this.last = nowSeconds();
    this.snoozed = new Map();
    this.snoozeCount = new Map();
    this.poll = 0;
    this.precise = 0;
    this.unsubscribe = null;
  }

  start() {
    this.last = nowSeconds();
    this.poll = setInterval(() => this.tick(), POLL_MS);
    this.unsubscribe = this.store.subscribe(() => this.arm());
    this.arm();
  }

  stop() {
    clearInterval(this.poll);
    clearTimeout(this.precise);
    this.unsubscribe?.();
  }

  /** A timer on the nearest moment: an alarm half a minute late is no alarm. */
  arm() {
    clearTimeout(this.precise);
    const now = nowSeconds();
    const ahead = collectHits(this.store, now, now + DAY_SECONDS);
    let next = ahead.length ? toSeconds(ahead[0].fireAt) : Infinity;
    for (const hit of this.snoozed.values()) next = Math.min(next, toSeconds(hit.fireAt));
    if (next === Infinity) return;
    const wait = Math.max(500, (next - now) * 1000 + 300);
    if (wait < POLL_MS * 2) this.precise = setTimeout(() => this.tick(), wait);
  }

  tick() {
    const now = nowSeconds();
    // A machine that slept for hours wakes with all of it behind: look back
    // one day at most.
    const from = Math.max(this.last, now - DAY_SECONDS);
    const hits = collectHits(this.store, from, now);
    this.last = now;
    for (const [key, hit] of [...this.snoozed]) {
      if (toSeconds(hit.fireAt) <= now) {
        this.snoozed.delete(key);
        hits.push(hit);
      }
    }
    for (const hit of hits) {
      const late = now - toSeconds(hit.fireAt);
      if (hit.alarm && late <= ALARM_GRACE_MINUTES * 60) this.ring(hit);
      else this.notify(hit);
    }
    this.arm();
  }

  /** Puts a ringing alarm off; false when its limit of snoozes is used up. */
  snooze(hit, minutes, limit) {
    const count = this.snoozeCount.get(hit.key) || 0;
    if (limit >= 0 && count >= limit) return false;
    this.snoozeCount.set(hit.key, count + 1);
    const fireAt = fromSeconds(nowSeconds() + minutes * 60);
    this.snoozed.set(hit.key, { ...hit, fireAt, snoozedFrom: hit.fireAt });
    this.arm();
    return true;
  }

  canSnooze(hit, limit) {
    return limit < 0 || (this.snoozeCount.get(hit.key) || 0) < limit;
  }

  /** The moments of the next days, for the "next reminder" line of the menu. */
  upcoming(days = 3) {
    const now = nowSeconds();
    return collectHits(this.store, now, now + days * DAY_SECONDS);
  }
}

/** When the next reminder of its own rings, as the menu line says it. */
export function nextReminderText(store) {
  const now = nowSeconds();
  const next = [...store.maps.reminder.values()]
    .filter((r) => r.enabled)
    .flatMap((r) => reminderFirings(r, now, now + 7 * DAY_SECONDS).slice(0, 1))
    .sort()[0];
  if (!next) return '';
  return dateOf(next) === today() ? hhmm(next) : `${friendlyDate(dateOf(next))}, ${hhmm(next)}`;
}

