// Lokal gespeicherter Lernfortschritt (localStorage, mit Speicher-Fallback).
import { OPS, makeTask, taskKey, shuffle } from './generator.js';

const KEY = 'mathe.progress.v1';
const HISTORY_MAX = 30;

export function createStorage() {
  try {
    const s = window.localStorage;
    s.setItem('__t', '1');
    s.removeItem('__t');
    return s;
  } catch {
    const m = new Map();
    return {
      persistent: false,
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => void m.set(k, String(v)),
      removeItem: (k) => void m.delete(k),
    };
  }
}

export function emptyState() {
  return {
    v: 1,
    sessions: 0,
    tasks: 0,
    firstTry: 0,
    best: {}, // "add:1" -> Sterne 0..3
    played: {}, // "add:1" -> Anzahl Einheiten
    history: [],
    trouble: {}, // taskKey -> { op, a, b, level, misses, ok }
    streak: { last: '', days: 0 },
    prefs: { level: 1 },
  };
}

const num = (x, lo, hi, d = 0) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.trunc(x))) : d);
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

// Prüft geladene Daten und verwirft alles Unplausible.
export function sanitize(raw) {
  const s = emptyState();
  if (!isObj(raw) || raw.v !== 1) return s;
  s.sessions = num(raw.sessions, 0, 1e7);
  s.tasks = num(raw.tasks, 0, 1e9);
  s.firstTry = num(raw.firstTry, 0, 1e9);
  for (const field of ['best', 'played']) {
    if (!isObj(raw[field])) continue;
    for (const [k, v] of Object.entries(raw[field])) {
      if (/^(add|sub|mul|div|mix):[123]$/.test(k)) s[field][k] = num(v, 0, field === 'best' ? 3 : 1e7);
    }
  }
  if (Array.isArray(raw.history)) {
    s.history = raw.history
      .filter((h) => isObj(h) && typeof h.d === 'string')
      .slice(-HISTORY_MAX)
      .map((h) => ({ d: h.d.slice(0, 10), op: String(h.op).slice(0, 8), level: num(h.level, 0, 3), ok: num(h.ok, 0, 100), n: num(h.n, 0, 100), s: num(h.s, 0, 3) }));
  }
  if (isObj(raw.trouble)) {
    for (const e of Object.values(raw.trouble)) {
      if (!isObj(e) || !OPS.includes(e.op) || !Number.isInteger(e.a) || !Number.isInteger(e.b) || e.b === 0) continue;
      const t = makeTask(e.op, e.a, e.b, num(e.level, 1, 3, 1));
      if (!Number.isInteger(t.answer) || t.answer < 0) continue;
      s.trouble[taskKey(t)] = { op: t.op, a: t.a, b: t.b, level: t.level, misses: num(e.misses, 1, 999, 1), ok: num(e.ok, 0, 1) };
    }
  }
  if (isObj(raw.streak) && typeof raw.streak.last === 'string') {
    s.streak = { last: raw.streak.last.slice(0, 10), days: num(raw.streak.days, 0, 99999) };
  }
  if (isObj(raw.prefs)) s.prefs.level = num(raw.prefs.level, 1, 3, 1);
  return s;
}

export const isoDate = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const dayBefore = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return isoDate(d);
};

export class Progress {
  constructor(storage, today = () => isoDate(new Date())) {
    this.storage = storage;
    this.today = today;
    this.state = this.load();
  }

  load() {
    try {
      return sanitize(JSON.parse(this.storage.getItem(KEY)));
    } catch {
      return emptyState();
    }
  }

  save() {
    try {
      this.storage.setItem(KEY, JSON.stringify(this.state));
      return true;
    } catch {
      return false;
    }
  }

  reset() {
    this.state = emptyState();
    this.save();
  }

  setLevel(level) {
    this.state.prefs.level = level;
    this.save();
  }

  // mode: 'op' (Rechenart + Stufe) oder 'trouble' (Fehler-Training)
  recordSession({ mode, op, level, summary }) {
    const s = this.state;
    const today = this.today();
    s.sessions += 1;
    s.tasks += summary.total;
    s.firstTry += summary.firstTry;
    if (mode === 'op') {
      const k = `${op}:${level}`;
      s.played[k] = (s.played[k] || 0) + 1;
      s.best[k] = Math.max(s.best[k] || 0, summary.stars);
    }
    s.history.push({ d: today, op: mode === 'trouble' ? 'trouble' : op, level: mode === 'trouble' ? 0 : level, ok: summary.firstTry, n: summary.total, s: summary.stars });
    s.history = s.history.slice(-HISTORY_MAX);

    if (s.streak.last !== today) {
      s.streak.days = s.streak.last === dayBefore(today) ? s.streak.days + 1 : 1;
      s.streak.last = today;
    }

    for (const r of summary.results) {
      const key = taskKey(r.task);
      const entry = s.trouble[key];
      if (!r.firstTry) {
        if (entry) Object.assign(entry, { misses: entry.misses + 1, ok: 0 });
        else s.trouble[key] = { op: r.task.op, a: r.task.a, b: r.task.b, level: r.task.level, misses: 1, ok: 0 };
      } else if (entry) {
        entry.ok += 1;
        if (entry.ok >= 2) delete s.trouble[key]; // zweimal sicher gekonnt → gelernt
      }
    }
    return this.save();
  }

  troubleCount() {
    return Object.keys(this.state.trouble).length;
  }

  // Schwierige Aufgaben zur Wiederholung; op/level undefined = alle.
  troubleTasks({ op, level, max, rng = Math.random }) {
    const list = Object.values(this.state.trouble).filter(
      (e) => (level === undefined || e.level === level) && (op === undefined || op === 'mix' || e.op === op),
    );
    const ordered = shuffle(rng, list).sort((x, y) => y.misses - x.misses);
    return ordered.slice(0, max).map((e) => ({ ...makeTask(e.op, e.a, e.b, e.level), repeat: true }));
  }
}
