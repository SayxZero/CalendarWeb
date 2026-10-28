// The planner of one account in memory: a port of the planner's
// core/datastore.cpp. Every change goes into memory, then to the cache in the
// browser (persist hooks), then to the journal the sync sends to the server,
// and listeners hear about it. The rules are the planner's own - read it
// beside DataStore when changing one.

import {
  today, now, nowMs, dateOf, toSeconds, fromSeconds, shiftDays, daysTo, addDays, DAY_SECONDS, at,
  minuteOfDay,
} from '../model/dates.js';
import { isActive, nextOccurrence, normalizeRule } from '../model/recurrence.js';
import { normalizedReminders, anyReminderRingsAlarm } from '../model/reminders.js';
import {
  Kind, KINDS, normalize, newId, isForeign, isWritable, calendarColor, DEFAULT_CALENDAR_ID,
  PALETTE_COLORS, eventOccurrences, isClosed, isFailed, allSubtasksDone, isOverdue, isDueToday,
  habitExistedOn, habitMarkKey, HabitDay, HABIT_CHART_DAYS, reminderNextFiring,
} from '../model/records.js';
import { collator, containsText } from '../model/text.js';

const keyOf = (kind, id) => `${kind}/${id}`;

export class Store {
  constructor() {
    /** kind -> Map(id -> record) */
    this.maps = Object.fromEntries(KINDS.map((kind) => [kind, new Map()]));
    /** "kind/id" -> {kind, id, deleted, modified}: what the server has not confirmed yet. */
    this.journal = new Map();
    /** "kind/id" -> the reminder list the owner of a shared calendar keeps. */
    this.ownerRemindersMap = new Map();
    this.tracking = true;
    this.listeners = new Set();
    this.pendingKinds = new Set();
    this.flushQueued = false;
    this.trackedSinceAnnounce = false;
    // The cache in the browser and the sync listen here; tests leave them be.
    this.onWrite = () => {};
    this.onJournal = () => {};
    this.onMeta = () => {};
    this.onLocalChange = () => {};
  }

  // ------------------------------------------------------------ plumbing

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  changed(...kinds) {
    for (const kind of kinds) this.pendingKinds.add(kind);
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      const kinds = new Set(this.pendingKinds);
      this.pendingKinds.clear();
      for (const listener of this.listeners) listener(kinds);
    });
  }

  put(kind, record) {
    this.maps[kind].set(record.id, record);
    this.onWrite(kind, record.id, record);
  }

  drop(kind, id) {
    const had = this.maps[kind].delete(id);
    if (had) this.onWrite(kind, id, null);
    return had;
  }

  track(kind, id, deleted = false) {
    if (!this.tracking || !id) return;
    const entry = { kind, id, deleted, modified: Math.max(nowMs(), (this.journal.get(keyOf(kind, id))?.modified ?? 0) + 1) };
    this.journal.set(keyOf(kind, id), entry);
    this.onJournal(keyOf(kind, id), entry);
    this.trackedSinceAnnounce = true;
  }

  announce() {
    if (!this.trackedSinceAnnounce) return;
    this.trackedSinceAnnounce = false;
    this.onLocalChange();
  }

  /** Records of the cache and the journal, as the browser kept them. */
  load({ records = [], journal = [], ownerReminders = [] } = {}) {
    for (const map of Object.values(this.maps)) map.clear();
    for (const { kind, id, data } of records) {
      if (!this.maps[kind]) continue;
      const record = normalize(kind, data, id);
      if (record) this.maps[kind].set(record.id, record);
    }
    this.journal.clear();
    for (const entry of journal) this.journal.set(keyOf(entry.kind, entry.id), entry);
    this.ownerRemindersMap.clear();
    for (const [key, list] of ownerReminders) this.ownerRemindersMap.set(key, list);
    this.changed(...KINDS);
  }

  /** The planner every device starts with: one calendar, never journaled. */
  ensureSeed() {
    if (this.maps.calendar.size) return;
    this.put(Kind.calendar, normalize(Kind.calendar, { id: DEFAULT_CALENDAR_ID, name: 'Мой календарь', color: '#4f6bed' }));
    this.changed(Kind.calendar);
  }

  // ------------------------------------------------------------ calendars

  calendars() {
    return [...this.maps.calendar.values()].sort((a, b) =>
      a.sortOrder - b.sortOrder || collator.compare(a.name, b.name));
  }

  calendar(id) {
    return this.maps.calendar.get(id) || null;
  }

  calendarColor(id) {
    const calendar = this.calendar(id);
    return calendar ? calendarColor(calendar) : '#78808c';
  }

  calendarName(id) {
    return this.calendar(id)?.name ?? 'Без календаря';
  }

  defaultCalendarId() {
    const all = this.calendars();
    return (all.find((c) => c.visible) || all[0])?.id ?? DEFAULT_CALENDAR_ID;
  }

  defaultWritableCalendarId() {
    const preferred = this.defaultCalendarId();
    if (this.isCalendarWritable(preferred)) return preferred;
    const writable = this.writableCalendars();
    return (writable.find((c) => c.visible) || writable[0])?.id ?? preferred;
  }

  isForeignCalendar(id) {
    return isForeign(this.calendar(id));
  }

  isCalendarWritable(id) {
    return isWritable(this.calendar(id));
  }

  /** Whether a record may be changed here: its calendar is not read only. */
  canEdit(record) {
    return !record || this.isCalendarWritable(record.calendarId);
  }

  writableCalendars() {
    return this.calendars().filter(isWritable);
  }

  hiddenCalendars() {
    return new Set(this.calendars().filter((c) => !c.visible).map((c) => c.id));
  }

  saveCalendar(input) {
    const calendar = normalize(Kind.calendar, { ...input, id: input.id || newId() });
    if (!input.id) {
      calendar.sortOrder = Math.max(-1, ...[...this.maps.calendar.values()].map((c) => c.sortOrder)) + 1;
    }
    this.put(Kind.calendar, calendar);
    this.track(Kind.calendar, calendar.id);
    this.changed(Kind.calendar);
    this.announce();
    return calendar.id;
  }

  updateCalendar(id, patch) {
    const calendar = this.calendar(id);
    if (!calendar) return;
    this.saveCalendar({ ...calendar, ...patch, id });
  }

  setCalendarVisible(id, visible) {
    const calendar = this.calendar(id);
    if (!calendar || calendar.visible === visible) return;
    this.updateCalendar(id, { visible });
  }

  setVisibleCalendars(ids) {
    let touched = false;
    for (const calendar of this.maps.calendar.values()) {
      const shown = ids.has(calendar.id);
      if (calendar.visible === shown) continue;
      this.put(Kind.calendar, { ...calendar, visible: shown });
      this.track(Kind.calendar, calendar.id);
      touched = true;
    }
    if (!touched) return;
    this.changed(Kind.calendar);
    this.announce();
  }

  setCalendarStarred(id, starred) {
    const calendar = this.calendar(id);
    if (!calendar || calendar.starred === starred) return;
    this.updateCalendar(id, { starred });
  }

  /**
   * Removes a calendar: its records move to @p moveToId, or go with it when
   * that is empty. The last calendar stays - records need somewhere to live.
   */
  removeCalendar(id, moveToId = '') {
    if (!this.calendar(id) || this.maps.calendar.size < 2) return false;
    const target = moveToId && this.calendar(moveToId) && moveToId !== id ? moveToId : '';
    this.drop(Kind.calendar, id);
    this.track(Kind.calendar, id, true);
    for (const kind of [Kind.event, Kind.task]) {
      for (const record of [...this.maps[kind].values()]) {
        if (record.calendarId !== id) continue;
        if (target) {
          this.put(kind, { ...record, calendarId: target });
          this.track(kind, record.id);
        } else {
          this.drop(kind, record.id);
          this.track(kind, record.id, true);
          if (kind === Kind.task) this.dropCompletionsOf(record.id, true);
        }
      }
    }
    this.changed(Kind.calendar, Kind.event, Kind.task, Kind.completion);
    this.announce();
    return true;
  }

  foreignCalendar(ownerLogin, originId) {
    return this.calendars().find((c) => c.ownerLogin === ownerLogin && c.originId === originId) || null;
  }

  /**
   * Gives somebody else's calendar back. Its content is the owner's, so it
   * leaves this planner in silence: a journaled deletion would go to the
   * server as a change of the shared calendar and take the records out of the
   * owner's planner too. Only the twin itself, this account's own record, is
   * journaled.
   */
  dropSharedCalendar(id) {
    const calendar = this.calendar(id);
    if (!isForeign(calendar)) return false;
    this.drop(Kind.calendar, id);
    this.track(Kind.calendar, id, true);
    for (const kind of [Kind.event, Kind.task]) {
      for (const record of [...this.maps[kind].values()]) {
        if (record.calendarId !== id) continue;
        this.drop(kind, record.id);
        this.forgetOwnerReminders(kind, record.id);
      }
    }
    for (const completion of [...this.maps.completion.values()]) {
      if (completion.calendarId === id) this.drop(Kind.completion, completion.id);
    }
    this.changed(Kind.calendar, Kind.event, Kind.task, Kind.completion);
    this.announce();
    return true;
  }

  reorderCalendars(orderedIds) {
    let touched = false;
    orderedIds.forEach((id, index) => {
      const calendar = this.calendar(id);
      if (!calendar || calendar.sortOrder === index) return;
      this.put(Kind.calendar, { ...calendar, sortOrder: index });
      this.track(Kind.calendar, id);
      touched = true;
    });
    if (touched) {
      this.changed(Kind.calendar);
      this.announce();
    }
  }

  eventCountIn(calendarId) {
    let n = 0;
    for (const e of this.maps.event.values()) if (e.calendarId === calendarId) ++n;
    return n;
  }

  taskCountIn(calendarId) {
    let n = 0;
    for (const t of this.maps.task.values()) if (t.calendarId === calendarId) ++n;
    return n;
  }

  // --------------------------------------------------------------- events

  events() {
    return [...this.maps.event.values()].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  }

  event(id) {
    return this.maps.event.get(id) || null;
  }

  eventColor(event) {
    return /^#[0-9a-f]{6}$/i.test(event.color || '') ? event.color : this.calendarColor(event.calendarId);
  }

  taskColor(task) {
    return this.calendarColor(task.calendarId);
  }

  saveEvent(input) {
    const stamp = now();
    const event = normalize(Kind.event, { ...input, id: input.id || newId() });
    if (!event) return '';
    if (!this.calendar(event.calendarId)) event.calendarId = this.defaultCalendarId();
    if (!event.createdAt) event.createdAt = stamp;
    event.updatedAt = stamp;
    if (!event.end || event.end < event.start) event.end = fromSeconds(toSeconds(event.start) + 3600);
    event.reminders = normalizedReminders(event.reminders);
    event.alarm = anyReminderRingsAlarm(event.reminders);
    this.put(Kind.event, event);
    this.track(Kind.event, event.id);
    this.changed(Kind.event);
    this.announce();
    return event.id;
  }

  removeEvent(id) {
    if (!this.drop(Kind.event, id)) return;
    this.track(Kind.event, id, true);
    this.changed(Kind.event);
    this.announce();
  }

  /** One repetition goes: its date joins the exceptions of the series. */
  excludeOccurrence(eventId, date) {
    const event = this.event(eventId);
    if (!event) return;
    if (!isActive(event.recurrence)) {
      this.removeEvent(eventId);
      return;
    }
    if (event.recurrence.exceptions.includes(date)) return;
    this.put(Kind.event, { ...event, recurrence: { ...event.recurrence, exceptions: [...event.recurrence.exceptions, date] } });
    this.track(Kind.event, eventId);
    this.changed(Kind.event);
    this.announce();
  }

  /**
   * One repetition becomes an event of its own: the date goes into the
   * exceptions of the series, and a copy without a rule takes its place.
   * Returns the copy (or the event itself when it does not repeat).
   */
  detachOccurrence(eventId, date) {
    const event = this.event(eventId);
    if (!event) return null;
    if (!isActive(event.recurrence)) return event;
    const shift = daysTo(dateOf(event.start), date);
    const stamp = now();
    const copy = {
      ...structuredClone(event),
      id: newId(),
      recurrence: normalizeRule(null),
      start: shiftDays(event.start, shift),
      end: event.end ? shiftDays(event.end, shift) : null,
      createdAt: stamp,
      updatedAt: stamp,
    };
    if (!copy.end) copy.end = fromSeconds(toSeconds(copy.start) + 3600);
    if (!event.recurrence.exceptions.includes(date)) {
      this.put(Kind.event, { ...event, recurrence: { ...event.recurrence, exceptions: [...event.recurrence.exceptions, date] } });
      this.track(Kind.event, eventId);
    }
    this.put(Kind.event, copy);
    this.track(Kind.event, copy.id);
    this.changed(Kind.event);
    this.announce();
    return copy;
  }

  /** Occurrences of every event in [from, to]: all-day first, then by start, then by title. */
  occurrences(from, to) {
    const result = [];
    for (const event of this.maps.event.values()) result.push(...eventOccurrences(event, from, to));
    return result.sort((a, b) => {
      if (a.event.allDay !== b.event.allDay) return a.event.allDay ? -1 : 1;
      if (a.start !== b.start) return a.start < b.start ? -1 : 1;
      return collator.compare(a.event.title, b.event.title);
    });
  }

  occurrencesOn(date) {
    return this.occurrences(date, date);
  }

  /** Moves an occurrence to another day; only this one when the event repeats. */
  moveOccurrence(occurrence, newDate, newStartMinute = null) {
    const event = this.event(occurrence.event.id);
    if (!event) return;
    const shiftDaysCount = daysTo(dateOf(occurrence.start), newDate);
    const minuteShift = newStartMinute == null ? 0 : newStartMinute - minuteOfDay(occurrence.start);
    if (shiftDaysCount === 0 && minuteShift === 0) return;
    const shift = shiftDaysCount * DAY_SECONDS + minuteShift * 60;
    const base = isActive(event.recurrence) ? this.detachOccurrence(event.id, occurrence.seedDate) : event;
    if (!base) return;
    this.saveEvent({
      ...base,
      start: fromSeconds(toSeconds(base.start) + shift),
      end: fromSeconds(toSeconds(base.end) + shift),
    });
  }

  // ---------------------------------------------------------------- tasks

  tasks() {
    return [...this.maps.task.values()].sort((a, b) =>
      a.sortOrder - b.sortOrder || ((a.createdAt || '') < (b.createdAt || '') ? -1 : 1));
  }

  task(id) {
    return this.maps.task.get(id) || null;
  }

  saveTask(input) {
    const stamp = now();
    const isNew = !input.id;
    const task = normalize(Kind.task, { ...input, id: input.id || newId() });
    if (!this.calendar(task.calendarId)) task.calendarId = this.defaultCalendarId();
    if (isNew) {
      // A new task joins the list at the end, where the eye looks for it.
      task.sortOrder = Math.max(-1, ...[...this.maps.task.values()].map((t) => t.sortOrder)) + 1;
    }
    if (!task.createdAt) task.createdAt = stamp;
    task.updatedAt = stamp;
    task.reminders = normalizedReminders(task.reminders);
    task.alarm = anyReminderRingsAlarm(task.reminders);
    this.put(Kind.task, task);
    this.track(Kind.task, task.id);
    this.changed(Kind.task);
    this.announce();
    // The editor may have ticked the last line, or turned the flag on over a
    // list that was finished already.
    this.followSubtasks(task.id);
    return task.id;
  }

  reorderTasks(orderedIds) {
    let touched = false;
    orderedIds.forEach((id, index) => {
      const task = this.task(id);
      if (!task || task.sortOrder === index) return;
      this.put(Kind.task, { ...task, sortOrder: index });
      this.track(Kind.task, id);
      touched = true;
    });
    if (touched) {
      this.changed(Kind.task);
      this.announce();
    }
  }

  removeTask(id) {
    if (!this.drop(Kind.task, id)) return;
    this.track(Kind.task, id, true);
    this.dropCompletionsOf(id, true);
    this.changed(Kind.task, Kind.completion);
    this.announce();
  }

  dropCompletionsOf(taskId, journaled) {
    for (const entry of [...this.maps.completion.values()]) {
      if (entry.taskId !== taskId) continue;
      this.drop(Kind.completion, entry.id);
      if (journaled) this.track(Kind.completion, entry.id, true);
    }
  }

  setTaskDone(id, done) {
    this.setTaskState(id, done ? 'done' : 'open');
  }

  setTaskFailed(id, failed) {
    this.setTaskState(id, failed ? 'failed' : 'open');
  }

  /**
   * Opens or closes a task, done or given up on. A repeating task never
   * closes: it rolls on to its next due date either way. Every closing leaves
   * an entry in the log of completions, and re-opening takes the newest one
   * away, so that a task is counted once and as what it ended up being.
   */
  setTaskState(id, state) {
    let task = this.task(id);
    if (!task || !this.isCalendarWritable(task.calendarId)) return;
    if ((state === 'done' && task.done) || (state === 'failed' && isFailed(task))) return;
    const stamp = now();

    if (state === 'open' || isClosed(task)) {
      task = { ...task, done: false, failed: false, completedAt: null, updatedAt: stamp };
      this.put(Kind.task, task);
      this.track(Kind.task, id);
      let newest = null;
      for (const entry of this.maps.completion.values()) {
        if (entry.taskId === id && (!newest || entry.completedAt >= newest.completedAt)) newest = entry;
      }
      if (newest) {
        this.drop(Kind.completion, newest.id);
        this.track(Kind.completion, newest.id, true);
      }
      if (state === 'open') {
        this.changed(Kind.task, Kind.completion);
        this.announce();
        return;
      }
    }

    const failed = state === 'failed';
    const completion = normalize(Kind.completion, {
      id: newId(), taskId: task.id, taskTitle: task.title, calendarId: task.calendarId,
      completedAt: stamp, failed,
    });
    this.put(Kind.completion, completion);
    this.track(Kind.completion, completion.id);

    const nextDue = isActive(task.recurrence) && task.dueAt
      ? nextOccurrence(task.recurrence, dateOf(task.dueAt), dateOf(task.dueAt))
      : null;
    if (nextDue) {
      task = {
        ...task,
        dueAt: at(nextDue, minuteOfDay(task.dueAt)),
        done: false,
        failed: false,
        completedAt: null,
        subtasks: task.subtasks.map((s) => ({ ...s, done: false })),
      };
    } else {
      task = { ...task, done: !failed, failed, completedAt: stamp };
    }
    task.updatedAt = stamp;
    this.put(Kind.task, task);
    this.track(Kind.task, id);
    this.changed(Kind.task, Kind.completion);
    this.announce();
  }

  setSubtaskDone(taskId, subtaskId, done) {
    const task = this.task(taskId);
    if (!task || !this.isCalendarWritable(task.calendarId)) return;
    if (!task.subtasks.some((s) => s.id === subtaskId)) return;
    this.put(Kind.task, {
      ...task,
      subtasks: task.subtasks.map((s) => (s.id === subtaskId ? { ...s, done } : s)),
      updatedAt: now(),
    });
    this.track(Kind.task, taskId);
    this.changed(Kind.task);
    this.announce();
    this.followSubtasks(taskId);
  }

  /** "Выполнить вместе с подзадачами": the state of the task reads its checklist both ways. */
  followSubtasks(taskId) {
    const task = this.task(taskId);
    if (!task || !task.doneWithSubtasks || !task.subtasks.length) return;
    const all = allSubtasksDone(task);
    if (all === task.done) return;
    this.setTaskDone(taskId, all);
  }

  tasksOn(date) {
    return [...this.maps.task.values()]
      .filter((t) => t.dueAt && dateOf(t.dueAt) === date)
      .sort((a, b) => {
        if (isClosed(a) !== isClosed(b)) return isClosed(a) ? 1 : -1;
        if (a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
        return collator.compare(a.title, b.title);
      });
  }

  openTasks() {
    return [...this.maps.task.values()].filter((t) => !isClosed(t));
  }

  overdueCount() {
    return [...this.maps.task.values()].filter(isOverdue).length;
  }

  dueTodayCount() {
    return [...this.maps.task.values()].filter(isDueToday).length;
  }

  // --------------------------------------------------------------- search

  searchEvents(needle) {
    const query = (needle || '').trim();
    if (!query) return [];
    return this.events().filter((e) => containsText(e.title, query) || containsText(e.description, query)
      || containsText(e.location, query));
  }

  searchTasks(needle) {
    const query = (needle || '').trim();
    if (!query) return [];
    return [...this.maps.task.values()]
      .filter((t) => containsText(t.title, query) || containsText(t.notes, query)
        || t.subtasks.some((s) => containsText(s.title, query)))
      .sort((a, b) => (!!a.dueAt !== !!b.dueAt ? (a.dueAt ? -1 : 1) : (a.dueAt || '') < (b.dueAt || '') ? -1 : 1));
  }

  // -------------------------------------------------------------- melodies

  melodies() {
    return [...this.maps.melody.values()].sort((a, b) => collator.compare(a.title, b.title));
  }

  melody(id) {
    return this.maps.melody.get(id) || null;
  }

  saveMelody(input) {
    const melody = normalize(Kind.melody, { ...input, id: input.id || newId(), createdAt: input.createdAt || now() });
    if (!melody) return '';
    this.put(Kind.melody, melody);
    this.track(Kind.melody, melody.id);
    this.changed(Kind.melody);
    this.announce();
    return melody.id;
  }

  /** Records that rang this melody fall back to the one in the settings. */
  removeMelody(id) {
    if (!this.drop(Kind.melody, id)) return;
    this.track(Kind.melody, id, true);
    const reference = `melody:${id}`;
    for (const kind of [Kind.event, Kind.task]) {
      for (const record of [...this.maps[kind].values()]) {
        if (record.alarmMelody !== reference) continue;
        this.put(kind, { ...record, alarmMelody: '' });
        this.track(kind, record.id);
      }
    }
    this.changed(Kind.melody, Kind.event, Kind.task);
    this.announce();
  }

  // ---------------------------------------------------------------- habits

  habits(withArchived = false) {
    return [...this.maps.habit.values()]
      .filter((h) => withArchived || !h.archivedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder || ((a.createdAt || '') < (b.createdAt || '') ? -1 : 1));
  }

  habit(id) {
    return this.maps.habit.get(id) || null;
  }

  saveHabit(input) {
    if (!input.id && !(input.title || '').trim()) return '';
    const isNew = !input.id || !this.habit(input.id);
    const habit = normalize(Kind.habit, { ...input, id: input.id || newId() });
    if (isNew) {
      // Today and no earlier: nobody can say whether a habit thought of this
      // morning was kept last week.
      if (!input.startedAt) habit.startedAt = today();
      if (!habit.color) habit.color = PALETTE_COLORS[this.maps.habit.size % PALETTE_COLORS.length];
      if (!habit.sortOrder) habit.sortOrder = Math.max(0, ...[...this.maps.habit.values()].map((h) => h.sortOrder)) + 1;
      if (!habit.createdAt) habit.createdAt = now();
    }
    habit.title = habit.title.trim();
    habit.updatedAt = now();
    this.put(Kind.habit, habit);
    this.track(Kind.habit, habit.id);
    this.changed(Kind.habit);
    this.announce();
    return habit.id;
  }

  /** The cross of the edit mode: the habit leaves the list, its days stay. */
  archiveHabit(id) {
    const habit = this.habit(id);
    if (!habit || habit.archivedAt) return;
    this.put(Kind.habit, { ...habit, archivedAt: today(), updatedAt: now() });
    this.track(Kind.habit, id);
    this.changed(Kind.habit);
    this.announce();
  }

  /** Back from the removed; the days between are days it did not exist, not misses. */
  restoreHabit(id) {
    const habit = this.habit(id);
    if (!habit || !habit.archivedAt) return;
    const day = today();
    let pauses = [...habit.pauses];
    if (habit.archivedAt < day) pauses.push([habit.archivedAt, day]);
    const horizon = addDays(day, -2 * HABIT_CHART_DAYS);
    pauses = pauses.filter(([, to]) => !to || to >= horizon);
    this.put(Kind.habit, { ...habit, archivedAt: null, pauses, updatedAt: now() });
    this.track(Kind.habit, id);
    this.changed(Kind.habit);
    this.announce();
  }

  isHabitDone(habitId, date) {
    return this.maps.habitmark.has(habitMarkKey(habitId, date));
  }

  setHabitDone(habitId, date, done) {
    const key = habitMarkKey(habitId, date);
    if (!key || !this.habit(habitId) || done === this.maps.habitmark.has(key)) return;
    if (done) {
      this.put(Kind.habitMark, normalize(Kind.habitMark, { id: key, habitId, day: date, markedAt: now() }));
    } else {
      this.drop(Kind.habitMark, key);
    }
    this.track(Kind.habitMark, key, !done);
    this.changed(Kind.habitMark);
    this.announce();
  }

  /** The circles of one habit: @p days days up to @p day, oldest first. */
  habitChart(habit, day = today(), days = HABIT_CHART_DAYS) {
    const chart = [];
    for (let i = days - 1; i >= 0; --i) {
      const date = addDays(day, -i);
      if (!habitExistedOn(habit, date)) chart.push(HabitDay.Absent);
      else if (this.isHabitDone(habit.id, date)) chart.push(HabitDay.Done);
      else if (date === day) chart.push(HabitDay.Pending);
      else chart.push(HabitDay.Missed);
    }
    return chart;
  }

  habitsDoneOn(date) {
    return this.habits().filter((h) => this.isHabitDone(h.id, date)).length;
  }

  // ------------------------------------------------- reminders of their own

  reminders() {
    return [...this.maps.reminder.values()].sort((a, b) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.id < b.id ? -1 : 1));
  }

  reminder(id) {
    return this.maps.reminder.get(id) || null;
  }

  saveReminder(input) {
    const reminder = normalize(Kind.reminder, { ...input, id: input.id || newId() });
    if (!reminder) return '';
    if (!reminder.createdAt) reminder.createdAt = now();
    reminder.title = reminder.title.trim();
    // A moment to the minute: a reminder saved at 21:00:37 would never match its hour.
    reminder.at = reminder.at.slice(0, 16) + ':00';
    reminder.updatedAt = now();
    this.put(Kind.reminder, reminder);
    this.track(Kind.reminder, reminder.id);
    this.changed(Kind.reminder);
    this.announce();
    return reminder.id;
  }

  removeReminder(id) {
    if (!this.drop(Kind.reminder, id)) return;
    this.track(Kind.reminder, id, true);
    this.changed(Kind.reminder);
    this.announce();
  }

  setReminderEnabled(id, enabled) {
    const reminder = this.reminder(id);
    if (!reminder || reminder.enabled === enabled) return;
    this.put(Kind.reminder, { ...reminder, enabled, updatedAt: now() });
    this.track(Kind.reminder, id);
    this.changed(Kind.reminder);
    this.announce();
  }

  activeReminders(nowText = now()) {
    return this.reminders().filter((r) => r.enabled && reminderNextFiring(r, nowText)).length;
  }

  // ----------------------------------------------------- alarms switched off

  isAlarmStopped(key) {
    return this.maps.alarmstop.has(key);
  }

  /** An alarm switched off here stays off on every device of the account. */
  stopAlarm(key, itemId, fireAt) {
    if (!key || !fireAt) return;
    this.put(Kind.alarmStop, normalize(Kind.alarmStop, { id: key, itemId, fireAt, stoppedAt: now() }));
    this.track(Kind.alarmStop, key);
    this.announce();
  }

  // ----------------------------------------------------------- completions

  completions() {
    return [...this.maps.completion.values()];
  }

  completedInLastDays(days) {
    const to = today();
    const from = addDays(to, -(Math.max(1, days) - 1));
    return this.completions().filter((c) => !c.failed && dateOf(c.completedAt) >= from && dateOf(c.completedAt) <= to).length;
  }

  // ------------------------------------------------------------------ sync

  journalEntries() {
    return [...this.journal.values()];
  }

  /** Lines the server confirmed go, unless they changed again while the request was out. */
  acknowledge(sent) {
    for (const entry of sent) {
      const key = keyOf(entry.kind, entry.id);
      const current = this.journal.get(key);
      if (current && current.modified <= entry.modified) {
        this.journal.delete(key);
        this.onJournal(key, null);
      }
    }
  }

  ownerReminders(kind, id) {
    return this.ownerRemindersMap.get(keyOf(kind, id)) || [];
  }

  setOwnerReminders(kind, id, list) {
    this.ownerRemindersMap.set(keyOf(kind, id), list);
    this.onMeta(`owner-reminders/${kind}/${id}`, list);
  }

  forgetOwnerReminders(kind, id) {
    if (!this.ownerRemindersMap.delete(keyOf(kind, id))) return;
    this.onMeta(`owner-reminders/${kind}/${id}`, null);
  }

  /**
   * What came from the server, written without a journal so that it does not
   * go back as an echo. @p batch: {records: [{kind, record}], removals: [[kind, id]]}.
   * @p firstSync: the seeds of this device give way to what the account has.
   */
  applyRemote(batch, firstSync = false) {
    if (!batch.records.length && !batch.removals.length && !firstSync) return;
    const arrivedCalendars = new Set();
    const touched = new Set();

    for (const { kind, record } of batch.records) {
      touched.add(kind);
      if (kind === Kind.calendar) arrivedCalendars.add(record.id);
      if (kind === Kind.calendar || kind === Kind.melody || kind === Kind.habit || kind === Kind.habitMark
        || kind === Kind.reminder || kind === Kind.alarmStop || kind === Kind.completion) {
        this.put(kind, record);
      }
    }
    // Events and tasks after the calendars, so that a twin arriving in the
    // same answer is known. Reminders belong to the person: a record of
    // somebody else's calendar keeps the ones this account set on it, and the
    // owner's list is kept aside to go back with this member's next edit.
    for (const { kind, record } of batch.records) {
      if (kind !== Kind.event && kind !== Kind.task) continue;
      let arriving = record;
      if (this.isForeignCalendar(record.calendarId)) {
        this.setOwnerReminders(kind, record.id, record.reminders);
        const mine = this.maps[kind].get(record.id);
        arriving = { ...record, reminders: mine ? mine.reminders : [] };
        arriving.alarm = anyReminderRingsAlarm(arriving.reminders);
      }
      this.put(kind, arriving);
    }

    const deletedCalendars = [];
    for (const [kind, id] of batch.removals) {
      touched.add(kind);
      if (kind === Kind.calendar) {
        deletedCalendars.push(id);
      } else if (kind === Kind.habit) {
        this.drop(kind, id);
        for (const mark of [...this.maps.habitmark.values()]) {
          if (mark.habitId === id) this.drop(Kind.habitMark, mark.id);
        }
      } else if (this.maps[kind]) {
        this.drop(kind, id);
        if (kind === Kind.event || kind === Kind.task) this.forgetOwnerReminders(kind, id);
      }
    }

    if (firstSync && arrivedCalendars.size) {
      for (const calendar of this.calendars()) {
        if (!arrivedCalendars.has(calendar.id) && !this.journal.has(keyOf(Kind.calendar, calendar.id))
          && this.eventCountIn(calendar.id) === 0 && this.taskCountIn(calendar.id) === 0) {
          deletedCalendars.push(calendar.id);
        }
      }
    }

    for (const id of deletedCalendars) {
      if (!this.calendar(id) || this.maps.calendar.size < 2) continue;
      this.drop(Kind.calendar, id);
      // What is still in it was made here and not seen elsewhere: it moves.
      const home = this.defaultCalendarId();
      for (const kind of [Kind.event, Kind.task]) {
        for (const record of [...this.maps[kind].values()]) {
          if (record.calendarId !== id) continue;
          this.put(kind, { ...record, calendarId: home });
          this.track(kind, record.id);
        }
      }
    }

    // A record whose calendar is unknown here joins the default one.
    this.ensureSeed();
    const home = this.defaultCalendarId();
    for (const kind of [Kind.event, Kind.task]) {
      for (const record of [...this.maps[kind].values()]) {
        if (this.calendar(record.calendarId)) continue;
        this.put(kind, { ...record, calendarId: home });
        this.track(kind, record.id);
      }
    }

    this.changed(...touched, Kind.calendar, Kind.event, Kind.task);
    this.announce();
  }

  /**
   * Puts every record of the account into the journal again, for a server
   * that lost what it had confirmed. Records of somebody else's calendars
   * stay out: they are the owner's, and sent from here they would arrive as
   * this member's stale edits.
   */
  republishAll() {
    let count = 0;
    for (const kind of KINDS) {
      for (const record of this.maps[kind].values()) {
        if ((kind === Kind.event || kind === Kind.task) && this.isForeignCalendar(record.calendarId)) continue;
        if (kind === Kind.completion) {
          const calendarId = this.task(record.taskId)?.calendarId ?? record.calendarId;
          if (this.isForeignCalendar(calendarId)) continue;
        }
        this.track(kind, record.id);
        ++count;
      }
    }
    this.announce();
    return count;
  }

  /** Records brought in from a backup or another planner, journaled like any edit. */
  importAll(records) {
    for (const { kind, record } of records) {
      this.put(kind, record);
      this.track(kind, record.id);
    }
    this.changed(...KINDS);
    this.announce();
  }
}

export { keyOf };
