// Settings of this browser: what the planner keeps in settings.ini of one
// device. The look and the habits of the hand stay here; the records go to
// the account.

import { builtInPalettes, paletteFromJson } from '../model/palette.js';

const KEY = 'cosmos.settings';

export const DEFAULTS = {
  firstDayOfWeek: 1,
  dayStartHour: 8,
  hourHeight: 48,
  weekDayCount: 7,
  monthWeeks: 6,
  defaultEventDuration: 60,
  defaultEventReminder: 0,
  defaultTaskReminder: -1,
  defaultReminderType: 'notification',
  notificationsEnabled: true,
  alarmMelody: 'tone:classic',
  alarmRisingVolume: true,
  alarmDurationMinutes: 5,
  snoozeMinutes: 10,
  showWeekNumbers: false,
  highlightWeekends: true,
  filterBarSingleRow: false,
  tasksInCalendar: false,
  doneFilter: 'today',
  taskGrouping: 'due',
  agendaDays: 30,
  agendaShowsTasks: true,
  agendaShowsDone: false,
  lastView: 'month',
  lastCalendarId: '',
  paletteId: 'classic',
  customPalettes: [],
  syncIntervalMinutes: 15,
  pickerShowsRecords: true,
};

class Settings extends EventTarget {
  constructor() {
    super();
    this.values = { ...DEFAULTS };
    try {
      Object.assign(this.values, JSON.parse(localStorage.getItem(KEY) || '{}'));
    } catch {
      // A private window or blocked storage: the defaults it is.
    }
    if (matchMedia?.('(prefers-color-scheme: dark)').matches && !localStorage.getItem(KEY)) {
      this.values.paletteId = 'classic-dark';
    }
  }

  get(key) {
    return this.values[key];
  }

  set(key, value, { quiet = false } = {}) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.values));
    } catch {
      // Not kept past this page; nothing else to do.
    }
    if (!quiet) this.dispatchEvent(new CustomEvent('change', { detail: { key, value } }));
  }

  palettes() {
    const own = (this.values.customPalettes || []).map((p) => paletteFromJson(p, builtInPalettes()[0]));
    return [...builtInPalettes(), ...own];
  }

  activePalette() {
    const all = this.palettes();
    return all.find((p) => p.id === this.values.paletteId) || all[0];
  }
}

export const settings = new Settings();
