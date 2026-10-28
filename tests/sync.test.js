import test from 'node:test';
import assert from 'node:assert/strict';

import { setClock } from '../site/js/model/dates.js';
import { Store } from '../site/js/core/store.js';
import { SyncEngine } from '../site/js/core/sync.js';
import { MemoryMeta } from '../site/js/core/persist.js';
import { Kind } from '../site/js/model/records.js';
import { FakeServer } from './fakeserver.js';

let ms = Date.UTC(2026, 9, 28, 9, 0, 0);
setClock(() => new Date(ms));
const tick = (n = 1000) => { ms += n; };

function device() {
  const store = new Store();
  store.ensureSeed();
  return { store, engine: new SyncEngine(store, new MemoryMeta()) };
}

function exchange(server, dev, tag) {
  const { body, sent } = dev.engine.buildRequest(tag);
  const answer = server.sync(structuredClone(body), tag);
  dev.engine.applyResponse(structuredClone(answer), sent);
  return { body, answer };
}

test('an edit made on one device reaches the other', () => {
  const server = new FakeServer();
  const phone = device();
  const web = device();
  const calendar = phone.store.saveCalendar({ name: 'Работа', color: '#0f9d58' });
  phone.store.saveEvent({ id: 'e1', title: 'Встреча', calendarId: calendar, start: '2026-10-28T10:00:00' });
  exchange(server, phone, 'phone');
  assert.equal(phone.store.journal.size, 0, 'confirmed lines leave the journal');

  exchange(server, web, 'web');
  assert.equal(web.store.event('e1').title, 'Встреча');
  assert.equal(web.store.journal.size, 0, 'what arrived is not sent back');
  // The seed of the new device gave way to the account's calendars.
  assert.ok(!web.store.calendar('default') || web.store.calendars().length === 2);

  tick();
  web.store.saveEvent({ ...web.store.event('e1'), title: 'Встреча (перенесена)' });
  exchange(server, web, 'web');
  exchange(server, phone, 'phone');
  assert.equal(phone.store.event('e1').title, 'Встреча (перенесена)');
});

test('a deletion travels as a tombstone, but not to a device that starts from nothing', () => {
  const server = new FakeServer();
  const a = device();
  a.store.saveTask({ id: 't1', title: 'Купить хлеб' });
  exchange(server, a, 'a');
  const b = device();
  exchange(server, b, 'b');
  assert.ok(b.store.task('t1'));
  tick();
  a.store.removeTask('t1');
  const { answer } = exchange(server, a, 'a');
  assert.equal(answer.accepted, 1);
  exchange(server, b, 'b');
  assert.equal(b.store.task('t1'), null);
  const c = device();
  const first = exchange(server, c, 'c');
  assert.ok(!first.answer.changes.some((ch) => ch.deleted));
});

test('a newer local edit wins over what the answer brings', () => {
  const server = new FakeServer();
  const a = device();
  const b = device();
  a.store.saveTask({ id: 't', title: 'v1' });
  exchange(server, a, 'a');
  exchange(server, b, 'b');
  tick();
  a.store.saveTask({ ...a.store.task('t'), title: 'from a' });
  exchange(server, a, 'a');
  tick();
  b.store.saveTask({ ...b.store.task('t'), title: 'from b, later' });
  // The answer to a request built earlier brings a's version; b's newer edit stays.
  const { sent } = b.engine.buildRequest('b');
  const stale = server.sync({ since: 0, device: 'x', changes: [] }, 'x');
  tick();
  b.store.saveTask({ ...b.store.task('t'), title: 'from b, newest' });
  b.engine.applyResponse(stale, []);
  assert.equal(b.store.task('t').title, 'from b, newest');
  assert.ok(sent.length);
});

test('the server\'s newer version comes back when the edit loses', () => {
  const server = new FakeServer();
  const a = device();
  const b = device();
  a.store.saveTask({ id: 't', title: 'v1' });
  exchange(server, a, 'a');
  exchange(server, b, 'b');
  const old = ms;
  tick(5000);
  a.store.saveTask({ ...a.store.task('t'), title: 'newer' });
  exchange(server, a, 'a');
  ms = old + 1000;
  b.store.saveTask({ ...b.store.task('t'), title: 'older' });
  const { answer } = exchange(server, b, 'b');
  assert.equal(answer.rejected, 1);
  assert.equal(b.store.task('t').title, 'newer');
  ms = old + 10000;
});

test('a member\'s edit carries the owner\'s reminders', () => {
  const member = device();
  const twin = member.store.saveCalendar({ name: 'Семья', ownerLogin: 'anna', originId: 'o', access: 'edit' });
  member.store.journal.clear();
  // The owner's version arrives with a reminder at 60 minutes.
  const server = new FakeServer();
  server.records.set('event/e', { kind: 'event', id: 'e', modified: ms, deleted: false, revision: ++server.revision, device: 'owner',
    data: { id: 'e', title: 'Ужин', calendarId: twin, start: '2026-10-28T19:00:00', end: '2026-10-28T20:00:00', reminders: [60] } });
  exchange(server, member, 'm');
  assert.deepEqual(member.store.event('e').reminders, []);
  tick();
  member.store.saveEvent({ ...member.store.event('e'), title: 'Ужин в 20', reminders: [10] });
  const { body } = member.engine.buildRequest('m');
  const sent = body.changes.find((c) => c.id === 'e');
  assert.deepEqual(sent.data.reminders, [60], 'the owner keeps his reminders');
  assert.equal(member.store.event('e').title, 'Ужин в 20');
  assert.deepEqual(member.store.event('e').reminders, [10], 'the member keeps hers');
});

test('a restored record goes out with the restore mark once', () => {
  const dev = device();
  dev.store.saveTask({ id: 't', title: 'x' });
  dev.engine.markRestored('task', 't');
  const { body, sent } = dev.engine.buildRequest('d');
  assert.equal(body.changes[0].restore, true);
  dev.engine.applyResponse({ revision: 1, changes: [], conflicts: [{ kind: 'task', id: 't', reason: 'read_only', data: {} }] }, sent);
  assert.equal(dev.engine.conflicts[0].reason, 'read_only');
  dev.store.saveTask({ ...dev.store.task('t'), title: 'y' });
  assert.equal(dev.engine.buildRequest('d').body.changes[0].restore, undefined);
});

test('one record is asked for before an edit, a pending local change wins', () => {
  const server = new FakeServer();
  const a = device();
  const b = device();
  a.store.saveTask({ id: 't', title: 'v1' });
  exchange(server, a, 'a');
  exchange(server, b, 'b');
  tick();
  a.store.saveTask({ ...a.store.task('t'), title: 'v2' });
  exchange(server, a, 'a');
  assert.equal(b.engine.applyRecord(server.record('task', 't')), true);
  assert.equal(b.store.task('t').title, 'v2');
  assert.equal(b.engine.cursor, server.revision - 1, 'the cursor does not move');
  assert.equal(b.engine.applyRecord(server.record('task', 'missing')), false);
});

test('an answer of an unknown shape is refused', () => {
  const dev = device();
  assert.throws(() => dev.engine.applyResponse({ hello: 1 }, []), /неизвестного вида/);
});
