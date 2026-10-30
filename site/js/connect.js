// The page an MCP client sends the user to: who is asking, the sign in, the answer.
// The request itself travels sealed in the address and only the site server can
// read it (CalendarWebServer, McpOAuth), so what is shown comes from the server,
// not from the address: a link cannot make this page show a name of its own.

const CSRF = { 'X-Requested-With': 'CosmosCalendarWeb' };

const byId = (id) => document.getElementById(id);
const request = new URLSearchParams(location.search).get('request') || '';

function say(text) {
  byId('connect-lead').textContent = text;
}

function showError(text) {
  const box = byId('connect-error');
  box.textContent = text;
  box.hidden = !text;
}

function setBusy(busy) {
  byId('connect-allow').disabled = busy;
  byId('connect-deny').disabled = busy;
}

/** Sends the answer; on success the browser goes back to the client. */
async function answer(body) {
  setBusy(true);
  showError('');
  try {
    const response = await fetch('/oauth/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...CSRF },
      body: JSON.stringify({ request, ...body }),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.redirect) {
      say('Готово. Можно вернуться к агенту.');
      byId('connect-form').hidden = true;
      location.href = payload.redirect;
      return;
    }
    showError(payload?.message || `Ошибка сервера (${response.status})`);
  } catch {
    showError('Нет связи с сайтом');
  }
  setBusy(false);
}

async function start() {
  let description = null;
  try {
    const response = await fetch(`/oauth/request?request=${encodeURIComponent(request)}`, { cache: 'no-store' });
    description = await response.json().catch(() => null);
    if (!response.ok) {
      say(description?.message || 'Запрос не найден: начните подключение в агенте заново');
      return;
    }
  } catch {
    say('Нет связи с сайтом');
    return;
  }

  byId('connect-client').textContent = description.client_name;
  byId('connect-host').textContent = description.redirect_host;
  byId('connect-lead').hidden = true;
  byId('connect-form').hidden = false;
  byId('connect-login').focus();

  byId('connect-form').addEventListener('submit', (event) => {
    event.preventDefault();
    answer({
      login: byId('connect-login').value.trim(),
      password: byId('connect-password').value,
      writes: byId('connect-writes').checked,
      // Times in a planner have no zone, so the agent has to be told what the
      // user's clock says: this is the one moment the browser can tell.
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    });
  });
  byId('connect-deny').addEventListener('click', () => answer({ deny: true }));
}

start();
