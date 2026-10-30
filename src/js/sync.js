// Offline-first-Synchronisierung. Lokal gespeicherte Datensätze werden – sobald Netz da ist –
// idempotent (feste ID + Revision) an den Dienst übertragen. Lokale Daten werden erst nach der
// Bestätigung des Servers als "synchronisiert" markiert; Fehler blockieren nie das Rechnen.
const KEY = 'mathe.sync.v1';
const BATCH = 10;
const TIMEOUT_MS = 10000;
export const BACKOFF_MS = [5000, 15000, 60000, 300000, 900000];

export class Sync {
  constructor({ storage, log, config, fetchFn = (...a) => fetch(...a), now = () => new Date().toISOString(), setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t), online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false), onChange = () => {} }) {
    Object.assign(this, { storage, log, config, fetchFn, now, setTimer, clearTimer, online, onChange });
    this.state = this.load();
    this.running = false;
    this.again = false;
    this.failures = 0;
    this.timer = null;
    this.lastError = null; // nur im Speicher: Text des letzten Fehlers
    this.revoked = false;
  }

  load() {
    const s = { v: 1, device: null, acked: {}, lastOk: null };
    try {
      const o = JSON.parse(this.storage.getItem(KEY));
      if (o && o.v === 1) {
        if (o.device && typeof o.device.token === 'string' && o.device.token.length >= 16) s.device = { token: o.device.token, at: String(o.device.at || '') };
        if (o.acked && typeof o.acked === 'object') for (const [k, v] of Object.entries(o.acked)) if (Number.isInteger(v)) s.acked[k] = v;
        s.lastOk = typeof o.lastOk === 'string' ? o.lastOk : null;
      }
    } catch { /* leer starten */ }
    return s;
  }

  save() {
    try {
      this.storage.setItem(KEY, JSON.stringify(this.state));
    } catch { /* Speicher voll: beim nächsten Mal erneut */ }
  }

  get configured() {
    return !!(this.config.supabaseUrl && this.config.anonKey);
  }

  get paired() {
    return !!this.state.device;
  }

  pending() {
    return this.log.list().filter((r) => r.rev > (this.state.acked[r.id] || 0)).sort((a, b) => (a.last < b.last ? -1 : 1));
  }

  // 'aus' | 'ungekoppelt' | 'widerrufen' | 'synchron' | 'wartet' | 'offline' | 'fehler' | 'sendet'
  status() {
    if (!this.configured) return 'aus';
    if (!this.paired) return 'ungekoppelt';
    if (this.revoked) return 'widerrufen';
    if (this.running) return 'sendet';
    if (!this.pending().length) return 'synchron';
    if (!this.online()) return 'offline';
    return this.lastError ? 'fehler' : 'wartet';
  }

  async rpc(fn, body) {
    const ctl = typeof AbortController === 'undefined' ? null : new AbortController();
    const timer = ctl ? this.setTimer(() => ctl.abort(), TIMEOUT_MS) : null;
    try {
      const res = await this.fetchFn(`${this.config.supabaseUrl}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: this.config.anonKey, Authorization: `Bearer ${this.config.anonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctl ? ctl.signal : undefined,
      });
      let data = null;
      try {
        data = await res.json();
      } catch { /* leere Antwort */ }
      if (!res.ok) {
        const err = new Error((data && (data.message || data.error)) || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return data;
    } finally {
      if (timer !== null) this.clearTimer(timer);
    }
  }

  // Kopplung mit dem vom Elternteil erzeugten Einmalcode.
  async pair(code) {
    if (!this.configured) throw new Error('Synchronisierung ist nicht eingerichtet');
    const clean = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length !== 8) throw new Error('Der Code hat 8 Zeichen.');
    const data = await this.rpc('redeem_pairing_code', { p_code: clean, p_label: 'Kind-Gerät' });
    if (!data || typeof data.token !== 'string') throw new Error('Unerwartete Antwort');
    this.state.device = { token: data.token, at: this.now() };
    this.state.acked = {};
    this.revoked = false;
    this.lastError = null;
    this.save();
    this.onChange();
    this.trigger();
  }

  unpair() {
    this.state.device = null;
    this.state.acked = {};
    this.save();
    this.cancelTimer();
    this.onChange();
  }

  cancelTimer() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  // Sofort (bzw. nach kurzer Bündelung) versuchen; Aufrufer wartet nie darauf.
  trigger(delay = 0) {
    if (!this.configured || !this.paired || this.revoked) return;
    if (this.timer !== null && delay > 0) return; // bereits geplant: nicht ständig nach hinten schieben
    this.cancelTimer();
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.syncNow();
    }, delay);
  }

  async syncNow() {
    if (!this.configured || !this.paired || this.revoked) return false;
    if (this.running) {
      this.again = true;
      return false;
    }
    if (!this.online()) {
      this.onChange();
      return false;
    }
    this.running = true;
    this.onChange();
    try {
      for (;;) {
        const batch = this.pending().slice(0, BATCH);
        if (!batch.length) break;
        const data = await this.rpc('sync_push', { p_token: this.state.device.token, p_sessions: batch });
        const acked = data && Array.isArray(data.acked) ? data.acked : [];
        for (const a of acked) {
          if (a && typeof a.id === 'string' && Number.isInteger(a.rev)) this.state.acked[a.id] = Math.max(this.state.acked[a.id] || 0, a.rev);
        }
        if (!acked.length) throw new Error('Keine Bestätigung vom Server');
        this.save();
      }
      this.state.lastOk = this.now();
      this.lastError = null;
      this.failures = 0;
      this.save();
      this.log.prune(100, (r) => (this.state.acked[r.id] || 0) >= r.rev);
      return true;
    } catch (e) {
      this.lastError = e.message || String(e);
      if (e.status === 401 || /invalid_token/.test(e.message)) {
        this.revoked = true; // Kopplung wurde von den Eltern aufgehoben: nicht weiter versuchen
      } else {
        const delay = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)];
        this.failures += 1;
        this.cancelTimer();
        this.timer = this.setTimer(() => {
          this.timer = null;
          this.syncNow();
        }, delay);
      }
      return false;
    } finally {
      this.running = false;
      this.onChange();
      if (this.again) {
        this.again = false;
        if (!this.lastError) this.trigger(0);
      }
    }
  }
}
