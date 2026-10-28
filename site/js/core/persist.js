// The account's copy in the browser: IndexedDB, one database per account
// (cosmos-<login>), the way the planner keeps accounts/<key>.db. The page
// opens with what was there and syncs only what changed since; an edit made
// without the network waits in the journal across a reload. Signing out
// deletes the database, as the planner deletes the account's copy.

const VERSION = 1;

function promised(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function databaseName(login) {
  return `cosmos-${String(login).toLowerCase()}`;
}

export class Persist {
  constructor(db) {
    this.db = db;
    this.queue = [];
    this.flushing = null;
    this.meta = new Map();
  }

  /** Opens (or makes) the copy of @p login; null where IndexedDB is not allowed. */
  static async open(login) {
    if (!globalThis.indexedDB) return null;
    try {
      const request = indexedDB.open(databaseName(login), VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('records')) db.createObjectStore('records');
        if (!db.objectStoreNames.contains('journal')) db.createObjectStore('journal');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      const db = await promised(request);
      return new Persist(db);
    } catch {
      return null;
    }
  }

  static async remove(login) {
    if (!globalThis.indexedDB) return;
    try {
      await promised(indexedDB.deleteDatabase(databaseName(login)));
    } catch {
      // A blocked deletion finishes once the other tab lets go.
    }
  }

  /** Everything kept: {records: [{kind, id, data}], journal: [...], ownerReminders: [[key, list]]}. */
  async load() {
    const tx = this.db.transaction(['records', 'journal', 'meta'], 'readonly');
    const [recordKeys, recordValues, journal, metaKeys, metaValues] = await Promise.all([
      promised(tx.objectStore('records').getAllKeys()),
      promised(tx.objectStore('records').getAll()),
      promised(tx.objectStore('journal').getAll()),
      promised(tx.objectStore('meta').getAllKeys()),
      promised(tx.objectStore('meta').getAll()),
    ]);
    const records = recordKeys.map((key, i) => {
      const slash = key.indexOf('/');
      return { kind: key.slice(0, slash), id: key.slice(slash + 1), data: recordValues[i] };
    });
    const ownerReminders = [];
    metaKeys.forEach((key, i) => {
      this.meta.set(key, metaValues[i]);
      if (key.startsWith('owner-reminders/')) ownerReminders.push([key.slice('owner-reminders/'.length), metaValues[i]]);
    });
    return { records, journal, ownerReminders };
  }

  getMeta(key) {
    return this.meta.get(key);
  }

  setMeta(key, value) {
    if (value == null) this.meta.delete(key);
    else this.meta.set(key, value);
    this.enqueue('meta', key, value);
  }

  writeRecord(kind, id, record) {
    this.enqueue('records', `${kind}/${id}`, record);
  }

  writeJournal(key, entry) {
    this.enqueue('journal', key, entry);
  }

  enqueue(store, key, value) {
    this.queue.push([store, key, value == null ? null : structuredClone(value)]);
    if (!this.flushing) this.flushing = Promise.resolve().then(() => this.flush());
  }

  /** Writes what queued up in one transaction. */
  async flush() {
    while (this.queue.length) {
      const batch = this.queue.splice(0);
      try {
        const tx = this.db.transaction(['records', 'journal', 'meta'], 'readwrite');
        for (const [store, key, value] of batch) {
          if (value == null) tx.objectStore(store).delete(key);
          else tx.objectStore(store).put(value, key);
        }
        await new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } catch (failure) {
        console.warn('Кэш в браузере не записался', failure);
      }
    }
    this.flushing = null;
  }

  close() {
    this.db.close();
  }
}

/** Meta kept in memory only, where there is no IndexedDB (and in tests). */
export class MemoryMeta {
  constructor() {
    this.values = new Map();
  }

  get(key) {
    return this.values.get(key);
  }

  set(key, value) {
    this.values.set(key, value);
  }
}
