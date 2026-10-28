// A stand-in for CalendarServer's exchange (Storage::sync()): a revision per
// account, the later edit wins, the device does not get back what it just
// sent, and a first sync gets no tombstones. Enough to run two devices of one
// account against each other without a network.

export class FakeServer {
  constructor() {
    this.revision = 0;
    this.records = new Map();
  }

  sync(body, deviceTag) {
    const accepted = [];
    let rejected = 0;
    const refused = [];
    for (const change of body.changes) {
      const key = `${change.kind}/${change.id}`;
      const stored = this.records.get(key);
      if (stored && stored.modified > change.modified) {
        ++rejected;
        refused.push(stored);
        continue;
      }
      const record = { ...structuredClone(change), revision: ++this.revision, device: deviceTag };
      if (record.deleted) delete record.data;
      this.records.set(key, record);
      accepted.push(key);
    }
    const changes = [...this.records.values()]
      .filter((r) => r.revision > body.since)
      .filter((r) => !(r.device === deviceTag && accepted.includes(`${r.kind}/${r.id}`)))
      .filter((r) => body.since > 0 || !r.deleted)
      .concat(refused)
      .map(({ device, ...rest }) => rest);
    return { revision: this.revision, accepted: accepted.length, rejected, conflicts: [], changes };
  }

  record(kind, id) {
    const stored = this.records.get(`${kind}/${id}`);
    if (!stored) return { found: false };
    const { device, ...change } = stored;
    return { found: true, change };
  }
}
