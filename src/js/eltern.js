// Elternübersicht: Anmeldung beim Dienst (Supabase Auth), danach Lesen der eigenen Lerndaten.
// Zugangsdaten und Token werden NIE gespeichert (nur im Speicher dieser Seite): Wer die Seite
// schließt oder neu lädt, muss sich erneut anmelden – so bleibt ein Kindgerät nicht freigeschaltet.
import { CONFIG } from './config.js';
import { authHeaders } from './sync.js';
import { toRecords, overview, errorTypes, weakSpots, trend, toCsv, rate, OP_NAMES, LEVEL_NAMES } from './stats.js';
import { ERROR_LABELS } from './errors.js';

const root = document.getElementById('app');
let session = null; // { token, email }
let data = { records: [], devices: [] };
let view = { detail: null, code: '', msg: '', loading: false, wipeOpen: false };

const $ = (id) => document.getElementById(id);
// Tolerante Bestätigung: Leerzeichen, Groß-/Kleinschreibung, zerlegtes Ö und "OE" statt "Ö" (iOS-Tastatur, Vorschlagsleiste).
const confirmWord = (v) => ['LÖSCHEN', 'LOESCHEN'].includes(String(v).normalize('NFC').trim().toUpperCase());
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');
const configured = () => !!(CONFIG.supabaseUrl && CONFIG.anonKey);

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${CONFIG.supabaseUrl}${path}`, {
    method,
    headers: authHeaders(CONFIG.anonKey, token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch { /* leer */ }
  if (!res.ok) {
    const e = new Error((json && (json.message || json.error_description || json.msg)) || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return json;
}

async function login(email, password) {
  const j = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  session = { token: j.access_token, email };
}

async function load(keepMsg = false) {
  view.loading = true;
  render();
  try {
    const [rows, devices] = await Promise.all([
      api('/rest/v1/sessions?select=id,device_id,rev,data,updated_at&order=updated_at.desc&limit=1000', { token: session.token }),
      api('/rest/v1/devices?select=id,label,created_at,last_seen,revoked_at&order=created_at.desc', { token: session.token }),
    ]);
    data = { records: toRecords(rows), devices };
    if (!keepMsg) view.msg = '';
  } catch (e) {
    if (e.status === 401) {
      session = null;
      view.msg = 'Sitzung abgelaufen. Bitte erneut anmelden.';
    } else view.msg = `Laden fehlgeschlagen: ${e.message}`;
  }
  view.loading = false;
  render();
}

// ---------- Darstellung ----------

function trendSvg(points) {
  if (points.length < 2) return '<p class="tip">Für den Verlauf werden mindestens zwei Übungen benötigt.</p>';
  const w = 600, h = 120, pad = 14;
  const x = (i) => pad + (i * (w - 2 * pad)) / (points.length - 1);
  const y = (p) => h - pad - (p * (h - 2 * pad)) / 100;
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ');
  return `<svg class="trend" viewBox="0 0 ${w} ${h}" role="img" aria-label="Verlauf der Erfolgsquote im ersten Versuch">
    <line x1="${pad}" y1="${y(50)}" x2="${w - pad}" y2="${y(50)}" stroke="#cfe3fa" stroke-dasharray="4"/>
    <polyline points="${line}" fill="none" stroke="#1c6fd1" stroke-width="3"/>
    ${points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.pct).toFixed(1)}" r="4" fill="#1c6fd1"><title>${fmt(p.start)}: ${p.pct} %</title></circle>`).join('')}
  </svg><p class="tip">Anteil richtig im ersten Versuch je Übung (von ${points[0].pct} % auf ${points[points.length - 1].pct} %; gestrichelt = 50 %).</p>`;
}

function renderLogin() {
  if (!configured()) {
    return `<h1>Elternübersicht</h1><div class="panel"><p>Die Cloud-Sicherung ist noch nicht eingerichtet. Siehe <code>docs/V1.1-ELTERN-UND-SYNC.md</code>.</p><p><a class="small" href="./">← Zur App</a></p></div>`;
  }
  return `<h1>Elternübersicht</h1>
    <form data-form="login">
      <label>E-Mail <input type="email" name="email" autocomplete="username" required></label>
      <label>Passwort <input type="password" name="password" autocomplete="current-password" required></label>
      <button class="primary" type="submit">Anmelden</button>
      <p class="msg warn" data-testid="loginmsg">${esc(view.msg)}</p>
      <p class="tip">Die Anmeldung wird aus Sicherheitsgründen nicht gespeichert.</p>
      <a class="small" href="./">← Zur App</a>
    </form>`;
}

function renderDetail(rec) {
  const rows = rec.tasks
    .map(
      (t) => `<tr><td>${esc(t.q)} = ${esc(t.a)}</td><td>${t.g.map((g) => (g === t.a ? `<span class="good">${esc(g)}</span>` : `<span class="wrong">${esc(g)}</span>`)).join(' → ')}</td><td>${t.n}</td><td>${t.h ? 'ja' : '–'}</td><td class="hide-sm">${t.p === 'review' ? 'Wiederholung' : t.rep ? 'aus früheren Übungen' : 'Übung'}</td><td class="hide-sm">${fmt(t.t)}</td></tr>`,
    )
    .join('');
  return `<div class="panel" data-testid="detail">
    <p><button class="small" data-act="back">← Übersicht</button></p>
    <h2>${OP_NAMES[rec.op] || esc(rec.op)} ${LEVEL_NAMES[rec.level] ? '· ' + LEVEL_NAMES[rec.level] : ''} – ${fmt(rec.start)}</h2>
    <p>Status: <b>${esc(rec.status)}</b> · bearbeitet ${rec.processed}/${rec.total} · erster Versuch richtig ${rec.firstOk} (${rate(rec) ?? '–'} %) · zweiter Versuch ${rec.secondOk} · Hilfen ${rec.helps} · offen ${rec.open}<br>Letzte Aktivität: ${fmt(rec.last)}${rec.end ? ` · abgeschlossen ${fmt(rec.end)}` : ''}</p>
    <table class="list"><thead><tr><th>Aufgabe</th><th>Antworten</th><th>Versuche</th><th>Hilfe</th><th class="hide-sm">Art</th><th class="hide-sm">Zeit</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}

function renderMain() {
  const rec = view.detail && data.records.find((r) => r.id === view.detail);
  const ov = overview(data.records);
  const errs = errorTypes(data.records);
  const maxErr = errs.length ? errs[0].count : 1;
  const weak = weakSpots(data.records).slice(0, 3);
  const sessions = data.records
    .slice(0, 100)
    .map(
      (r) => `<tr class="click" data-id="${esc(r.id)}" tabindex="0"><td>${fmt(r.start)}</td><td>${OP_NAMES[r.op] || esc(r.op)}${LEVEL_NAMES[r.level] ? ' · ' + LEVEL_NAMES[r.level] : ''}</td><td>${r.processed}/${r.total}</td><td>${rate(r) ?? '–'} %</td><td>${r.helps}</td><td><span class="pill ${r.status === 'abgeschlossen' ? 'done' : 'open'}">${esc(r.status)}</span></td></tr>`,
    )
    .join('');
  const devices = data.devices
    .map((d) => `<li>${esc(d.label)} · gekoppelt ${fmt(d.created_at)} · zuletzt ${fmt(d.last_seen)} ${d.revoked_at ? '(getrennt)' : `<button class="small" data-act="revoke" data-id="${esc(d.id)}">Trennen</button>`}</li>`)
    .join('');
  return `<div class="bar-top"><h1>Elternübersicht</h1>
    <div class="btns">
      <button class="small" data-act="reload">⟳ Aktualisieren</button>
      <button class="small" data-act="code">Kind-Gerät koppeln</button>
      <button class="small" data-act="json">Export JSON</button>
      <button class="small" data-act="csv">Export CSV</button>
      <button class="small" data-act="logout">Abmelden</button>
    </div></div>
    ${view.msg ? `<p class="msg warn" data-testid="msg">${esc(view.msg)}</p>` : ''}
    ${view.code ? `<div class="panel"><p>Code im Kind-Gerät unter <b>Eltern ⚙︎ → Koppeln</b> eingeben (10 Minuten gültig, einmalig):</p><div class="code-box" data-testid="code">${esc(view.code)}</div></div>` : ''}
    ${rec ? renderDetail(rec) : `
    <div class="tiles">
      <div class="tile"><b>${ov.sessions}</b><span>Übungen</span></div>
      <div class="tile"><b>${ov.done} / ${ov.open}</b><span>abgeschlossen / offen</span></div>
      <div class="tile"><b>${ov.processed}</b><span>Aufgaben</span></div>
      <div class="tile"><b>${ov.firstRate ?? '–'} %</b><span>richtig im 1. Versuch</span></div>
      <div class="tile"><b>${ov.helps}</b><span>Hilfestellungen</span></div>
    </div>
    <div class="panel"><h2>Entwicklung</h2>${trendSvg(trend(data.records))}</div>
    <div class="panel"><h2>Häufige Fehlerarten</h2>${errs.length ? errs.map((e) => `<div class="bar-row"><div>${esc(ERROR_LABELS[e.kind] || e.kind)}<i style="width:${Math.round((e.count / maxErr) * 100)}%"></i></div><b>${e.count}</b></div>`).join('') : '<p class="tip">Noch keine Fehler erfasst.</p>'}
      ${weak.length ? `<p class="tip">Schwächste Bereiche: ${weak.map((w) => `${OP_NAMES[w.op] || w.op} ${LEVEL_NAMES[w.level] || ''} (${w.rate} %)`).join(', ')}</p>` : ''}</div>
    <div class="panel"><h2>Letzte Übungen</h2>
      ${sessions ? `<table class="list" data-testid="sessions"><thead><tr><th>Wann</th><th>Was</th><th>Aufgaben</th><th>1. Versuch</th><th>Hilfen</th><th>Status</th></tr></thead><tbody>${sessions}</tbody></table>` : '<p class="tip">Noch keine Übungen übertragen. Die Daten erscheinen, sobald das Kind-Gerät online war.</p>'}</div>
    <div class="panel"><h2>Geräte &amp; Daten</h2><ul>${devices || '<li>Kein Gerät gekoppelt.</li>'}</ul>
      ${view.wipeOpen ? `<div class="panel" data-testid="wipe-dialog">
        <p><b>Alle Lerndaten löschen?</b> Alle Übungen auf dem Server werden entfernt und alle Kind-Geräte getrennt. Das kann nicht rückgängig gemacht werden.</p>
        <p>Zur Bestätigung <b>LÖSCHEN</b> eintippen:</p>
        <input type="text" id="wipeword" autocapitalize="characters" autocorrect="off" spellcheck="false" autocomplete="off" aria-label="Bestätigung">
        ${view.msg ? `<p class="err" role="alert">${esc(view.msg)}</p>` : ''}
        <p><button class="small" data-act="wipe-go">Endgültig löschen</button> <button class="small" data-act="wipe-cancel">Abbrechen</button></p>
      </div>` : `<p><button class="small" data-act="wipe">Alle Lerndaten löschen …</button></p>`}
      <p class="tip">Beim Löschen werden alle Übungen auf dem Server entfernt und alle Kind-Geräte getrennt (Neukopplung nötig). Aufbewahrung: bis zum Löschen durch Sie, empfohlen höchstens 24 Monate.</p></div>`}
    ${view.loading ? '<p class="tip">Lädt …</p>' : ''}`;
}

function render() {
  root.innerHTML = !session ? renderLogin() : renderMain();
}

// ---------- Aktionen ----------

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const acts = {
  back() { view.detail = null; render(); },
  reload() { return load(); },
  logout() { session = null; data = { records: [], devices: [] }; view = { detail: null, code: '', msg: '', loading: false, wipeOpen: false }; render(); },
  async code() {
    try {
      view.code = (await api('/rest/v1/rpc/create_pairing_code', { method: 'POST', body: {}, token: session.token })) || '';
      view.msg = '';
    } catch (e) { view.msg = `Code konnte nicht erzeugt werden: ${e.message}`; }
    render();
  },
  async revoke(el) {
    if (!confirm('Dieses Kind-Gerät trennen? Es kann dann keine Daten mehr übertragen.')) return;
    let msg = 'Gerät getrennt.';
    try { await api('/rest/v1/rpc/revoke_device', { method: 'POST', body: { p_id: el.dataset.id }, token: session.token }); } catch (e) { msg = `Trennen fehlgeschlagen: ${e.message}`; }
    await load(true);
    view.msg = msg;
    render();
  },
  json() { download('lernprotokoll.json', JSON.stringify({ exportiert: new Date().toISOString(), uebungen: data.records }, null, 2), 'application/json'); },
  csv() { download('lernprotokoll.csv', '﻿' + toCsv(data.records), 'text/csv'); },
  wipe() { view.wipeOpen = true; view.msg = ''; render(); },
  'wipe-cancel'() { view.wipeOpen = false; render(); },
  async 'wipe-go'() {
    if (!confirmWord($('wipeword').value)) {
      view.msg = 'Bitte zur Bestätigung das Wort LÖSCHEN eintippen. Es wurde nichts gelöscht.';
      return render();
    }
    let outcome;
    try {
      await api('/rest/v1/rpc/delete_all_data', { method: 'POST', body: {}, token: session.token });
      outcome = 'Alle Lerndaten wurden gelöscht und die Geräte getrennt.';
    } catch (e) {
      if (e.status === 401) {
        session = null;
        view.wipeOpen = false;
        view.msg = 'Sitzung abgelaufen – bitte erneut anmelden. Es wurde nichts gelöscht.';
        return render();
      }
      outcome = `Löschen fehlgeschlagen: ${e.message}. Es wurde nichts gelöscht.`;
    }
    view.wipeOpen = false;
    await load(true); // aktuellen Stand holen, die Meldung bleibt erhalten
    if (outcome.startsWith('Alle') && data.records.length) outcome = 'Der Server meldete Erfolg, es sind aber noch Übungen sichtbar. Bitte erneut versuchen.';
    view.msg = outcome;
    render();
    window.scrollTo(0, 0); // Ergebnis steht oben, auf dem iPhone sonst außerhalb des Bildschirms
  },
};

root.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (act) return acts[act.dataset.act](act);
  const row = e.target.closest('tr[data-id]');
  if (row) { view.detail = row.dataset.id; render(); }
});
root.addEventListener('keydown', (e) => {
  const row = e.target.closest && e.target.closest('tr[data-id]');
  if (row && (e.key === 'Enter' || e.key === ' ')) { view.detail = row.dataset.id; render(); }
});
root.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.target.dataset.form !== 'login') return;
  const f = new FormData(e.target);
  view.msg = 'Anmelden …';
  render();
  try {
    await login(String(f.get('email')), String(f.get('password')));
    view.msg = '';
    await load();
  } catch (err) {
    session = null;
    view.msg = err.status === 400 || err.status === 401 ? 'E-Mail oder Passwort stimmt nicht.' : `Anmeldung nicht möglich: ${err.message}`;
    render();
  }
});

render();
