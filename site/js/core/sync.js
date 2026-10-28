// The exchange with the sync server, a port of the planner's SyncEngine
// (building the request, reading the answer) and SyncService (when to sync).
// The site is one more device of the account, and the protocol is the
// planner's: DESDOC.md of CosmosCalendar, 3.4-3.6.

import { Kind, normalize, toData } from '../model/records.js';
import { now } from '../model/dates.js';
import { anyReminderRingsAlarm } from '../model/reminders.js';
import { keyOf } from './store.js';

/**
 * Puts one change of an answer into @p batch unless a newer local change of
 * the same record still waits in @p pending. Returns whether it counts.
 */
function addChange(change, pending, batch) {
  const kind = String(change?.kind || '');
  const id = String(change?.id || '');
  const modified = Number(change?.modified || 0);
  if (!kind || !id) return false;
  const local = pending.get(keyOf(kind, id));
  if (local !== undefined && local > modified) return false;
  if (change.deleted) {
    batch.removals.push([kind, id]);
    return true;
  }
  // A kind from a newer planner, or an old "category" still on the server.
  const record = normalize(kind, change.data, id);
  if (!record) return false;
  batch.records.push({ kind, record });
  return true;
}

export class SyncEngine {
  constructor(store) {
    this.store = store;
    // The revision of the server this page has seen, kept in memory only: a
    // new page starts from zero and takes the whole account.
    this.cursor = 0;
    this.lastSync = '';
    this.restored = new Set();
    this.conflicts = [];
  }

  /** "Вернуть": the server lets this change of a record the owner deleted through. */
  markRestored(kind, id) {
    this.restored.add(keyOf(kind, id));
  }

  /** The body of POST /api/sync and the journal lines it carries. */
  buildRequest(device) {
    const sent = this.store.journalEntries();
    const changes = sent.map((entry) => {
      const record = entry.deleted ? null : this.store.maps[entry.kind]?.get(entry.id) || null;
      const change = { kind: entry.kind, id: entry.id, modified: entry.modified, deleted: entry.deleted || !record };
      if (record) {
        const data = toData(entry.kind, record);
        // A record of somebody else's calendar goes out with the owner's
        // reminders, not this member's.
        if ((entry.kind === Kind.event || entry.kind === Kind.task) && this.store.isForeignCalendar(record.calendarId)) {
          data.reminders = this.store.ownerReminders(entry.kind, entry.id);
          data.alarm = anyReminderRingsAlarm(data.reminders);
        }
        change.data = data;
      }
      if (this.restored.has(keyOf(entry.kind, entry.id))) change.restore = true;
      return change;
    });
    return { body: { since: this.cursor, device, changes }, sent };
  }

  /** Applies an answer of /api/sync; returns the number of records received. */
  applyResponse(response, sent) {
    if (!response || typeof response.revision !== 'number' || !Array.isArray(response.changes)) {
      throw new Error('Сервер прислал ответ неизвестного вида');
    }
    this.conflicts = (response.conflicts || [])
      .filter((c) => c && c.kind && c.id)
      .map((c) => ({ kind: c.kind, id: c.id, calendarId: c.calendarId || '', reason: c.reason || '', data: c.data || {} }));

    const before = this.cursor;
    this.store.acknowledge(sent);
    for (const entry of sent) this.restored.delete(keyOf(entry.kind, entry.id));

    const pending = new Map(this.store.journalEntries().map((e) => [keyOf(e.kind, e.id), e.modified]));
    const batch = { records: [], removals: [] };
    let count = 0;
    for (const change of response.changes) {
      if (addChange(change, pending, batch)) ++count;
    }
    this.store.applyRemote(batch, before <= 0);
    this.cursor = response.revision;
    this.lastSync = now();
    return count;
  }

  /** Applies an answer of GET /api/record; returns whether the record changed here. */
  applyRecord(response) {
    if (!response || !('found' in response) || !response.found) return false;
    const pending = new Map(this.store.journalEntries().map((e) => [keyOf(e.kind, e.id), e.modified]));
    const batch = { records: [], removals: [] };
    if (!addChange(response.change, pending, batch)) return false;
    this.store.applyRemote(batch, false);
    return true;
  }
}

const RETRY_STEPS = [15, 30, 60, 120];

/**
 * When to sync: 3 seconds after a change, every few minutes and when the page
 * comes back to the front; when it goes away with changes not sent yet, at
 * once, by a request that outlives the page. A failed exchange (the server
 * is busy, restarting) is tried again in 15, 30, 60 and 120 seconds. There is
 * no work without the server: the site lives beside it.
 */
export class SyncService {
  constructor(engine, api, { device, intervalMinutes = 15 } = {}) {
    this.engine = engine;
    this.api = api;
    this.device = device;
    this.intervalMinutes = intervalMinutes;
    this.state = 'idle';
    this.error = '';
    this.lastSync = '';
    this.running = false;
    this.again = false;
    this.failures = 0;
    this.timer = 0;
    this.listeners = new Set();
    this.stopped = true;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  setState(state, error = '') {
    this.state = state;
    this.error = error;
    this.emit({ type: 'state', state, error });
  }

  /** Starts; resolves to whether the first exchange went through. */
  start() {
    this.stopped = false;
    this.engine.store.onLocalChange = () => this.schedule(3000);
    this.onVisible = () => {
      if (document.visibilityState === 'visible') this.syncNow();
      else this.flush();
    };
    this.onHide = () => this.flush();
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('pagehide', this.onHide);
    return this.syncNow();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.engine.store.onLocalChange = () => {};
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('pagehide', this.onHide);
  }

  /**
   * The page is hidden or closing: what waits in the journal goes now, with
   * keepalive, so that the browser finishes the request even when the page is
   * gone. Nothing of the account is kept in the browser to send it later.
   */
  flush() {
    if (this.engine.store.journal.size && !this.running) this.syncNow({ keepalive: true });
  }

  schedule(ms) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.syncNow(), ms);
  }

  /** Syncs now, or right after the exchange already under way. */
  async syncNow({ keepalive = false } = {}) {
    if (this.stopped) return false;
    if (this.running) {
      this.again = true;
      return false;
    }
    this.running = true;
    clearTimeout(this.timer);
    this.setState('syncing');
    let ok = false;
    try {
      const { body, sent } = this.engine.buildRequest(this.device);
      const result = await this.api.sync(body, { keepalive });
      if (result.ok) {
        const received = this.engine.applyResponse(result.body, sent);
        this.failures = 0;
        this.lastSync = this.engine.lastSync;
        ok = true;
        this.setState('idle');
        this.emit({ type: 'synced', received, accepted: result.body.accepted, conflicts: this.engine.conflicts });
      } else if (result.status === 401) {
        this.setState('auth', result.error);
      } else {
        this.fail(result.error, result.retryAfter);
      }
    } catch (failure) {
      this.fail(failure.message || String(failure));
    } finally {
      this.running = false;
    }
    if (this.stopped) return ok;
    if (this.again) {
      this.again = false;
      this.schedule(0);
    } else if (ok) {
      this.schedule(this.engine.store.journal.size ? 3000 : this.intervalMinutes * 60000);
    }
    return ok;
  }

  fail(error, retryAfter = 0) {
    const step = RETRY_STEPS[Math.min(this.failures, RETRY_STEPS.length - 1)];
    this.failures += 1;
    this.setState('error', error);
    this.schedule(Math.max(step, retryAfter) * 1000);
  }

  /**
   * Asks the server for one record before it is edited, so that an edit made a
   * minute ago on another device is not overwritten. Waits at most 2.5 s;
   * a full exchange follows in the background either way.
   */
  async refreshRecord(kind, id) {
    if (this.stopped || this.state === 'error') return false;
    const result = await this.api.record(kind, id, 2500);
    let changed = false;
    if (result.ok) changed = this.engine.applyRecord(result.body);
    this.schedule(0);
    return changed;
  }

  setInterval(minutes) {
    this.intervalMinutes = Math.max(1, minutes);
    if (!this.running) this.schedule(this.intervalMinutes * 60000);
  }
}
