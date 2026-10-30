import test from 'node:test';
import assert from 'node:assert/strict';

import { agentSessions } from '../site/js/core/api.js';

test('среди сеансов аккаунта агенты узнаются по имени устройства', () => {
  const agents = agentSessions([
    { id: 'a', device: 'ИИ-агент · Claude', createdAt: '2026-10-30T10:00:00Z' },
    { id: 'b', device: 'Сайт · Firefox на Windows' },
    { id: 'c', device: 'Рабочий ИИ-агент · не тот' },
    { id: 'd', device: 'ИИ-агент · ' },
    { id: 'e' },
  ]);
  assert.deepEqual(agents.map((a) => [a.id, a.name]), [['a', 'Claude'], ['d', '']]);
  assert.equal(agents[0].createdAt, '2026-10-30T10:00:00Z');
});

test('сервер без списка сеансов — пустой список, а не ошибка', () => {
  assert.deepEqual(agentSessions(undefined), []);
});
