// Requests to the site server, which passes /api/* on to the sync server. The
// session key never reaches this page: it lives in an HttpOnly cookie, and
// every request that changes something carries the header the site server
// demands (CalendarWebServer, ApiProxy).

const CSRF_HEADER = 'X-Requested-With';
const CSRF_VALUE = 'CosmosCalendarWeb';

let onUnauthorized = () => {};

/** Called when the server stopped accepting the session: the page asks to sign in again. */
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

/**
 * One request. Resolves to {ok, status, body, error, retryAfter}; never
 * rejects - a network failure is {ok: false, status: 0}.
 */
export async function request(method, path, body = undefined, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      headers[CSRF_HEADER] = CSRF_VALUE;
    }
    const response = await fetch(path, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const result = {
      ok: response.ok,
      status: response.status,
      body: payload,
      error: response.ok ? '' : payload?.message || `Ошибка сервера (${response.status})`,
      code: payload?.error || '',
      retryAfter: Number(response.headers.get('Retry-After')) || 0,
    };
    if (response.status === 401 && !path.endsWith('/login') && !path.endsWith('/register')) onUnauthorized(result);
    return result;
  } catch (failure) {
    const aborted = failure?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      body: null,
      code: aborted ? 'timeout' : 'network',
      error: aborted ? 'Сервер не ответил вовремя' : 'Нет связи с сайтом',
      retryAfter: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  config: () => request('GET', '/web/config'),
  ping: () => request('GET', '/api/ping', undefined, { timeoutMs: 5000 }),
  me: () => request('GET', '/api/me'),
  login: (login, password, device) => request('POST', '/api/login', { login, password, device }),
  register: (login, password, displayName, device) =>
    request('POST', '/api/register', { login, password, displayName, device }),
  logout: () => request('POST', '/api/logout', {}),
  profile: (displayName) => request('POST', '/api/profile', { displayName }),
  password: (oldPassword, newPassword) => request('POST', '/api/password', { oldPassword, newPassword }),
  sync: (body) => request('POST', '/api/sync', body, { timeoutMs: 60000 }),
  record: (kind, id, timeoutMs = 2500) =>
    request('GET', `/api/record?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`, undefined, { timeoutMs }),
  share: (calendar) => request('GET', `/api/share?calendar=${encodeURIComponent(calendar)}`),
  shareConfigure: (calendar, enabled, mode) => request('POST', '/api/share', { calendar, enabled, mode }, { timeoutMs: 60000 }),
  shareMember: (calendar, login, access) => request('POST', '/api/share/member', { calendar, login, access }, { timeoutMs: 60000 }),
  shareRemove: (calendar, login) => request('POST', '/api/share/member', { calendar, login, remove: true }, { timeoutMs: 60000 }),
  shareLink: (calendar, singleUse, lifeSeconds) =>
    request('POST', '/api/share/link', { calendar, singleUse, lifeSeconds }, { timeoutMs: 60000 }),
  sharePeek: (token) => request('GET', `/api/share/peek?token=${encodeURIComponent(token)}`),
  shareJoin: (token, twinId) => request('POST', '/api/share/join', { token, twinId }, { timeoutMs: 60000 }),
  shareLeave: (twinId) => request('POST', '/api/share/leave', { twinId }, { timeoutMs: 60000 }),
};

/** "Сайт · Firefox на Windows": the name the server shows for this session. */
export function deviceName() {
  const ua = navigator.userAgent || '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /YaBrowser/.test(ua) ? 'Яндекс Браузер'
    : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'браузер';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `Сайт · ${browser} на ${os}` : `Сайт · ${browser}`;
}
