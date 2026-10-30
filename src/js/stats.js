// Auswertungen für die Elternübersicht (rein, ohne DOM, testbar).
import { classifyError, parseQuestion } from './errors.js';

export const OP_NAMES = { add: 'Plus', sub: 'Minus', mul: 'Mal', div: 'Geteilt', mix: 'Gemischt', mix2: 'Gemischt', trouble: 'Knifflige Aufgaben' };
export const LEVEL_NAMES = { 0: '–', 1: 'Leicht', 2: 'Mittel', 3: 'Schwer' };

// Server-Zeilen { data, ... } → Protokolle, neueste zuerst.
export const toRecords = (rows) =>
  rows
    .map((r) => r.data)
    .filter((d) => d && typeof d.id === 'string')
    .sort((a, b) => (a.start < b.start ? 1 : -1));

export const rate = (r) => (r.processed ? Math.round((r.firstOk / r.processed) * 100) : null);

export function overview(records) {
  const done = records.filter((r) => r.status === 'abgeschlossen');
  const processed = records.reduce((s, r) => s + r.processed, 0);
  const firstOk = records.reduce((s, r) => s + r.firstOk, 0);
  return {
    sessions: records.length,
    done: done.length,
    open: records.length - done.length,
    processed,
    firstRate: processed ? Math.round((firstOk / processed) * 100) : null,
    helps: records.reduce((s, r) => s + r.helps, 0),
  };
}

// Häufigkeit der Fehlerarten über alle falschen Antworten.
export function errorTypes(records) {
  const counts = {};
  for (const r of records) {
    for (const t of r.tasks || []) {
      const q = parseQuestion(t.q);
      if (!q) continue;
      for (const g of t.g || []) {
        const kind = classifyError(q, t.a, g);
        if (kind) counts[kind] = (counts[kind] || 0) + 1;
      }
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([kind, count]) => ({ kind, count }));
}

// Schwächste Rechenarten/Stufen (nach Quote im ersten Versuch), mindestens 10 Aufgaben.
export function weakSpots(records) {
  const m = {};
  for (const r of records) {
    const k = `${r.op}:${r.level}`;
    m[k] = m[k] || { op: r.op, level: r.level, n: 0, ok: 0 };
    m[k].n += r.processed;
    m[k].ok += r.firstOk;
  }
  return Object.values(m).filter((x) => x.n >= 10).map((x) => ({ ...x, rate: Math.round((x.ok / x.n) * 100) })).sort((a, b) => a.rate - b.rate);
}

// Verlauf: Quote im ersten Versuch je Einheit, älteste zuerst (höchstens `max`).
export function trend(records, max = 30) {
  return records
    .filter((r) => r.processed >= 10)
    .slice()
    .reverse()
    .slice(-max)
    .map((r) => ({ start: r.start, pct: rate(r) }));
}

const csvCell = (v) => `"${String(v).replace(/"/g, '""')}"`;
export function toCsv(records) {
  const head = ['Einheit', 'Start', 'Status', 'Rechenart', 'Stufe', 'Aufgabe', 'Ergebnis', 'Antworten', 'Versuche', 'Hilfe', 'Phase', 'Zeit'];
  const lines = [head.map(csvCell).join(';')];
  for (const r of records) {
    for (const t of r.tasks || []) {
      lines.push([r.id, r.start, r.status, OP_NAMES[r.op] || r.op, LEVEL_NAMES[r.level] || r.level, t.q, t.a, (t.g || []).join(' / '), t.n, t.h ? 'ja' : 'nein', t.p === 'review' ? 'Wiederholung' : 'Übung', t.t].map(csvCell).join(';'));
    }
  }
  return lines.join('\n');
}
