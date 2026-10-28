// Sign in and sign up: the accounts of the sync server, the same as in the
// planner's account panel.

import { h, clear } from './dom.js';
import { field } from './dialog.js';
import { api, deviceName } from '../core/api.js';

/** Shows the form in @p root; resolves to the account once the server let it in. */
export function signIn(root, { serverAddress = '', login = '', message = '' } = {}) {
  return new Promise((resolve) => {
    let mode = 'login';
    const loginInput = h('input', { type: 'text', value: login, autocomplete: 'username', autocapitalize: 'off', spellcheck: false, placeholder: 'Логин' });
    const password = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Пароль' });
    const again = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Пароль ещё раз' });
    const name = h('input', { type: 'text', autocomplete: 'name', placeholder: 'Как вас показывать (необязательно)' });
    const error = h('div', { class: 'error', attrs: { role: 'alert' } }, message);
    const submit = h('button', { class: 'btn primary', type: 'submit', style: { minHeight: '44px' } });
    const switcher = h('button', { class: 'btn flat', type: 'button', on: { click: () => { mode = mode === 'login' ? 'register' : 'login'; paint(); } } });
    const extra = h('div', { class: 'col' });

    function paint() {
      submit.textContent = mode === 'login' ? 'Войти' : 'Создать аккаунт';
      switcher.textContent = mode === 'login' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти';
      password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
      extra.replaceChildren(...(mode === 'register' ? [field('Ещё раз', again), field('Имя', name)] : []));
      error.textContent = '';
    }

    const form = h('form', { class: 'signin-card', on: { submit: async (e) => {
      e.preventDefault();
      error.textContent = '';
      const loginValue = loginInput.value.trim();
      if (!loginValue || !password.value) {
        error.textContent = 'Введите логин и пароль';
        return;
      }
      if (mode === 'register') {
        if (!/^[A-Za-z0-9._@-]{3,64}$/.test(loginValue)) {
          error.textContent = 'Логин — от 3 до 64 символов: латиница, цифры и . _ @ -';
          return;
        }
        if (password.value.length < 6) {
          error.textContent = 'Пароль — не короче 6 символов';
          return;
        }
        if (password.value !== again.value) {
          error.textContent = 'Пароли не совпадают';
          return;
        }
      }
      submit.disabled = true;
      const result = mode === 'login'
        ? await api.login(loginValue, password.value, deviceName())
        : await api.register(loginValue, password.value, name.value.trim(), deviceName());
      submit.disabled = false;
      if (!result.ok) {
        error.textContent = result.status === 0 || result.status === 502 ? 'Сервер синхронизации недоступен' : result.error;
        return;
      }
      password.value = '';
      again.value = '';
      resolve(result.body.user);
    } } },
    h('img', { class: 'logo', src: 'img/logo.svg', alt: '' }),
    h('h1', null, 'Космос календарь'),
    h('div', { class: 'lead' }, 'Войдите в аккаунт сервера синхронизации — здесь будут те же события и задачи, что в планере'),
    field('Логин', loginInput),
    field('Пароль', password),
    extra,
    error,
    submit,
    switcher,
    serverAddress ? h('div', { class: 'muted small', style: { textAlign: 'center' } }, `Сервер: ${serverAddress}`) : null);
    paint();
    if (message) error.textContent = message;
    clear(root).append(h('div', { class: 'signin' }, form));
    setTimeout(() => (login ? password : loginInput).focus(), 30);
  });
}
