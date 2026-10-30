// Update von V1.0 auf V1.1: Der V1-Fortschritt (Schlüssel mathe.progress.v1) bleibt unverändert
// nutzbar – neue Daten liegen in eigenen Schlüsseln, ältere App-Versionen überschreiben sie daher nicht.
// Vor dem ersten Start von V1.1 wird eine Sicherungskopie angelegt; ist der Fortschritt später
// unlesbar, wird sie wiederhergestellt.
import { sanitize } from './progress.js';

export const PROGRESS_KEY = 'mathe.progress.v1';
export const BACKUP_KEY = 'mathe.backup.v1.0';
export const META_KEY = 'mathe.meta';
export const SCHEMA = 2;

const parses = (raw) => {
  try {
    const o = JSON.parse(raw);
    return o && o.v === 1 ? o : null;
  } catch {
    return null;
  }
};

// Liefert { status: 'neu' | 'migriert' | 'ok' | 'wiederhergestellt' | 'verloren' }
export function migrate(storage, nowIso = new Date().toISOString()) {
  const meta = parses0(storage.getItem(META_KEY));
  const raw = storage.getItem(PROGRESS_KEY);
  const good = raw !== null && parses(raw) !== null;

  if (meta && meta.schema >= SCHEMA) {
    if (raw === null || good) return { status: 'ok' };
    const backup = storage.getItem(BACKUP_KEY);
    if (backup && parses(backup)) {
      storage.setItem(PROGRESS_KEY, backup);
      return { status: 'wiederhergestellt' };
    }
    return { status: 'verloren' };
  }

  try {
    if (raw !== null && !storage.getItem(BACKUP_KEY)) storage.setItem(BACKUP_KEY, raw); // 1. Sicherung des Originals
    if (raw !== null && !good) {
      const backup = storage.getItem(BACKUP_KEY);
      if (!(backup && parses(backup))) {
        storage.removeItem(PROGRESS_KEY);
        storage.setItem(META_KEY, JSON.stringify({ schema: SCHEMA, migratedAt: nowIso, note: 'v1-defekt' }));
        return { status: 'verloren' };
      }
    }
    if (good) storage.setItem(PROGRESS_KEY, JSON.stringify(sanitize(parses(raw)))); // nur gültige Felder, Rest bleibt erhalten
    storage.setItem(META_KEY, JSON.stringify({ schema: SCHEMA, migratedAt: nowIso, from: raw === null ? null : 1 }));
    return { status: raw === null ? 'neu' : 'migriert' };
  } catch {
    return { status: 'verloren' };
  }
}

function parses0(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
