// The week and the day: a column per day, the hours down the side, events as
// blocks at their time, all-day and multi-day ones in a row on top. One to
// seven days (the zoom). On a computer a stretch of a column dragged with the
// mouse becomes a new event, a block can be moved and its bottom edge pulled;
// on a phone a tap makes or opens, as in the planner.

import { h, calStyle, isMobile, onSwipe, openMenu } from '../dom.js';
import {
  addDays, startOfWeek, parts, today, dayOfWeek, dateOf, minuteOfDay, toSeconds, at, nowSeconds, hhmm, minutesText,
} from '../../model/dates.js';
import { WEEKDAYS_SHORT, MONTHS_GENITIVE } from '../../model/text.js';
import { coversDate, isClosed } from '../../model/records.js';
import { DEFAULT_START_MINUTES } from '../../model/reminders.js';
import { settings } from '../settings.js';

const SNAP = 15;

/** Columns for overlapping blocks: [{item, column, columns}]. */
function layoutBlocks(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const placed = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const columns = Math.max(1, ...cluster.map((p) => p.column + 1));
    for (const p of cluster) p.columns = columns;
    cluster = [];
  };
  for (const item of sorted) {
    if (item.start >= clusterEnd) flush();
    const ends = [];
    for (const p of cluster) ends[p.column] = Math.max(ends[p.column] ?? -1, p.item.end);
    let column = 0;
    while (ends[column] !== undefined && ends[column] > item.start) ++column;
    const entry = { item, column, columns: 1 };
    cluster.push(entry);
    placed.push(entry);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return placed;
}

export class WeekView {
  constructor(app, mode) {
    this.app = app;
    this.mode = mode; // 'week' or 'day'
    this.showFilterBar = true;
    this.hasDateNav = true;
    this.scrollTop = null;
  }

  days() {
    return this.mode === 'day' ? 1 : settings.get('weekDayCount') || 7;
  }

  start() {
    const n = this.days();
    return n === 7 ? startOfWeek(this.app.anchor, settings.get('firstDayOfWeek')) : this.app.anchor;
  }

  title() {
    const start = this.start();
    const n = this.days();
    if (n === 1) {
      const p = parts(start);
      return `${p.d} ${MONTHS_GENITIVE[p.m - 1]} ${p.y}, ${WEEKDAYS_SHORT[dayOfWeek(start) - 1]}`;
    }
    const end = addDays(start, n - 1);
    const a = parts(start), b = parts(end);
    if (a.m === b.m) return `${a.d}–${b.d} ${MONTHS_GENITIVE[a.m - 1]} ${a.y}`;
    if (a.y === b.y) return `${a.d} ${MONTHS_GENITIVE[a.m - 1].slice(0, 3)} – ${b.d} ${MONTHS_GENITIVE[b.m - 1].slice(0, 3)} ${a.y}`;
    return `${a.d}.${String(a.m).padStart(2, '0')}.${a.y} – ${b.d}.${String(b.m).padStart(2, '0')}.${b.y}`;
  }

  step(n) {
    this.app.setAnchor(addDays(this.start(), n * this.days()));
  }

  /** How many days the week shows: in the bar on top on a computer, under the grid on a phone. */
  zoom() {
    const current = this.days();
    return h('div', { class: 'seg', title: 'Сколько дней показывать' }, ...[1, 3, 5, 7].map((n) =>
      h('button', { class: current === n ? 'on' : '', on: { click: () => { settings.set('weekDayCount', n); this.app.render(); } } }, String(n))));
  }

  toolbar() {
    return this.mode === 'week' && !isMobile() ? this.zoom() : null;
  }

  render(root) {
    const app = this.app;
    const store = app.store;
    const n = this.days();
    const start = this.start();
    const end = addDays(start, n - 1);
    const hidden = store.hiddenCalendars();
    const hour = settings.get('hourHeight') || 48;
    const todayDate = today();
    const columns = `56px repeat(${n}, minmax(0, 1fr))`;
    document.documentElement.style.setProperty('--hour', `${hour}px`);

    const occurrences = store.occurrences(start, end).filter((o) => !hidden.has(o.event.calendarId));
    const dates = Array.from({ length: n }, (_, i) => addDays(start, i));

    const head = h('div', { class: 'week-head', style: { gridTemplateColumns: columns } }, h('div', { class: 'corner' }),
      ...dates.map((date) => h('div', {
        class: ['day', date === todayDate ? 'today' : ''], title: 'Открыть день',
        on: { click: () => (n === 1 ? app.go('month', date) : app.go('day', date)) },
      }, h('div', { class: 'wd' }, WEEKDAYS_SHORT[dayOfWeek(date) - 1]), h('div', { class: 'dn' }, String(parts(date).d)))));

    // All-day and multi-day events go on top, one cell per day.
    const allDay = h('div', { class: 'week-allday', style: { gridTemplateColumns: columns } }, h('div', { class: 'label' }, 'весь день'));
    const allDayCells = dates.map((date) => {
      const cell = h('div', { class: 'cell', on: { dblclick: (e) => { if (!e.target.closest('.item')) app.newEvent({ date, allDay: true }); } } });
      allDay.append(cell);
      return cell;
    });
    const timed = dates.map(() => []);
    for (const occurrence of occurrences) {
      const startDay = dateOf(occurrence.start);
      const long = occurrence.event.allDay || coversDate(occurrence, addDays(startDay, 1));
      dates.forEach((date, i) => {
        if (!coversDate(occurrence, date)) return;
        if (long) allDayCells[i].append(this.barItem(occurrence, date, i));
        else timed[i].push(occurrence);
      });
    }
    const hasAllDay = allDayCells.some((c) => c.childElementCount);
    if (!hasAllDay) allDay.style.display = isMobile() ? 'none' : '';

    const body = h('div', { class: 'week-body' });
    const grid = h('div', { class: 'week-grid', style: { gridTemplateColumns: columns, height: `${24 * hour}px` } });
    const hours = h('div', { class: 'hours' }, ...Array.from({ length: 24 }, (_, i) => h('div', null, i ? `${String(i).padStart(2, '0')}:00` : '')));
    grid.append(hours);
    this.columnsEls = [];
    dates.forEach((date, i) => {
      const col = h('div', { class: ['daycol', date === todayDate ? 'today' : '', settings.get('highlightWeekends') && dayOfWeek(date) >= 6 ? 'weekend' : ''], dataset: { date } });
      const items = timed[i].map((occurrence) => {
        const dayStart = toSeconds(at(date, 0));
        const s = Math.max(0, (toSeconds(occurrence.start) - dayStart) / 60);
        const e = Math.min(1440, (toSeconds(occurrence.end) - dayStart) / 60);
        return { occurrence, start: s, end: Math.max(e, s + 20) };
      });
      for (const { item, column, columns: count } of layoutBlocks(items)) {
        col.append(this.block(item, date, column, count, hour));
      }
      if (settings.get('tasksInCalendar')) this.taskMarks(col, date, hidden, hour);
      if (date === todayDate) {
        const minutes = (nowSeconds() % 86400) / 60;
        col.append(h('div', { class: 'nowline', style: { top: `${(minutes / 60) * hour}px` } }));
      }
      if (!isMobile()) this.creation(col, date, hour);
      else col.addEventListener('click', (e) => {
        if (e.target.closest('.block, .taskmark')) return;
        const minute = Math.floor(this.minuteAt(col, e.clientY, hour) / 30) * 30;
        app.newEvent({ date, minutes: minute });
      });
      grid.append(col);
      this.columnsEls.push(col);
    });
    body.append(grid);

    const view = h('div', { class: 'week' }, head, allDay, body,
      this.mode === 'week' && isMobile() ? h('div', { class: 'zoom-bar' }, h('span', { class: 'muted small' }, 'Дней:'), this.zoom()) : null);
    root.append(view);
    onSwipe(head, (dir) => this.step(dir));
    onSwipe(allDay, (dir) => this.step(dir));
    if (n === 1) onSwipe(body, (dir) => this.step(dir));

    // Where the day starts, or an hour before now when today is on screen.
    const showsToday = dates.includes(todayDate);
    const initial = this.scrollTop ?? Math.max(0, (showsToday ? Math.max(0, (nowSeconds() % 86400) / 3600 - 1.5) : settings.get('dayStartHour')) * hour);
    body.scrollTop = initial;
    body.addEventListener('scroll', () => { this.scrollTop = body.scrollTop; }, { passive: true });
  }

  barItem(occurrence, date, index) {
    const event = occurrence.event;
    const startDay = dateOf(occurrence.start);
    return h('div', {
      class: ['item', 'bar', event.cancelled ? 'cancelled' : '', startDay < date && index > 0 ? 'cont-left' : '',
        coversDate(occurrence, addDays(date, 1)) && index < this.days() - 1 ? 'cont-right' : ''],
      style: calStyle(this.app.store.eventColor(event)), title: event.title,
      on: { click: () => this.app.openOccurrence(occurrence) },
    }, h('span', { class: 'ellipsis' }, startDay < date && index > 0 ? '' : event.title || 'Без названия'));
  }

  block({ occurrence, start, end }, date, column, columns, hour) {
    const event = occurrence.event;
    const top = (start / 60) * hour;
    const height = Math.max(18, ((end - start) / 60) * hour - 2);
    const width = 100 / columns;
    const short = height < 34;
    const el = h('div', {
      class: ['block', event.cancelled ? 'cancelled' : ''],
      style: { ...calStyle(this.app.store.eventColor(event)), top: `${top}px`, height: `${height}px`, left: `calc(${column * width}% + 1px)`, width: `calc(${width}% - 3px)` },
      title: `${hhmm(occurrence.start)}–${hhmm(occurrence.end)} ${event.title}`,
    },
    h('div', { class: 't' }, short ? `${hhmm(occurrence.start)} ${event.title || 'Без названия'}` : event.title || 'Без названия'),
    short ? null : h('div', { class: 's' }, `${hhmm(occurrence.start)} – ${hhmm(occurrence.end)}${event.location ? ' · ' + event.location : ''}`));
    if (isMobile()) {
      el.addEventListener('click', (e) => { e.stopPropagation(); this.app.openOccurrence(occurrence); });
      return el;
    }
    const editable = this.app.store.canEdit(event);
    if (editable) el.append(h('div', { class: 'grip' }));
    el.addEventListener('pointerdown', (e) => this.dragBlock(e, el, occurrence, date, start, end, hour, editable));
    return el;
  }

  /** Moving a block (or pulling its bottom edge) with the mouse. */
  dragBlock(e, el, occurrence, date, start, end, hour, editable) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const resizing = e.target.classList.contains('grip');
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    let newDate = date, newStart = start, newEnd = end;
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      if (!editable) return;
      moved = true;
      el.classList.add('dragging');
      const delta = Math.round(((ev.clientY - y0) / hour) * 60 / SNAP) * SNAP;
      if (resizing) {
        newEnd = Math.min(1440, Math.max(start + SNAP, end + delta));
        el.style.height = `${((newEnd - start) / 60) * hour - 2}px`;
        return;
      }
      newStart = Math.min(1440 - SNAP, Math.max(0, start + delta));
      el.style.top = `${(newStart / 60) * hour}px`;
      const col = this.columnsEls.find((c) => {
        const r = c.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX < r.right;
      });
      if (col && col.dataset.date !== newDate) {
        newDate = col.dataset.date;
        col.append(el);
        el.style.left = '1px';
        el.style.width = 'calc(100% - 3px)';
      }
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (!moved) {
        this.app.openOccurrence(occurrence);
        return;
      }
      if (resizing) this.app.resizeOccurrence(occurrence, newEnd);
      else this.app.moveOccurrence(occurrence, newDate, newStart);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  minuteAt(col, clientY, hour) {
    const rect = col.getBoundingClientRect();
    return Math.max(0, Math.min(1439, ((clientY - rect.top) / hour) * 60));
  }

  /** Mouse down and drag on an empty stretch: the stretch becomes a new event. */
  creation(col, date, hour) {
    col.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.block, .taskmark')) return;
      const first = Math.floor(this.minuteAt(col, e.clientY, hour) / SNAP) * SNAP;
      let last = first + SNAP;
      let moved = false;
      const preview = h('div', { class: 'block preview', style: { ...calStyle(this.app.store.calendarColor(this.app.store.defaultWritableCalendarId())), left: '1px', width: 'calc(100% - 3px)' } });
      const paint = () => {
        const a = Math.min(first, last), b = Math.max(first + SNAP, last);
        preview.style.top = `${(a / 60) * hour}px`;
        preview.style.height = `${((b - a) / 60) * hour - 2}px`;
        preview.textContent = `${minutesText(a)} – ${minutesText(b)}`;
      };
      col.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const m = Math.ceil(this.minuteAt(col, ev.clientY, hour) / SNAP) * SNAP;
        if (!moved && Math.abs(m - last) < SNAP) return;
        moved = true;
        last = m;
        if (!preview.isConnected) col.append(preview);
        paint();
      };
      const up = () => {
        col.removeEventListener('pointermove', move);
        col.removeEventListener('pointerup', up);
        col.removeEventListener('pointercancel', up);
        preview.remove();
        if (moved) {
          const a = Math.min(first, last), b = Math.max(first + SNAP, last);
          this.app.newEvent({ date, minutes: a, endMinutes: b });
        } else {
          this.app.newEvent({ date, minutes: Math.floor(first / 30) * 30 });
        }
      };
      col.addEventListener('pointermove', move);
      col.addEventListener('pointerup', up);
      col.addEventListener('pointercancel', up);
    });
  }

  /** Tasks are moments, not stretches: a mark at the hour and a label beside it. */
  taskMarks(col, date, hidden, hour) {
    const tasks = this.app.store.tasksOn(date).filter((t) => !hidden.has(t.calendarId));
    const marks = tasks.map((task) => ({ task, minute: task.hasDueTime ? minuteOfDay(task.dueAt) : DEFAULT_START_MINUTES }))
      .sort((a, b) => a.minute - b.minute);
    const labelMinutes = (22 / hour) * 60;
    const groups = [];
    for (const mark of marks) {
      const last = groups[groups.length - 1];
      if (last && mark.minute - last[0].minute < labelMinutes) last.push(mark);
      else groups.push([mark]);
    }
    for (const group of groups) {
      const { task, minute } = group[0];
      const color = this.app.store.taskColor(task);
      const label = group.length === 1 ? task.title || 'Без названия' : `${group.length} задачи ▾`;
      const mark = h('div', { class: ['taskmark', group.length === 1 && isClosed(task) ? 'closed' : ''], style: { ...calStyle(color), top: `${(minute / 60) * hour}px` } },
        h('div', { class: 'label', title: label, on: { click: (e) => {
          e.stopPropagation();
          if (group.length === 1) this.app.openTask(task);
          else openMenu(e.currentTarget, group.map((m) => ({ label: m.task.title || 'Без названия', hint: minutesText(m.minute), dot: this.app.store.taskColor(m.task), action: () => this.app.openTask(m.task) })));
        } } }, label));
      col.append(mark);
    }
  }
}

