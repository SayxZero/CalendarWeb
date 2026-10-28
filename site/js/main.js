// Start of the site: who is signed in, the account's copy in this browser,
// the exchange with the server, the window.

import { api, setUnauthorizedHandler, deviceName } from './core/api.js';
import { Persist, MemoryMeta } from './core/persist.js';
import { Store } from './core/store.js';
import { SyncEngine, SyncService } from './core/sync.js';
import { AlarmService } from './core/alarms.js';
import { App } from './ui/app.js';
import { AlarmUi } from './ui/alarmUi.js';
import { signIn } from './ui/signin.js';
import { settings } from './ui/settings.js';
import { applyPalette } from './ui/theme.js';
import { h, clear, icon } from './ui/dom.js';

const LAST_LOGIN = 'cosmos.lastLogin';
const root = document.getElementById('app');
let running = null;

function remember(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Without storage the site still works, it only forgets between visits.
  }
}

function recall(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function loading(text) {
  clear(root).append(h('div', { class: 'signin' }, h('div', { class: 'muted row' }, h('span', { class: 'spin' }, icon('sync')), text)));
}

async function boot() {
  applyPalette(settings.activePalette(), settings.get('highlightWeekends'));
  loading('Открываем…');
  const config = await api.config();
  const serverAddress = config.ok ? config.body.serverAddress : '';
  const version = config.ok ? config.body.version : '';
  const me = await api.me();
  if (me.ok) return start(me.body.user, { serverAddress, version });
  const last = recall(LAST_LOGIN);
  if (me.status !== 401 && last) {
    // No server, but this browser keeps a copy: work with it, sync later.
    return start({ login: last, displayName: recall(`${LAST_LOGIN}.name`) || last }, { serverAddress, version, offline: true });
  }
  const user = await signIn(root, { serverAddress, login: last || '', message: me.status && me.status !== 401 ? 'Сервер синхронизации недоступен' : '' });
  return start(user, { serverAddress, version });
}

async function start(user, { serverAddress, version, offline = false }) {
  const previous = recall(LAST_LOGIN);
  if (previous && previous.toLowerCase() !== user.login.toLowerCase()) await Persist.remove(previous);
  remember(LAST_LOGIN, user.login);
  remember(`${LAST_LOGIN}.name`, user.displayName || '');
  loading('Загружаем планер…');

  const persist = await Persist.open(user.login);
  const store = new Store();
  if (persist) {
    store.load(await persist.load());
    store.onWrite = (kind, id, record) => persist.writeRecord(kind, id, record);
    store.onJournal = (key, entry) => persist.writeJournal(key, entry);
    store.onMeta = (key, value) => persist.setMeta(key, value);
  }
  // A planner that has never synced starts with the seed every device has;
  // the first exchange drops it when the account brings calendars of its own.
  store.ensureSeed();
  const meta = persist ? { get: (k) => persist.getMeta(k), set: (k, v) => persist.setMeta(k, v) } : new MemoryMeta();
  const engine = new SyncEngine(store, meta);
  const sync = new SyncService(engine, api, { device: deviceName(), intervalMinutes: settings.get('syncIntervalMinutes') });

  const app = new App({
    store, sync, engine, account: user, serverAddress, version, offline,
    onSignOut: async () => {
      sync.stop();
      alarms.stop();
      await api.logout();
      persist?.close();
      await Persist.remove(user.login);
      remember(LAST_LOGIN, null);
      location.hash = '';
      location.reload();
    },
  });
  const alarms = new AlarmService(store, {
    notify: (hit) => alarmUi.notify(hit),
    ring: (hit) => alarmUi.ring(hit),
  });
  const alarmUi = new AlarmUi(app, alarms);
  running = { app, sync, alarms, persist };

  // The server stopped taking the session: sign in again, the copy stays.
  let asking = false;
  const reSignIn = async () => {
    if (asking) return;
    asking = true;
    sync.stop();
    alarms.stop();
    const again = await signIn(root, { serverAddress, login: user.login, message: 'Сеанс закончился — войдите снова' });
    asking = false;
    if (again.login.toLowerCase() !== user.login.toLowerCase()) {
      persist?.close();
      return start(again, { serverAddress, version });
    }
    app.account = again;
    app.mount(root);
    sync.start();
    alarms.start();
  };
  app.onAuthLost = reSignIn;
  setUnauthorizedHandler(() => { if (running?.app === app) reSignIn(); });

  app.mount(root);
  sync.start();
  alarms.start();
  if (globalThis.Notification && Notification.permission === 'default' && settings.get('notificationsEnabled')) {
    // Asked on the first touch, not on load: browsers ignore a request nobody asked for.
    document.addEventListener('pointerdown', () => Notification.requestPermission().catch(() => {}), { once: true });
  }
}

boot().catch((failure) => {
  console.error(failure);
  clear(root).append(h('div', { class: 'signin' }, h('div', { class: 'signin-card' },
    h('h1', null, 'Что-то пошло не так'), h('div', { class: 'error' }, String(failure?.message || failure)),
    h('button', { class: 'btn primary', on: { click: () => location.reload() } }, 'Обновить страницу'))));
});
