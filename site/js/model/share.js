// Shared calendars: the words for modes, rights and links (model/share.cpp).

export const MODES = ['read', 'edit', 'custom'];

export function modeTitle(mode) {
  return mode === 'read' ? 'Чтение' : mode === 'edit' ? 'Редактирование' : 'Настраиваемый';
}

export function modeHint(mode) {
  if (mode === 'read') return 'Все, кто получил доступ, могут только просматривать календарь';
  if (mode === 'edit') return 'Все, кто получил доступ, могут редактировать календарь';
  return 'Доступ даётся на чтение, а право редактировать вы выдаёте каждому отдельно';
}

export function accessTitle(access) {
  return access === 'edit' ? 'Редактирование' : 'Чтение';
}

/** The right a member gets the moment a link of @p mode is accepted. */
export function initialAccess(mode) {
  return mode === 'edit' ? 'edit' : 'read';
}

export const LINK_LIVES = [
  { title: 'Час', seconds: 3600 },
  { title: 'День', seconds: 86400 },
  { title: 'Неделя', seconds: 7 * 86400 },
  { title: 'Месяц', seconds: 30 * 86400 },
  { title: 'Бессрочная', seconds: 0 },
];

/** "Анна (anna)" or just the login. */
export function memberTitle(member) {
  return !member.displayName || member.displayName === member.login
    ? member.login
    : `${member.displayName} (${member.login})`;
}

/** The server as a URL, the way the planner's SyncClient keeps it: "http://host:port". */
function serverUrl(server) {
  const text = (server || '').trim().replace(/\/+$/, '');
  return /^[a-z]+:\/\//i.test(text) ? text : `http://${text}`;
}

/**
 * The planner's link, spelled as its SharePanel spells it:
 * calendar-planner://share?server=<percent-encoded URL>&token=<token>.
 */
export function plannerLink(server, token) {
  return `calendar-planner://share?server=${encodeURIComponent(serverUrl(server))}&token=${encodeURIComponent(token)}`;
}

/** Whether two spellings name one server: "127.0.0.1:8766" is "http://127.0.0.1:8766/". */
export function sameServer(a, b) {
  return serverUrl(a).toLowerCase() === serverUrl(b).toLowerCase();
}

/** The token out of a planner link, a link to this site or a bare token. */
export function tokenFromLink(text) {
  const value = (text || '').trim();
  if (!value) return { token: '', server: '' };
  const query = value.includes('?') ? value.slice(value.indexOf('?') + 1)
    : value.includes('#') ? value.slice(value.indexOf('#') + 1) : '';
  if (query) {
    // "#join=<token>" of this site, "?server=…&token=…" of the planner.
    const params = new URLSearchParams(query.replace(/^\/?join\?/, ''));
    const token = params.get('token') || params.get('join') || '';
    if (token) return { token, server: params.get('server') || '' };
  }
  return /^[A-Za-z0-9_=-]{16,}$/.test(value) ? { token: value, server: '' } : { token: '', server: '' };
}
