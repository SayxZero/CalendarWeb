// Start of the site: who is signed in, the first exchange, the window. The
// site keeps nothing of the account in the browser: the backend lives beside
// the sync server, so the page takes the account from it on every opening and
// holds it in memory only.

import { api, setUnauthorizedHandler, deviceName } from './core/api.js';
import { Store } from './core/store.js';
import { SyncEngine, SyncService } from './core/sync.js';
import { AlarmService } from './core/alarms.js';
import { App } from './ui/app.js';
import { AlarmUi } from './ui/alarmUi.js';
import { signIn } from './ui/signin.js';
import { settings } from './ui/settings.js';
import { applyPalette } from './ui/theme.js';
import { h, clear, icon, asset } from './ui/dom.js';

const root = document.getElementById('app');
let running = null;

function loading(text) {
  clear(root).append(h('div', { class: 'signin' }, h('div', { class: 'muted row' }, h('span', { class: 'spin' }, icon('sync')), text)));
}

/** The server does not answer: say so and let the user try again. */
function unavailable(message) {
  clear(root).append(h('div', { class: 'signin' }, h('div', { class: 'signin-card' },
    h('img', { class: 'logo', src: asset('img/logo.svg'), alt: '' }),
    h('h1', null, 'Сервер недоступен'),
    h('div', { class: 'lead' }, message || 'Сервер синхронизации не отвечает'),
    h('button', { class: 'btn primary', style: { minHeight: '44px' }, on: { click: () => location.reload() } }, 'Повторить'))));
}

async function boot() {
  applyPalette(settings.activePalette(), settings.get('highlightWeekends'));
  loading('Открываем…');
  const config = await api.config();
  if (!config.ok) return unavailable(config.error);
  const serverAddress = config.body.serverAddress;
  const version = config.body.version;
  const me = await api.me();
  if (me.ok) return start(me.body.user, { serverAddress, version });
  if (me.status !== 401) return unavailable(me.error);
  const user = await signIn(root, { serverAddress });
  return start(user, { serverAddress, version });
}

async function start(user, { serverAddress, version }) {
  loading('Загружаем планер…');
  const store = new Store();
  // A planner starts with the seed every device has; the first exchange
  // drops it when the account brings calendars of its own.
  store.ensureSeed();
  const engine = new SyncEngine(store);
  const sync = new SyncService(engine, api, { device: deviceName(), intervalMinutes: settings.get('syncIntervalMinutes') });

  // The account first, the window after: an empty planner flashing up for
  // a moment would look like lost records.
  const first = await sync.start();
  if (sync.state === 'auth') {
    sync.stop();
    const again = await signIn(root, { serverAddress, login: user.login, message: 'Сеанс закончился — войдите снова' });
    return start(again, { serverAddress, version });
  }
  if (!first) {
    sync.stop();
    return unavailable(sync.error);
  }

  const app = new App({
    store, sync, engine, account: user, serverAddress, version,
    onSignOut: async () => {
      // What is still in the journal goes before the session does.
      await sync.syncNow();
      sync.stop();
      alarms.stop();
      await api.logout();
      location.hash = '';
      location.reload();
    },
  });
  const alarms = new AlarmService(store, {
    notify: (hit) => alarmUi.notify(hit),
    ring: (hit) => alarmUi.ring(hit),
  });
  const alarmUi = new AlarmUi(app, alarms);
  running = { app, sync, alarms };

  // The server stopped taking the session: sign in again. The same account
  // carries on with what is in memory; another one starts afresh.
  let asking = false;
  const reSignIn = async () => {
    if (asking) return;
    asking = true;
    sync.stop();
    alarms.stop();
    const again = await signIn(root, { serverAddress, login: user.login, message: 'Сеанс закончился — войдите снова' });
    asking = false;
    if (again.login.toLowerCase() !== user.login.toLowerCase()) {
      running = null;
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
