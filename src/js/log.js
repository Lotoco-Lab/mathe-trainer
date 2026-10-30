// Lernprotokoll und Zwischenstand (lokal zuerst). Jede Übungseinheit ist ein eigener
// Datensatz "mathe.s.<id>" mit eindeutiger ID und steigender Revision (rev) – so kann
// sie später idempotent und aktualisierbar synchronisiert werden.
import { Session } from './session.js';

const INDEX = 'mathe.log.index';
const ACTIVE = 'mathe.active.v1';
const REC = (id) => `mathe.s.${id}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isUuid = (s) => typeof s === 'string' && UUID.test(s);

export function newId() {
  const c = globalThis.crypto;
  if (c && c.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && c.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const STATUS = { active: 'aktiv', paused: 'unterbrochen', done: 'abgeschlossen' };

// meta: { id, start, op, level, mode, total, rev }
export function buildRecord(meta, session, status, nowIso) {
  const sum = session.summary();
  return {
    v: 1,
    id: meta.id,
    rev: meta.rev,
    start: meta.start,
    last: nowIso,
    end: status === STATUS.done ? nowIso : null,
    op: meta.op,
    level: meta.level,
    mode: meta.mode,
    total: meta.total,
    processed: sum.processed,
    firstOk: sum.firstTry,
    secondOk: sum.later,
    failed: sum.failed,
    helps: sum.helps,
    open: session.open,
    status,
    tasks: session.log.slice(),
  };
}

const read = (storage, key) => {
  try {
    return JSON.parse(storage.getItem(key));
  } catch {
    return null;
  }
};

export class LearningLog {
  constructor(storage) {
    this.storage = storage;
  }

  ids() {
    const x = read(this.storage, INDEX);
    return Array.isArray(x) ? x.filter(isUuid) : [];
  }

  get(id) {
    const r = read(this.storage, REC(id));
    return r && r.id === id && Number.isInteger(r.rev) ? r : null;
  }

  list() {
    return this.ids().map((id) => this.get(id)).filter(Boolean);
  }

  put(record) {
    try {
      this.storage.setItem(REC(record.id), JSON.stringify(record));
      const ids = this.ids();
      if (!ids.includes(record.id)) {
        ids.push(record.id);
        this.storage.setItem(INDEX, JSON.stringify(ids));
      }
      return true;
    } catch {
      return false;
    }
  }

  // Entfernt alte Datensätze, aber nur solche, deren aktueller Stand bestätigt synchronisiert ist.
  prune(keep, isSynced) {
    const ids = this.ids();
    const removable = ids.slice(0, Math.max(0, ids.length - keep)).filter((id) => {
      const r = this.get(id);
      return !r || (r.status !== STATUS.active && isSynced(r));
    });
    if (!removable.length) return 0;
    for (const id of removable) this.storage.removeItem(REC(id));
    this.storage.setItem(INDEX, JSON.stringify(ids.filter((id) => !removable.includes(id))));
    return removable.length;
  }

  deleteAll() {
    for (const id of this.ids()) this.storage.removeItem(REC(id));
    this.storage.removeItem(INDEX);
  }
}

// ---- Zwischenstand der laufenden/unterbrochenen Übung ----

export function saveActive(storage, meta, session, input = '') {
  try {
    storage.setItem(ACTIVE, JSON.stringify({ v: 1, meta, input, session: session.toJSON() }));
    return true;
  } catch {
    return false;
  }
}

export function loadActive(storage, opts) {
  const o = read(storage, ACTIVE);
  if (!o || o.v !== 1 || !o.meta || !isUuid(o.meta.id)) return null;
  try {
    return { meta: o.meta, input: typeof o.input === 'string' ? o.input.slice(0, 4) : '', session: Session.fromJSON(o.session, opts) };
  } catch {
    return null;
  }
}

export const clearActive = (storage) => storage.removeItem(ACTIVE);
