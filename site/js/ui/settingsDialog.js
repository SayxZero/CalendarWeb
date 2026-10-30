// «Настройки»: the look, the calendar, tasks, reminders, the account and the
// data, in sections as the planner's PrefRow screens. What belongs to this
// browser (settings.js) changes at once; the account's things go through the
// server.

import { h, icon, toast, download, pickFile } from './dom.js';
import { Dialog, field, toggle, confirm, promptText } from './dialog.js';
import { settings } from './settings.js';
import { FIELDS, paletteToJson, paletteFromJson } from '../model/palette.js';
import { formatReminder, reminderPresets } from '../model/reminders.js';
import { TONES, Player, prepareMelody } from '../core/tones.js';
import { api, agentSessions } from '../core/api.js';
import { manageCalendars, importCalendarFile, exportCalendar } from './calendars.js';
import { newId, normalize, KINDS, toData } from '../model/records.js';
import { now, dateOf } from '../model/dates.js';
import { formatDuration } from '../model/text.js';

function setting(label, hint, control) {
  return h('div', { class: 'setting' }, h('div', { class: 'text' }, label, hint ? h('span', { class: 'hint' }, hint) : null), control);
}

function select(key, options, onChange = null) {
  const el = h('select', { on: { change: () => { settings.set(key, typeof options[0][0] === 'number' ? +el.value : el.value); onChange?.(); } } },
    ...options.map(([value, title]) => h('option', { value, selected: settings.get(key) === value }, title)));
  return el;
}

function check(key, onChange = null) {
  return toggle('', settings.get(key), (on) => { settings.set(key, on); onChange?.(); });
}

export function openSettings(app, section = 'look') {
  const dialog = new Dialog({ title: 'Настройки', size: 'wide', closeLabel: 'Закрыть' });
  const sections = [
    ['look', 'Вид'], ['calendar', 'Календарь'], ['tasks', 'Задачи'], ['reminders', 'Напоминания'],
    ['account', 'Аккаунт'], ['agents', 'ИИ-агенты'], ['data', 'Данные'], ['about', 'О сайте'],
  ];
  const nav = h('div', { class: 'settings-nav' });
  const body = h('div', { class: 'settings-section' });
  const show = (key) => {
    section = key;
    nav.replaceChildren(...sections.map(([k, t]) => h('button', { class: ['btn', k === key ? 'primary' : ''], on: { click: () => show(k) } }, t)));
    body.replaceChildren(...build[key]());
  };
  const rerender = () => app.render();

  const build = {
    look: () => [
      h('h3', null, 'Палитра'),
      paletteGrid(app, () => show('look')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', on: { click: () => editPalette(app, () => show('look')) } }, icon('edit'), 'Изменить палитру…'),
        h('button', { class: 'btn', on: { click: async () => importPalette(app, () => show('look')) } }, icon('import'), 'Загрузить из файла…'),
        h('button', { class: 'btn', on: { click: () => {
          const palette = settings.activePalette();
          download(`${palette.name}.json`, JSON.stringify(paletteToJson(palette), null, 2), 'application/json');
        } } }, icon('download'), 'Сохранить в файл')),
      setting('Подсвечивать выходные', '', check('highlightWeekends', () => app.applyTheme())),
      setting('Номера недель', 'Слева от месяца', check('showWeekNumbers', rerender)),
      setting('Панель календарей в одну строку', 'Кружки вместо названий', check('filterBarSingleRow', rerender)),
    ],
    calendar: () => [
      setting('Первый день недели', '', select('firstDayOfWeek', [[1, 'Понедельник'], [7, 'Воскресенье'], [6, 'Суббота']], rerender)),
      setting('Недель в месяце', '', select('monthWeeks', [[4, '4'], [5, '5'], [6, '6']], rerender)),
      setting('День начинается в', 'Куда прокручиваются неделя и день', select('dayStartHour', Array.from({ length: 13 }, (_, i) => [i, `${String(i).padStart(2, '0')}:00`]), rerender)),
      setting('Высота часа', '', select('hourHeight', [[36, 'Мелко'], [48, 'Обычно'], [64, 'Крупно'], [80, 'Очень крупно']], rerender)),
      setting('Длительность нового события', '', select('defaultEventDuration', [15, 30, 45, 60, 90, 120, 180].map((m) => [m, formatDuration(m)]))),
      setting('Задачи в сетке', 'Месяц, неделя и день показывают задачи', check('tasksInCalendar', rerender)),
      h('button', { class: 'btn', style: { alignSelf: 'flex-start' }, on: { click: () => manageCalendars(app) } }, icon('calendars'), 'Календари…'),
    ],
    tasks: () => [
      setting('Группировка списка', '', select('taskGrouping', [['due', 'По сроку'], ['status', 'По статусу']], rerender)),
      setting('Выполненные задачи', '', select('doneFilter', [['none', 'Скрыты'], ['today', 'Выполненные сегодня'], ['all', 'Все']], rerender)),
      setting('Напоминание о новой задаче', '', select('defaultTaskReminder', [[-1, 'Без напоминания'], ...reminderPresets().map((m) => [m, formatReminder(m)])])),
      setting('Повестка показывает задачи', '', check('agendaShowsTasks', rerender)),
    ],
    reminders: () => [
      setting('Уведомления браузера', Notification?.permission === 'denied' ? 'Запрещены в браузере — разрешите их для этого сайта' : 'Пока вкладка сайта открыта',
        toggle('', settings.get('notificationsEnabled'), async (on) => {
          settings.set('notificationsEnabled', on);
          if (on && globalThis.Notification && Notification.permission === 'default') await Notification.requestPermission();
          show('reminders');
        })),
      setting('Напоминание о новом событии', '', select('defaultEventReminder', [[-1, 'Без напоминания'], ...reminderPresets().map((m) => [m, formatReminder(m)])])),
      setting('Как приходит новое напоминание', '', select('defaultReminderType', [['notification', 'Уведомлением'], ['alarm', 'Будильником']])),
      setting('Мелодия будильника', '', h('div', { class: 'row' }, melodySelect(app), h('button', { class: 'icon-btn', title: 'Прослушать', on: { click: () => previewMelody(app, settings.get('alarmMelody')) } }, icon('play')))),
      setting('Нарастающая громкость', 'Первые полминуты от тихой до полной', check('alarmRisingVolume')),
      setting('Будильник звонит', '', select('alarmDurationMinutes', [[1, '1 минуту'], [3, '3 минуты'], [5, '5 минут'], [10, '10 минут']])),
      setting('Отложить будильник на', '', select('snoozeMinutes', [[1, '1 мин'], [5, '5 мин'], [10, '10 мин'], [15, '15 мин'], [30, '30 мин']])),
      h('button', { class: 'btn', style: { alignSelf: 'flex-start' }, on: { click: () => manageMelodies(app) } }, icon('music'), 'Мои мелодии…'),
      h('div', { class: 'muted small' }, 'Сайт напоминает, пока его вкладка открыта. Будильник, выключенный здесь, не зазвонит и на других устройствах аккаунта.'),
    ],
    account: () => accountSection(app, dialog),
    agents: () => agentsSection(),
    data: () => [
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', on: { click: () => importCalendarFile(app) } }, icon('import'), 'Импорт ICS…'),
        h('button', { class: 'btn', on: { click: () => {
          for (const calendar of app.store.calendars()) exportCalendar(app.store, calendar.id);
        } } }, icon('download'), 'Экспорт всех календарей в ICS')),
      h('div', { class: 'muted small' }, 'Один календарь — один файл .ics; повторный импорт того же файла наполняет тот же календарь.'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', on: { click: () => exportBackup(app) } }, icon('download'), 'Резервная копия (JSON)'),
        h('button', { class: 'btn', on: { click: () => importBackup(app) } }, icon('upload'), 'Загрузить копию…')),
      h('div', { class: 'muted small' }, 'Резервная копия — того же формата, что «Настройки → Данные» планера. Загруженная копия добавляется к аккаунту и уезжает на сервер.'),
    ],
    about: () => [
      h('div', null, h('b', null, 'Космос календарь — сайт'), ` ${app.version || ''}`),
      h('div', { class: 'muted' }, `Сервер синхронизации: ${app.serverAddress || '—'}`),
      h('div', { class: 'muted small' }, 'Сайт — ещё одно устройство вашего аккаунта: те же записи, что в планере на компьютере и телефоне. Записи берутся с сервера при каждом открытии страницы, в браузере не хранятся.'),
      h('div', { class: 'muted small' }, 'Клавиши: ← → — период, T — сегодня, N — новое событие, / — поиск.'),
    ],
  };

  dialog.body.append(nav, body);
  show(section);
  return dialog.open();
}

function paletteGrid(app, refresh) {
  const current = settings.get('paletteId');
  return h('div', { class: 'palette-grid' }, ...settings.palettes().map((p) => h('button', {
    class: ['palette-tile', p.id === current ? 'on' : ''],
    style: { '--pw': p.colors.window, '--ps': p.colors.surface, '--pa': p.colors.accent, '--pt': p.colors.text },
    on: { click: () => { settings.set('paletteId', p.id); app.applyTheme(); refresh(); } },
  }, h('div', { class: 'pv' }, h('div', { class: 's' }), h('div', { class: 'm' })), h('div', { class: 'pn' }, p.name))));
}

/** Every colour of the palette by its name; a built-in one is copied first. */
async function editPalette(app, refresh) {
  let palette = structuredClone(settings.activePalette());
  if (palette.builtIn) {
    const name = await promptText({ title: 'Своя палитра', label: 'Название', value: `${palette.name} (моя)` });
    if (!name) return;
    palette = { ...palette, id: newId(), name, builtIn: false };
  }
  const dialog = new Dialog({ title: palette.name, size: 'wide', onSave: () => {
    const own = (settings.get('customPalettes') || []).filter((p) => p.id !== palette.id);
    own.push(paletteToJson(palette));
    settings.set('customPalettes', own);
    settings.set('paletteId', palette.id);
    app.applyTheme();
    refresh();
    return true;
  } });
  const dark = toggle('Тёмная', palette.dark, (on) => { palette.dark = on; });
  let lastSection = '';
  dialog.body.append(dark);
  for (const [key, title, sectionTitle] of FIELDS) {
    if (sectionTitle !== lastSection) {
      dialog.body.append(h('h3', null, sectionTitle));
      lastSection = sectionTitle;
    }
    const input = h('input', { type: 'color', value: palette.colors[key], on: { input: () => { palette.colors[key] = input.value; } } });
    dialog.body.append(setting(title, '', input));
  }
  if (!settings.activePalette().builtIn) {
    dialog.addButton('Удалить палитру', async () => {
      if (!await confirm({ title: 'Удалить палитру?', text: palette.name, ok: 'Удалить', danger: true })) return;
      settings.set('customPalettes', (settings.get('customPalettes') || []).filter((p) => p.id !== palette.id));
      settings.set('paletteId', 'classic');
      app.applyTheme();
      refresh();
      dialog.close(null);
    }, { danger: true, iconName: 'trash' });
  }
  await dialog.open();
}

async function importPalette(app, refresh) {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  try {
    const object = JSON.parse(await file.text());
    if (object.format !== 'calendar-planner-palette') throw new Error('Это не файл палитры планера');
    const palette = paletteFromJson(object, settings.palettes()[0]);
    if (settings.palettes().some((p) => p.id === palette.id && p.builtIn)) palette.id = newId();
    const own = (settings.get('customPalettes') || []).filter((p) => p.id !== palette.id);
    own.push(paletteToJson(palette));
    settings.set('customPalettes', own);
    settings.set('paletteId', palette.id);
    app.applyTheme();
    refresh();
  } catch (failure) {
    toast(failure.message || 'Файл не прочитан');
  }
}

function melodySelect(app) {
  const options = [...TONES.map((t) => [`tone:${t.id}`, t.title]), ...app.store.melodies().map((m) => [`melody:${m.id}`, m.title]), ['none', 'Без звука']];
  return select('alarmMelody', options);
}

const preview = new Player();

function previewMelody(app, value) {
  preview.play(value, { store: app.store, loop: false, seconds: 6 });
}

/** Melodies of the account: they travel with it, so an alarm rings the same everywhere. */
export function manageMelodies(app) {
  const store = app.store;
  const dialog = new Dialog({ title: 'Мои мелодии', closeLabel: 'Закрыть' });
  const list = h('div', { class: 'col', style: { gap: '2px' } });
  let playing = '';
  const render = () => {
    const melodies = store.melodies();
    list.replaceChildren(...(melodies.length ? melodies.map((m) => h('div', { class: 'line' },
      h('button', { class: 'icon-btn', title: playing === m.id ? 'Остановить' : 'Прослушать', on: { click: () => {
        if (playing === m.id) { preview.stop(); playing = ''; } else { preview.play(`melody:${m.id}`, { store, loop: false, seconds: 120 }); playing = m.id; }
        render();
      } } }, icon(playing === m.id ? 'stop' : 'play')),
      h('div', { class: 'body' }, h('div', { class: 'title' }, m.title || 'Мелодия'),
        h('div', { class: 'sub' }, `${m.format.toUpperCase()} · ${Math.round(m.durationMs / 1000)} с · ${Math.round((m.data.length * 3) / 4 / 1024)} КБ`)),
      h('button', { class: 'icon-btn', title: 'Удалить', on: { click: async () => {
        if (await confirm({ title: 'Удалить мелодию?', text: `Записи, которые звонили «${m.title}», зазвонят мелодией из настроек`, ok: 'Удалить', danger: true })) store.removeMelody(m.id);
      } } }, icon('trash'))))
      : [h('div', { class: 'empty' }, 'Своих мелодий нет')]));
  };
  render();
  const unsubscribe = store.subscribe(render);
  dialog.addButton('Добавить…', async () => {
    const file = await pickFile('audio/*');
    if (!file) return;
    toast('Читаем файл…');
    try {
      const prepared = await prepareMelody(file);
      store.saveMelody({ title: file.name.replace(/\.[^.]+$/, ''), ...prepared, createdAt: now() });
      toast('Мелодия добавлена');
    } catch (failure) {
      toast(failure.message);
    }
  }, { iconName: 'plus' });
  dialog.body.append(list, h('div', { class: 'muted small' }, 'Файл обрезается до двух минут и хранится в аккаунте целиком.'));
  return dialog.open().finally(() => { unsubscribe(); preview.stop(); });
}

function accountSection(app, dialog) {
  const user = app.account || {};
  return [
    h('div', { class: 'row' }, h('span', { class: 'avatar' }, (user.displayName || user.login || '?')[0].toUpperCase()),
      h('div', null, h('div', null, h('b', null, user.displayName || user.login)), h('div', { class: 'muted small' }, `${user.login} · ${app.serverAddress}`))),
    setting('Синхронизация', app.sync?.lastSync ? `Последняя: ${app.sync.lastSync.replace('T', ' ').slice(0, 16)}` : '',
      h('button', { class: 'btn', on: { click: () => app.sync?.syncNow() } }, icon('sync'), 'Сейчас')),
    setting('Как часто', '', select('syncIntervalMinutes', [[5, 'Каждые 5 минут'], [15, 'Каждые 15 минут'], [30, 'Каждые 30 минут'], [60, 'Каждый час']], () => app.sync?.setInterval(settings.get('syncIntervalMinutes')))),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', on: { click: () => changeName(app) } }, icon('user'), 'Изменить имя…'),
      h('button', { class: 'btn', on: { click: () => changePassword() } }, icon('lock'), 'Сменить пароль…')),
    h('button', { class: 'btn danger', style: { alignSelf: 'flex-start' }, on: { click: () => { dialog.close(null); app.signOut(); } } }, icon('logout'), 'Выйти из аккаунта'),
  ];
}

/** A moment of the server, which keeps them in UTC, as the clock on this device shows it. */
function sessionTime(iso) {
  const moment = new Date(iso);
  return Number.isNaN(moment.getTime()) ? '—' : moment.toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** The agents connected to the account: asked of the server every time, none of it is kept here. */
function agentsSection() {
  const list = h('div', { class: 'col', style: { gap: '2px' } }, h('div', { class: 'muted small' }, 'Загружаем список…'));
  const load = async () => {
    const result = await api.sessions();
    if (!result.ok) {
      list.replaceChildren(h('div', { class: 'error' }, result.error));
      return;
    }
    const agents = agentSessions(result.body?.sessions);
    list.replaceChildren(...(agents.length ? agents.map(row) : [h('div', { class: 'empty' }, 'Сейчас ни один агент не подключён')]));
  };
  const disconnect = async (agent) => {
    if (!await confirm({ title: 'Отключить агента?', text: `«${agent.name}» потеряет доступ к аккаунту при следующем же вызове. Подключить его снова можно будет только с паролем.`, ok: 'Отключить', danger: true })) return;
    const result = await api.revokeSession(agent.id);
    // Not found means it has ended already, and that is what was asked for.
    if (result.ok || result.status === 404) toast(`Агент «${agent.name}» отключён`);
    else toast(result.error);
    await load();
  };
  const row = (agent) => h('div', { class: 'line' },
    h('div', { class: 'body', style: { cursor: 'default' } },
      h('div', { class: 'title' }, agent.name || 'ИИ-агент'),
      h('div', { class: 'sub' }, h('span', null, `Подключён: ${sessionTime(agent.createdAt)}`), h('span', null, `Последний запрос: ${sessionTime(agent.lastUsedAt)}`))),
    h('button', { class: 'btn danger', on: { click: () => disconnect(agent) } }, 'Отключить'));
  load();
  return [
    h('div', { class: 'muted small' }, 'Агенты, вошедшие в ваш аккаунт со страницы подключения. Правки, которые агент уже сделал, останутся.'),
    list,
  ];
}

async function changeName(app) {
  const name = await promptText({ title: 'Имя', label: 'Как вас показывать', value: app.account?.displayName || '' });
  if (name == null) return;
  const result = await api.profile(name.trim());
  if (!result.ok) return toast(result.error);
  app.account = result.body.user;
  app.renderChrome();
  toast('Имя изменено');
}

async function changePassword() {
  const oldPassword = h('input', { type: 'password', autocomplete: 'current-password' });
  const newPassword = h('input', { type: 'password', autocomplete: 'new-password' });
  const again = h('input', { type: 'password', autocomplete: 'new-password' });
  const error = h('div', { class: 'error' });
  const dialog = new Dialog({ title: 'Смена пароля', size: 'narrow', onSave: async () => {
    if (newPassword.value.length < 6) { error.textContent = 'Пароль — не короче 6 символов'; return false; }
    if (newPassword.value !== again.value) { error.textContent = 'Пароли не совпадают'; return false; }
    const result = await api.password(oldPassword.value, newPassword.value);
    if (!result.ok) { error.textContent = result.error; return false; }
    toast('Пароль изменён — другие устройства попросят войти снова');
    return true;
  } });
  dialog.body.append(field('Текущий пароль', oldPassword), field('Новый пароль', newPassword), field('Ещё раз', again), error);
  await dialog.open();
}

/** The planner's backup: format calendar-planner-backup, version 11. */
function exportBackup(app) {
  const store = app.store;
  const all = (kind) => [...store.maps[kind].values()].map((r) => toData(kind, r));
  const backup = {
    format: 'calendar-planner-backup', version: 11, createdAt: now(),
    calendars: all('calendar'), events: all('event'), tasks: all('task'), completions: all('completion'),
    melodies: all('melody'), habits: all('habit'), habitMarks: all('habitmark'), reminders: all('reminder'),
  };
  download(`planner-backup-${dateOf(now())}.json`, JSON.stringify(backup, null, 2), 'application/json');
}

async function importBackup(app) {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  let root;
  try {
    root = JSON.parse(await file.text());
  } catch {
    return toast('Ошибка разбора JSON');
  }
  if (root?.format !== 'calendar-planner-backup') return toast('Это не резервная копия планировщика');
  const lists = { calendar: root.calendars, event: root.events, task: root.tasks, completion: root.completions,
    melody: root.melodies, habit: root.habits, habitmark: root.habitMarks, reminder: root.reminders };
  const records = [];
  for (const kind of KINDS) {
    for (const data of lists[kind] || []) {
      const record = normalize(kind, data);
      if (record) records.push({ kind, record });
    }
  }
  if (!await confirm({ title: 'Загрузить копию?', text: `Записей в копии: ${records.length}. Они добавятся к аккаунту (одинаковые заменятся) и уедут на сервер.`, ok: 'Загрузить' })) return;
  app.store.importAll(records);
  toast(`Загружено записей: ${records.length}`);
}
