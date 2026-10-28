// The editors inside the record editors: reminders, repetition, colour,
// calendar, alarm options and the picker of several days.

import { h, icon } from './dom.js';
import { chooseFrom, Dialog, field } from './dialog.js';
import {
  normalizedReminders, reminderOffset, reminderRingsAlarm, reminderWithKind, formatReminder, formatDayReminder,
  reminderPresets, dayReminderPresets, toDayReminders, toOffsetReminders, packDayReminder, MAX_REMINDERS,
  dayReminderDays, dayReminderMinute, DEFAULT_START_MINUTES,
} from '../model/reminders.js';
import { Freq, End, MonthlyMode, normalizeRule, describe, weekdayBit } from '../model/recurrence.js';
import { WEEKDAYS_SHORT, MONTHS, capitalize, pluralRu } from '../model/text.js';
import { PALETTE_COLORS, calendarColor } from '../model/records.js';
import { parseTime, minutesText, parts, addDays, startOfWeek, startOfMonth, addMonths, today, dayOfWeek } from '../model/dates.js';
import { TONES } from '../core/tones.js';
import { settings } from './settings.js';

/**
 * The list of reminders of a record. In day mode (a record without a time)
 * every reminder is a day and an hour; switching the mode re-expresses the
 * list against the record's hour instead of throwing it away.
 */
export class ReminderList {
  constructor({ reminders = [], dayMode = false, recordMinute = DEFAULT_START_MINUTES, defaultAlarm = false, onChange = null }) {
    this.list = normalizedReminders(reminders);
    this.dayMode = dayMode;
    this.recordMinute = recordMinute;
    this.defaultAlarm = defaultAlarm;
    this.onChange = onChange;
    this.el = h('div', { class: 'col', style: { gap: '2px' } });
    this.render();
  }

  setDayMode(dayMode, recordMinute) {
    if (dayMode !== this.dayMode) {
      this.list = dayMode ? toDayReminders(this.list, recordMinute) : toOffsetReminders(this.list, this.recordMinute);
    }
    this.dayMode = dayMode;
    this.recordMinute = recordMinute;
    this.render();
  }

  reminders() {
    return normalizedReminders(this.list);
  }

  hasAlarm() {
    return this.list.some(reminderRingsAlarm);
  }

  text(value) {
    return this.dayMode ? formatDayReminder(value) : formatReminder(value);
  }

  render() {
    this.el.replaceChildren();
    this.list.forEach((value, index) => {
      const alarm = reminderRingsAlarm(value);
      this.el.append(h('div', { class: 'reminder-row' },
        h('button', {
          class: ['icon-btn', alarm ? 'on' : ''], title: alarm ? 'Будильник — нажмите, чтобы сделать уведомлением' : 'Уведомление — нажмите, чтобы сделать будильником',
          on: { click: () => { this.list[index] = reminderWithKind(value, !alarm); this.changed(); } },
        }, icon(alarm ? 'alarm' : 'bell')),
        h('button', { class: 'btn flat grow', style: { justifyContent: 'flex-start' }, on: { click: () => this.edit(index) } }, this.text(value)),
        h('button', { class: 'icon-btn', title: 'Убрать', on: { click: () => { this.list.splice(index, 1); this.changed(); } } }, icon('close'))));
    });
    if (this.list.length < MAX_REMINDERS) {
      this.el.append(h('button', { class: 'btn flat', style: { alignSelf: 'flex-start' }, on: { click: () => this.edit(-1) } },
        icon('plus'), 'Добавить напоминание'));
    }
  }

  changed() {
    this.list = normalizedReminders(this.list);
    this.render();
    this.onChange?.();
  }

  async edit(index) {
    const presets = this.dayMode ? dayReminderPresets() : reminderPresets();
    const current = index >= 0 ? reminderOffset(this.list[index]) : undefined;
    const chosen = await chooseFrom({
      title: index >= 0 ? 'Напоминание' : 'Новое напоминание',
      current,
      items: [...presets.map((v) => ({ label: this.text(v), value: v })), { label: 'Своё…', value: 'custom' }],
    });
    if (chosen == null) return;
    let value = chosen;
    if (chosen === 'custom') {
      value = await this.custom(current);
      if (value == null) return;
    }
    const kind = index >= 0 ? reminderRingsAlarm(this.list[index]) : this.defaultAlarm;
    if (index >= 0) this.list[index] = reminderWithKind(value, kind);
    else this.list.push(reminderWithKind(value, kind));
    this.changed();
  }

  /** "За N минут/часов/дней/недель" or, in day mode, "за N дней в HH:MM". */
  custom(current) {
    const amount = h('input', { type: 'number', min: 0, max: 999, value: 1 });
    let result = null;
    if (this.dayMode) {
      const time = h('input', { type: 'time', value: minutesText(current != null ? dayReminderMinute(current) : DEFAULT_START_MINUTES) });
      amount.value = current != null ? dayReminderDays(current) : 1;
      const dialog = new Dialog({ title: 'Своё напоминание', size: 'narrow', sheet: true, saveLabel: 'Готово', onSave: () => {
        const minute = parseTime(time.value);
        if (Number.isNaN(minute)) return false;
        result = packDayReminder(Math.min(30, Math.max(0, +amount.value || 0)), minute);
        return true;
      } });
      dialog.body.append(h('div', { class: 'row wrap' }, 'За', amount, 'дн., в', time));
      return dialog.open().then((ok) => (ok ? result : null));
    }
    const unit = h('select', null, ...[['1', 'минут'], ['60', 'часов'], ['1440', 'дней'], ['10080', 'недель']]
      .map(([v, t]) => h('option', { value: v }, t)));
    if (current != null && current > 0) {
      const units = [10080, 1440, 60, 1];
      const best = units.find((u) => current % u === 0);
      unit.value = String(best);
      amount.value = current / best;
    }
    const dialog = new Dialog({ title: 'Своё напоминание', size: 'narrow', sheet: true, saveLabel: 'Готово', onSave: () => {
      result = Math.max(0, Math.round((+amount.value || 0) * +unit.value));
      return true;
    } });
    dialog.body.append(h('div', { class: 'row wrap' }, 'За', amount, unit));
    return dialog.open().then((ok) => (ok ? result : null));
  }
}

/** The repetition of a record; the seed date shapes the descriptions of the monthly choice. */
export class RecurrenceEditor {
  constructor(rule, seed, onChange = null) {
    this.rule = normalizeRule(structuredClone(rule));
    this.seed = seed;
    this.onChange = onChange;
    this.el = h('div', { class: 'col' });
    this.render();
  }

  setSeed(seed) {
    this.seed = seed;
    this.render();
  }

  value() {
    return normalizeRule(structuredClone(this.rule));
  }

  update(patch) {
    Object.assign(this.rule, patch);
    this.render();
    this.onChange?.();
  }

  render() {
    const r = this.rule;
    const freq = h('select', { on: { change: () => this.update({ freq: +freq.value }) } },
      ...[[0, 'Не повторяется'], [1, 'Каждый день'], [2, 'Каждую неделю'], [3, 'Каждый месяц'], [4, 'Каждый год']]
        .map(([v, t]) => h('option', { value: v, selected: r.freq === v }, t)));
    const rows = [freq];
    if (r.freq !== Freq.None) {
      const unit = ['', ['день', 'дня', 'дней'], ['неделю', 'недели', 'недель'], ['месяц', 'месяца', 'месяцев'], ['год', 'года', 'лет']][r.freq];
      const interval = h('input', { type: 'number', min: 1, max: 99, value: r.interval,
        on: { change: () => this.update({ interval: Math.max(1, Math.min(99, +interval.value || 1)) }) } });
      rows.push(h('div', { class: 'row' }, 'Каждые', interval, pluralRu(r.interval, ...unit)));
      if (r.freq === Freq.Weekly) {
        const seedDow = this.seed ? dayOfWeek(this.seed) : 1;
        const mask = r.weekdays || weekdayBit(seedDow);
        rows.push(h('div', { class: 'weekday-toggles' }, ...WEEKDAYS_SHORT.map((name, i) => {
          const bit = weekdayBit(i + 1);
          return h('button', { class: mask & bit ? 'on' : '', type: 'button', on: { click: () => {
            const next = mask ^ bit;
            this.update({ weekdays: next || bit });
          } } }, name);
        })));
      }
      if (r.freq === Freq.Monthly && this.seed) {
        const p = parts(this.seed);
        const nth = Math.floor((p.d - 1) / 7) + 1;
        const names = ['первый', 'второй', 'третий', 'четвёртый', 'пятый'];
        const weekdayName = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'][dayOfWeek(this.seed) - 1];
        const mode = h('select', { on: { change: () => this.update({ monthlyMode: +mode.value }) } },
          h('option', { value: 0, selected: r.monthlyMode === MonthlyMode.DayOfMonth }, `${p.d}-го числа`),
          h('option', { value: 1, selected: r.monthlyMode === MonthlyMode.WeekdayOfMonth }, `В ${names[nth - 1] || 'последний'} ${weekdayName}`));
        rows.push(mode);
      }
      const end = h('select', { on: { change: () => this.update({ endMode: +end.value, until: +end.value === End.OnDate && !r.until ? addDays(this.seed || today(), 30) : r.until }) } },
        h('option', { value: 0, selected: r.endMode === End.Never }, 'Без конца'),
        h('option', { value: 1, selected: r.endMode === End.AfterCount }, 'Заданное число раз'),
        h('option', { value: 2, selected: r.endMode === End.OnDate }, 'До даты'));
      const endRow = h('div', { class: 'row wrap' }, end);
      if (r.endMode === End.AfterCount) {
        const count = h('input', { type: 'number', min: 1, max: 999, value: r.count,
          on: { change: () => this.update({ count: Math.max(1, +count.value || 1) }) } });
        endRow.append(count, pluralRu(r.count, 'раз', 'раза', 'раз'));
      } else if (r.endMode === End.OnDate) {
        const until = h('input', { type: 'date', value: r.until || '', on: { change: () => this.update({ until: until.value || null }) } });
        endRow.append(until);
      }
      rows.push(endRow);
      if (r.exceptions.length) {
        rows.push(h('div', { class: 'row muted small' }, `Пропущено повторений: ${r.exceptions.length}`,
          h('button', { class: 'btn flat', on: { click: () => this.update({ exceptions: [] }) } }, 'Вернуть все')));
      }
      rows.push(h('div', { class: 'hint muted small' }, describe(this.value())));
    }
    this.el.replaceChildren(...rows);
  }
}

/** Colour swatches; @p allowNone adds "как у календаря" (an empty colour). */
export function colorPicker(value, onChange, { allowNone = false } = {}) {
  let current = value || '';
  const box = h('div', { class: 'swatches' });
  const custom = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(current) ? current : '#4f6bed', title: 'Свой цвет',
    on: { input: () => set(custom.value) } });
  function set(color) {
    current = color;
    render();
    onChange(color);
  }
  function render() {
    box.replaceChildren(
      allowNone ? h('button', { type: 'button', class: ['swatch', 'none', current ? '' : 'on'], title: 'Как у календаря', style: { '--c': 'var(--tile)' }, on: { click: () => set('') } }, icon('close')) : null,
      ...PALETTE_COLORS.map((c) => h('button', { type: 'button', class: ['swatch', current.toLowerCase() === c ? 'on' : ''], style: { '--c': c }, title: c, on: { click: () => set(c) } })),
      custom);
  }
  render();
  box.value = () => current;
  return box;
}

/** A select of the calendars a record may be put in, with the colour beside it. */
export function calendarSelect(store, selectedId, onChange = null, { includeId = '' } = {}) {
  const calendars = store.calendars().filter((c) => store.isCalendarWritable(c.id) || c.id === includeId);
  const dot = h('span', { class: 'dot' });
  const select = h('select', { on: { change: () => { paint(); onChange?.(select.value); } } },
    ...calendars.map((c) => h('option', { value: c.id, selected: c.id === selectedId }, c.name || 'Без названия')));
  function paint() {
    dot.style.setProperty('--cal', calendarColor(store.calendar(select.value)));
  }
  paint();
  const el = h('div', { class: 'row' }, dot, select);
  el.select = select;
  return el;
}

/** The melody, snooze and limit of an alarm of one record. */
export function alarmOptions(record, store) {
  const melody = h('select', null,
    h('option', { value: '' }, 'Как в настройках'),
    ...TONES.map((t) => h('option', { value: `tone:${t.id}` }, t.title)),
    ...store.melodies().map((m) => h('option', { value: `melody:${m.id}` }, m.title || 'Мелодия')),
    h('option', { value: 'none' }, 'Без звука'));
  melody.value = record.alarmMelody || '';
  if (melody.value !== (record.alarmMelody || '')) {
    melody.append(h('option', { value: record.alarmMelody }, 'Мелодия другого устройства'));
    melody.value = record.alarmMelody;
  }
  const snooze = h('select', null, h('option', { value: 0 }, 'Как в настройках'),
    ...[1, 5, 10, 15, 20, 30, 60].map((m) => h('option', { value: m }, `${m} мин`)));
  snooze.value = String(record.snoozeMinutes || 0);
  const limit = h('select', null, ...[0, 1, 2, 3, 5, 10].map((n) => h('option', { value: n }, n ? `${n}` : 'Нельзя')));
  limit.value = String(record.snoozeLimit ?? 3);
  const el = h('div', { class: 'col' },
    field('Мелодия будильника', melody),
    h('div', { class: 'row wrap' }, field('Отложить на', snooze), field('Сколько раз', limit)));
  el.read = () => ({ alarmMelody: melody.value, snoozeMinutes: +snooze.value, snoozeLimit: +limit.value });
  return el;
}

/**
 * Picks one day or several (the copy menu's "Размножить"). Shows a month at a
 * time; resolves to the list of days chosen, or null.
 */
export function pickDays({ title, start, multiple = false, store = null }) {
  let month = startOfMonth(start || today());
  const chosen = new Set(multiple ? [] : [start]);
  const dialog = new Dialog({ title, size: 'narrow', saveLabel: multiple ? 'Готово' : 'Выбрать', onSave: () => chosen.size ? [...chosen].sort() : false });
  const head = h('div', { class: 'row' });
  const grid = h('div', { class: 'datepick' });
  const note = h('div', { class: 'muted small' });
  function render() {
    head.replaceChildren(
      h('button', { class: 'icon-btn', on: { click: () => { month = addMonths(month, -1); render(); } } }, icon('left')),
      h('div', { class: 'grow', style: { textAlign: 'center', fontWeight: 600 } }, `${capitalize(MONTHS[parts(month).m - 1])} ${parts(month).y}`),
      h('button', { class: 'icon-btn', on: { click: () => { month = addMonths(month, 1); render(); } } }, icon('right')));
    const first = startOfWeek(month, settings.get('firstDayOfWeek'));
    const cells = [];
    for (let i = 0; i < 7; ++i) cells.push(h('div', { class: 'wd' }, WEEKDAYS_SHORT[(settings.get('firstDayOfWeek') - 1 + i) % 7]));
    for (let i = 0; i < 42; ++i) {
      const day = addDays(first, i);
      const has = store && (store.occurrencesOn(day).length || store.tasksOn(day).length);
      cells.push(h('button', {
        class: [chosen.has(day) ? 'on' : '', parts(day).m !== parts(month).m ? 'out' : ''],
        style: has ? { fontWeight: 700 } : null,
        on: { click: () => {
          if (multiple) { if (chosen.has(day)) chosen.delete(day); else chosen.add(day); render(); }
          else { chosen.clear(); chosen.add(day); dialog.save(); }
        } },
      }, String(parts(day).d)));
    }
    grid.replaceChildren(...cells);
    note.textContent = multiple ? `Выбрано дней: ${chosen.size}` : '';
  }
  render();
  dialog.body.append(head, grid, note);
  return dialog.open().then((r) => (Array.isArray(r) ? r : null));
}

/** A date and a time as two inputs; .read() -> {date, minutes}. */
export function dateTimeInputs(date, minutes, onChange = null) {
  const d = h('input', { type: 'date', value: date, required: true, on: { change: () => onChange?.() } });
  const t = h('input', { type: 'time', value: minutesText(minutes), step: 300, on: { change: () => onChange?.() } });
  const el = h('div', { class: 'datetime' }, d, t);
  el.dateInput = d;
  el.timeInput = t;
  el.read = () => ({ date: d.value, minutes: parseTime(t.value) });
  el.showTime = (show) => { t.hidden = !show; };
  return el;
}

