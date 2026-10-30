// Ende-zu-Ende-Tests: die echte App (dist/) läuft in einem iPhone-großen iframe,
// bedient wird sie ausschließlich über die Tasten (Klicks auf data-key / data-action).
// Der Testserver stellt unter /sb einen Fake des Synchronisierungsdienstes bereit und kann das Netz abschalten.
import { test, assert, waitFor, sleep } from './harness.js';

const CALC = { '+': (a, b) => a + b, '−': (a, b) => a - b, '·': (a, b) => a * b, ':': (a, b) => a / b };
const solve = (text) => {
  const m = text.match(/^(\d+) ([+−·:]) (\d+)$/);
  assert.ok(m, `Aufgabe lesbar: "${text}"`);
  return CALC[m[2]](Number(m[1]), Number(m[3]));
};

const frames = [];
async function openApp(path = '/app/index.html') {
  const f = document.createElement('iframe');
  f.style.cssText = 'width:390px;height:844px;border:0';
  f.src = path;
  document.body.appendChild(f);
  frames.push(f);
  await new Promise((r) => f.addEventListener('load', r, { once: true }));
  const w = f.contentWindow;
  w.confirm = () => true;
  w.prompt = (msg) => {
    const m = /(\d+) × (\d+)/.exec(msg);
    return m ? String(m[1] * m[2]) : 'LÖSCHEN'; // Elternfrage lösen bzw. Löschbestätigung
  };
  return w;
}
const closeApps = () => frames.splice(0).forEach((f) => f.remove());

const $ = (w, sel) => w.document.querySelector(sel);
const $$ = (w, sel) => [...w.document.querySelectorAll(sel)];
const tap = (w, key) => {
  const el = $(w, `[data-key="${key}"]`);
  assert.ok(el, `Taste ${key} vorhanden`);
  assert.ok(!el.disabled, `Taste ${key} aktiv`);
  el.click();
};
const typeNumber = (w, n) => String(n).split('').forEach((d) => tap(w, d));
const task = (w) => $(w, '[data-testid="task"]').textContent;
const answer = (w) => $(w, '[data-testid="answer"]').textContent.replace(/ /g, '').trim();
const feedback = (w) => $(w, '[data-testid="feedback"]').textContent;
const count = (w) => $(w, '.count').textContent;
const click = (w, sel) => {
  const el = $(w, sel);
  assert.ok(el, `${sel} vorhanden`);
  el.click();
};
const store = () => JSON.parse(localStorage.getItem('mathe.progress.v1') || 'null');
const records = () => (JSON.parse(localStorage.getItem('mathe.log.index') || '[]')).map((id) => JSON.parse(localStorage.getItem(`mathe.s.${id}`)));
const solveOne = (w) => {
  typeNumber(w, solve(task(w)));
  tap(w, 'ok');
  tap(w, 'ok');
};
const solveN = (w, n) => {
  for (let i = 0; i < n; i++) solveOne(w);
};
const finish = (w) => {
  for (let i = 0; i < 80 && !$(w, '.done'); i++) solveOne(w);
  assert.ok($(w, '.done'), 'Übung beendet');
};
const sbReset = () => fetch('/__sbreset');
const sbState = async () => (await fetch('/__sbstate')).json();
const SBH = (t) => ({ apikey: 'test-anon-key', Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
const sbLogin = async (email = 'eltern@test.de', password = 'geheim123') =>
  (await (await fetch('/sb/auth/v1/token?grant_type=password', { method: 'POST', headers: SBH('test-anon-key'), body: JSON.stringify({ email, password }) })).json()).access_token;
const sbCode = async () => (await (await fetch('/sb/rest/v1/rpc/create_pairing_code', { method: 'POST', headers: SBH(await sbLogin()), body: '{}' })).json());
const fresh = async () => {
  localStorage.clear();
  sessionStorage.clear();
  await sbReset();
  await fetch('/__swbuild?b=');
  closeApps();
  return openApp();
};

// ---------- Bedienung ----------

test('E2E Start: Rechenarten, Schwierigkeitsgrade, Eltern-Zugang', async () => {
  const w = await fresh();
  assert.ok($(w, 'h1').textContent.includes('Mathe-Trainer'));
  assert.eq($$(w, '[data-action="start"]').map((b) => b.dataset.op), ['add', 'sub', 'mul', 'div', 'mix']);
  assert.eq($$(w, '[data-action="level"]').length, 3);
  assert.ok(!$(w, '[data-action="trouble"]'), 'ohne Fehler kein Fehler-Training');
  assert.ok(!$(w, '[data-action="resume"]'), 'ohne Pause kein Fortsetzen');
  assert.ok($(w, '[data-action="settings"]'));
  click(w, '[data-level="3"]');
  assert.eq($(w, '[data-level="3"]').getAttribute('aria-pressed'), 'true');
  assert.eq(store().prefs.level, 3, 'Stufe gemerkt');
});

test('E2E Tastenblock: 12 Tasten, max. 4 Ziffern, Löschen, Fertig erst mit Eingabe', async () => {
  const w = await fresh();
  click(w, '[data-op="add"]');
  assert.eq($$(w, '.keypad .key').length, 12);
  assert.ok($(w, '[data-key="ok"]').disabled, 'leere Eingabe kann nicht abgeschickt werden');
  [1, 2, 3, 4, 5].forEach((d) => tap(w, d));
  assert.eq(answer(w), '1234');
  tap(w, 'back');
  tap(w, 'back');
  assert.eq(answer(w), '12');
  $$(w, '.keypad .key').forEach((k) => assert.ok(parseFloat(w.getComputedStyle(k).height) >= 56, 'Taste groß genug'));
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: '7' }));
  assert.eq(answer(w), '127');
});

test('E2E 50 Aufgaben: Zähler, Ergebnis, vollständiges Lernprotokoll', async () => {
  const w = await fresh();
  click(w, '[data-op="add"]');
  assert.eq(count(w), 'Aufgabe 1/50');
  const seen = [];
  for (let i = 1; i <= 50; i++) {
    assert.eq(count(w), `Aufgabe ${i}/50`);
    seen.push(task(w));
    typeNumber(w, solve(task(w)));
    tap(w, 'ok');
    assert.ok($(w, '.msg.good'), 'Lob angezeigt');
    assert.ok($(w, '[data-key="5"]').disabled, 'Ziffern nach Antwort gesperrt');
    tap(w, 'ok');
  }
  assert.ok(new Set(seen).size >= 48, 'fast alle Aufgaben verschieden');
  assert.ok($(w, '.done'), 'Ergebnisübersicht');
  assert.eq($(w, '.big-stars').textContent, '★★★');
  assert.ok($(w, '.facts').textContent.includes('Beim zweiten Versuch richtig: 0'));
  const s = store();
  assert.eq([s.sessions, s.tasks, s.firstTry, s.best['add:1']], [1, 50, 50, 3]);
  const recs = records();
  assert.eq(recs.length, 1);
  const r = recs[0];
  assert.eq([r.status, r.processed, r.firstOk, r.secondOk, r.helps, r.open, r.total, r.op, r.level], ['abgeschlossen', 50, 50, 0, 0, 0, 50, 'add', 1]);
  assert.ok(/^[0-9a-f-]{36}$/.test(r.id) && r.start < r.last && r.end >= r.start && r.rev >= 51, 'ID, Zeiten, Revision');
  assert.eq(r.tasks.length, 50);
  assert.ok(r.tasks.every((t) => t.n === 1 && t.g.length === 1 && t.g[0] === t.a && !t.h && t.p === 'main' && /^\d{4}-\d\d-\d\dT/.test(t.t)));
  assert.eq(localStorage.getItem('mathe.active.v1'), null, 'Zwischenstand nach Abschluss entfernt');
  click(w, '[data-action="home"]');
  assert.eq($(w, '[data-op="add"] .op-stars').textContent, '★★★');
});

test('E2E Fehler: Hinweis, Lösungsweg, gekennzeichnete Wiederholung zusätzlich zu den 50, später wieder geübt', async () => {
  const w = await fresh();
  click(w, '[data-level="2"]');
  click(w, '[data-op="mul"]');
  const hardTask = task(w);
  const right = solve(hardTask);
  typeNumber(w, right + 1);
  tap(w, 'ok');
  assert.ok($(w, '.msg.warn'), 'freundlicher Hinweis statt Lösung');
  assert.ok(feedback(w).includes('Tipp'));
  assert.ok(!feedback(w).includes(`= ${right}`), 'Lösung noch nicht verraten');
  assert.eq(answer(w), '', 'Eingabe geleert für zweiten Versuch');
  typeNumber(w, right + 2);
  tap(w, 'ok');
  assert.ok($$(w, '.steps li').length >= 1, 'Lösungsweg sichtbar');
  assert.ok($(w, '.result').textContent.endsWith(`= ${right}`));
  assert.ok(feedback(w).includes('am Ende noch einmal'));
  tap(w, 'ok');
  for (let i = 2; i <= 50; i++) {
    assert.eq(count(w), `Aufgabe ${i}/50`);
    solveOne(w);
  }
  assert.eq(count(w), 'Wiederholung 1/1', 'Wiederholungsrunde nach 50 bewerteten Aufgaben');
  assert.ok($(w, '.tag').textContent.includes('zählt nicht mit'), 'klar gekennzeichnet');
  assert.eq(task(w), hardTask);
  solveOne(w);
  assert.ok($(w, '.done'));
  assert.ok($(w, '.missed').textContent.includes(`${hardTask} = ${right}`));
  assert.eq(store().firstTry, 49);
  assert.eq(Object.keys(store().trouble).length, 1, 'Fehler dauerhaft gemerkt');
  const r = records()[0];
  assert.eq([r.processed, r.firstOk, r.helps, r.tasks.length, r.tasks.filter((t) => t.p === 'review').length], [50, 49, 1, 51, 1]);
  assert.eq(r.tasks[0].g, [right + 1, right + 2], 'abgegebene Antworten protokolliert');
  assert.ok(r.tasks[0].h && r.tasks[0].n === 2);

  click(w, '[data-action="again"]');
  let found = false;
  for (let i = 1; i <= 50; i++) {
    if ($(w, '.tag') && task(w) === hardTask) found = true;
    solveOne(w);
  }
  assert.ok(found, 'knifflige Aufgabe kommt als gekennzeichnete Wiederholung vor');
  assert.ok($(w, '.done'));
  assert.eq(store().trouble[Object.keys(store().trouble)[0]].ok, 1);
});

test('E2E Fehler-Training: übt nur gemerkte Aufgaben', async () => {
  await fresh();
  localStorage.setItem('mathe.progress.v1', JSON.stringify({ v: 1, trouble: { x: { op: 'div', a: 56, b: 7, level: 2, misses: 2, ok: 0 }, y: { op: 'add', a: 38, b: 47, level: 2, misses: 1, ok: 0 } } }));
  closeApps();
  const w = await openApp();
  click(w, '[data-action="trouble"]');
  assert.eq(count(w), 'Aufgabe 1/2');
  const seen = [task(w)];
  solveOne(w);
  seen.push(task(w));
  solveOne(w);
  assert.eq(seen.sort(), ['38 + 47', '56 : 7']);
  assert.ok($(w, '.done'));
});

test('E2E alle Rechenarten × Stufen starten und sind lösbar', async () => {
  const w = await fresh();
  for (const level of [1, 2, 3]) {
    for (const op of ['add', 'sub', 'mul', 'div', 'mix']) {
      click(w, `[data-level="${level}"]`);
      click(w, `[data-op="${op}"]`);
      typeNumber(w, solve(task(w)));
      tap(w, 'ok');
      assert.ok($(w, '.answer.solved'), `${op}/${level} lösbar`);
      click(w, '[data-action="pause"]');
      assert.ok($(w, '.home'));
    }
  }
});

// ---------- Unterbrechen, Fortsetzen, Neustart ----------

test('E2E Pause und Fortsetzen: Stand bleibt, auch nach App-Neustart; ein Datensatz je Einheit', async () => {
  const w = await fresh();
  click(w, '[data-level="2"]');
  click(w, '[data-op="sub"]');
  solveN(w, 18);
  click(w, '[data-action="pause"]');
  assert.ok($(w, '.home'));
  assert.ok($(w, '[data-action="resume"]').textContent.includes('18/50'), 'Fortschritt im Fortsetzen-Knopf');
  let r = records();
  assert.eq([r.length, r[0].status, r[0].processed, r[0].open], [1, 'unterbrochen', 18, 32]);
  const id = r[0].id;
  const rev1 = r[0].rev;

  closeApps();
  const w2 = await openApp(); // App „neu gestartet“
  assert.ok($(w2, '[data-action="resume"]').textContent.includes('18/50'));
  click(w2, '[data-action="resume"]');
  assert.eq(count(w2), 'Aufgabe 19/50');
  finish(w2);
  r = records();
  assert.eq(r.length, 1, 'derselbe Datensatz, keine Dublette');
  assert.eq([r[0].id, r[0].status, r[0].processed, r[0].tasks.length, r[0].open, r[0].level], [id, 'abgeschlossen', 50, 50, 0, 2]);
  assert.ok(r[0].rev > rev1);
  assert.ok(!$(w2, '[data-action="resume"]') || $(w2, '.done'), 'nichts mehr offen');
});

test('E2E Neustart mitten in der Übung: keine abgegebene Antwort geht verloren', async () => {
  const w = await fresh();
  click(w, '[data-op="add"]');
  solveN(w, 5);
  const t6 = task(w);
  typeNumber(w, solve(t6) + 1);
  tap(w, 'ok'); // Fehlversuch abgegeben
  typeNumber(w, 9); // angefangene, nicht abgegebene Eingabe
  closeApps(); // App wird beendet, ohne Pause
  const w2 = await openApp();
  assert.eq(records()[0].status, 'unterbrochen', 'als unterbrochen vermerkt');
  assert.ok($(w2, '[data-action="resume"]'));
  click(w2, '[data-action="resume"]');
  assert.eq([count(w2), task(w2)], ['Aufgabe 6/50', t6]);
  assert.ok($(w2, '.msg.warn'), 'Hinweis nach Fehlversuch bleibt erhalten');
  typeNumber(w2, solve(t6));
  tap(w2, 'ok');
  tap(w2, 'ok');
  const e = records()[0].tasks[5];
  assert.eq([e.g.length, e.n, e.h, e.ok], [2, 2, true, true], 'Fehlversuch plus richtige Antwort protokolliert');
  finish(w2);
  assert.eq(records().length, 1);
});

test('E2E Neue Übung bei unterbrochener: Rückfrage, alte bleibt als offen protokolliert', async () => {
  const w = await fresh();
  click(w, '[data-op="add"]');
  solveN(w, 3);
  click(w, '[data-action="pause"]');
  w.confirm = () => false;
  click(w, '[data-op="sub"]');
  assert.ok($(w, '.home'), 'abgelehnt → bleibt auf dem Start');
  w.confirm = () => true;
  click(w, '[data-op="sub"]');
  assert.eq(count(w), 'Aufgabe 1/50');
  const r = records();
  assert.eq(r.map((x) => [x.op, x.status]), [['add', 'unterbrochen'], ['sub', 'aktiv']]);
});

// ---------- Kopplung & Synchronisierung ----------

test('E2E Kopplung und Sync: Code eingeben, Daten kommen an, nach Offline-Phase nachgeholt, keine Dubletten', async () => {
  const w = await fresh();
  click(w, '[data-action="settings"]');
  const code = await sbCode();
  $(w, '#code').value = 'AAAAAAAA';
  click(w, '[data-action="pair"]');
  await waitFor(() => $(w, '[data-testid="pairmsg"]').textContent.includes('ungültig'), 'Fehlermeldung bei falschem Code');
  $(w, '#code').value = code;
  click(w, '[data-action="pair"]');
  await waitFor(() => $(w, '[data-testid="syncstate"]'), 'gekoppelt');
  click(w, '[data-action="home"]');
  click(w, '[data-level="2"]');
  click(w, '[data-op="mix"]');
  solveN(w, 4);
  click(w, '[data-action="pause"]');
  click(w, '[data-action="settings"]');
  click(w, '[data-action="syncnow"]');
  const local = () => records()[0];
  await waitFor(async () => (await sbState()).sessions[0]?.rev === local().rev, 'Server hat aktuellen Stand');
  let st = await sbState();
  assert.eq([st.sessions.length, st.sessions[0].data.processed, st.sessions[0].data.status], [1, 4, 'unterbrochen']);
  assert.ok(!JSON.stringify(st.sessions[0].data).includes('token'), 'kein Geheimnis in den Daten');
  click(w, '[data-action="home"]');
  await waitFor(() => $(w, '[data-sync]').textContent.includes('Gesichert'), 'Statusanzeige „Gesichert“');

  // Netz weg, weiter üben
  await fetch('/__offline');
  click(w, '[data-action="resume"]');
  solveN(w, 3);
  click(w, '[data-action="pause"]');
  await sleep(300);
  await fetch('/__online');
  assert.ok((await sbState()).sessions[0].rev < local().rev, 'Server hat den neuen Stand noch nicht');
  w.dispatchEvent(new w.Event('online')); // Verbindung wieder da
  await waitFor(async () => (await sbState()).sessions[0]?.rev === local().rev, 'Nachträgliche Übertragung');
  st = await sbState();
  assert.eq([st.sessions.length, st.sessions[0].data.processed], [1, 7], 'ein Datensatz, aktualisiert');
  click(w, '[data-action="resume"]');
  finish(w);
  click(w, '[data-action="home"]');
  click(w, '[data-action="settings"]');
  click(w, '[data-action="syncnow"]');
  await waitFor(async () => (await sbState()).sessions[0]?.data.status === 'abgeschlossen', 'Abschluss übertragen');
  assert.eq((await sbState()).sessions.length, 1);
  assert.eq(records().length, 1, 'lokal bleibt alles erhalten');
});

test('E2E Kopplung lösen und lokale Daten löschen (nur nach Elternfrage)', async () => {
  const w = await fresh();
  click(w, '[data-action="settings"]');
  $(w, '#code').value = await sbCode();
  click(w, '[data-action="pair"]');
  await waitFor(() => $(w, '[data-testid="syncstate"]'), 'gekoppelt');
  w.prompt = () => '1';
  click(w, '[data-action="unpair"]');
  await sleep(50);
  assert.ok($(w, '[data-testid="syncstate"]'), 'falsche Antwort → bleibt gekoppelt');
  w.prompt = (m) => String(/(\d+) × (\d+)/.exec(m).slice(1).reduce((a, b) => a * b));
  click(w, '[data-action="unpair"]');
  await sleep(50);
  assert.ok($(w, '#code'), 'Kopplung gelöst');
  click(w, '[data-action="home"]');
  click(w, '[data-op="add"]');
  solveN(w, 2);
  click(w, '[data-action="pause"]');
  click(w, '[data-action="settings"]');
  w.prompt = () => '1';
  click(w, '[data-action="wipe"]');
  assert.eq(records().length, 1, 'ohne richtige Elternfrage nichts gelöscht');
  w.prompt = (m) => String(/(\d+) × (\d+)/.exec(m).slice(1).reduce((a, b) => a * b));
  click(w, '[data-action="wipe"]');
  await sleep(50);
  assert.eq([records().length, store().sessions, localStorage.getItem('mathe.active.v1')], [0, 0, null]);
  assert.ok($(w, '.home') && !$(w, '[data-action="resume"]'));
});

// ---------- Elternübersicht ----------

test('E2E Elternübersicht: nur nach Anmeldung, Detailansicht, Fehlerarten, Export, Löschung, Datentrennung', async () => {
  await fresh();
  closeApps();
  // Daten wie von einem Kind-Gerät übertragen
  const code = await sbCode();
  const dev = await (await fetch('/sb/rest/v1/rpc/redeem_pairing_code', { method: 'POST', headers: SBH('test-anon-key'), body: JSON.stringify({ p_code: code, p_label: 'Test' }) })).json();
  const mk = (id, start, status, tasks) => ({ v: 1, id, rev: 1, start, last: start, end: status === 'abgeschlossen' ? start : null, op: 'add', level: 2, mode: 'op', total: 50, processed: tasks.length, firstOk: tasks.filter((t) => t.n === 1 && t.ok).length, secondOk: tasks.filter((t) => t.n === 2 && t.ok).length, failed: 0, helps: tasks.filter((t) => t.h).length, open: 50 - tasks.length, status, tasks });
  const T = (q, a, g, t) => ({ q, a, g, n: g.length, h: g.length > 1, ok: g[g.length - 1] === a, p: 'main', rep: false, t });
  const s1 = mk('11111111-1111-4111-8111-111111111111', '2026-10-30T09:00:00.000Z', 'abgeschlossen', [T('34 + 28', 62, [62], '2026-10-30T09:01:00.000Z'), T('45 + 39', 84, [74, 84], '2026-10-30T09:02:00.000Z')]);
  const s2 = mk('22222222-2222-4222-8222-222222222222', '2026-10-31T09:00:00.000Z', 'unterbrochen', [T('62 − 28', 34, [90, 34], '2026-10-31T09:01:00.000Z')]);
  const res = await fetch('/sb/rest/v1/rpc/sync_push', { method: 'POST', headers: SBH('test-anon-key'), body: JSON.stringify({ p_token: dev.token, p_sessions: [s1, s2] }) });
  assert.eq(res.status, 200);

  const w = await openApp('/app/eltern.html');
  assert.ok($(w, 'form[data-form="login"]'), 'zuerst Anmeldung');
  assert.ok(!w.document.body.textContent.includes('34 + 28'), 'ohne Anmeldung keine Daten');
  const submit = (email, pw) => {
    $(w, 'input[name=email]').value = email;
    $(w, 'input[name=password]').value = pw;
    $(w, 'form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  };
  submit('eltern@test.de', 'falsch');
  await waitFor(() => $(w, '[data-testid="loginmsg"]')?.textContent.includes('stimmt nicht'), 'Fehlermeldung Anmeldung');
  submit('eltern@test.de', 'geheim123');
  await waitFor(() => $(w, '[data-testid="sessions"]'), 'Übersicht');
  const text = () => w.document.body.textContent;
  assert.eq($$(w, '[data-testid="sessions"] tbody tr').length, 2);
  assert.ok(text().includes('abgeschlossen') && text().includes('unterbrochen'));
  assert.ok(text().includes('Rechenzeichen verwechselt') && text().includes('Zehner um 1 daneben'), 'Fehlerarten erkannt');
  assert.ok(text().includes('Entwicklung'));
  assert.ok(!/eyJ|jwt-/.test(text()), 'kein Token sichtbar');
  click(w, 'tr[data-id="22222222-2222-4222-8222-222222222222"]');
  const d = $(w, '[data-testid="detail"]').textContent;
  assert.ok(d.includes('62 − 28 = 34') && d.includes('90') && d.includes('offen 49'), 'Detail: Aufgabe, Antworten, offene Aufgaben');
  click(w, '[data-act="back"]');
  click(w, '[data-act="csv"]');
  click(w, '[data-act="json"]');
  click(w, '[data-act="code"]');
  await waitFor(() => $(w, '[data-testid="code"]'), 'Kopplungscode');
  assert.ok(/^[A-HJ-NP-Z2-9]{8}$/.test($(w, '[data-testid="code"]').textContent));
  assert.ok(text().includes('Test'), 'Gerät aufgelistet');

  // Keine Anmeldedaten gespeichert
  closeApps();
  assert.ok(!JSON.stringify({ ...localStorage }).match(/jwt-|geheim/) && !JSON.stringify({ ...sessionStorage }).match(/jwt-|geheim/));
  const w2 = await openApp('/app/eltern.html');
  assert.ok($(w2, 'form[data-form="login"]'), 'nach Neuladen wieder Anmeldung nötig');
  $(w2, 'input[name=email]').value = 'andere@test.de';
  $(w2, 'input[name=password]').value = 'pw-other';
  $(w2, 'form').dispatchEvent(new w2.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => w2.document.body.textContent.includes('Noch keine Übungen'), 'fremdes Konto sieht nichts');
  assert.ok(!w2.document.body.textContent.includes('34 + 28'));

  const w3 = await openApp('/app/eltern.html');
  $(w3, 'input[name=email]').value = 'eltern@test.de';
  $(w3, 'input[name=password]').value = 'geheim123';
  $(w3, 'form').dispatchEvent(new w3.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => $(w3, '[data-testid="sessions"]'), 'Übersicht 2');
  click(w3, '[data-act="wipe"]');
  $(w3, '#wipeword').value = 'LÖSCHEN';
  click(w3, '[data-act="wipe-go"]');
  await waitFor(() => w3.document.body.textContent.includes('Noch keine Übungen'), 'Daten gelöscht');
  assert.eq((await sbState()).sessions.length, 0);
  assert.ok(w3.document.body.textContent.includes('getrennt'), 'Geräte getrennt');
});

// ---------- Migration von V1.0 ----------

test('E2E Update von V1.0: vorhandener Fortschritt bleibt, Sicherung und Version werden angelegt', async () => {
  localStorage.clear();
  closeApps();
  const v1 = { v: 1, sessions: 7, tasks: 70, firstTry: 49, best: { 'mul:2': 2, 'add:1': 3 }, played: { 'mul:2': 3, 'add:1': 4 }, history: [{ d: '2026-10-29', op: 'mul', level: 2, ok: 7, n: 10, s: 2 }], trouble: { 'mul|7|8': { op: 'mul', a: 7, b: 8, level: 2, misses: 2, ok: 0 } }, streak: { last: '2026-10-29', days: 3 }, prefs: { level: 2 } };
  localStorage.setItem('mathe.progress.v1', JSON.stringify(v1));
  const w = await openApp();
  assert.eq($(w, '[data-level="2"]').getAttribute('aria-pressed'), 'true');
  assert.eq($(w, '[data-op="mul"] .op-stars').textContent, '★★☆', 'alte Sterne sichtbar');
  assert.ok($(w, '[data-action="trouble"]').textContent.includes('(1)'), 'knifflige Aufgabe übernommen');
  assert.eq(JSON.parse(localStorage.getItem('mathe.progress.v1')), v1, 'Daten unverändert');
  assert.eq(JSON.parse(localStorage.getItem('mathe.backup.v1.0')), v1, 'Sicherung angelegt');
  assert.eq(JSON.parse(localStorage.getItem('mathe.meta')).schema, 2);
  click(w, '[data-action="progress"]');
  assert.ok($(w, '.progress').textContent.includes('Übungen gemacht: 7'));
  // Neue Übung baut auf den alten Daten auf
  click(w, '[data-action="home"]');
  click(w, '[data-op="mul"]');
  finish(w);
  assert.eq(store().sessions, 8);
});

// ---------- Offline & Updates ----------

test('Offline: Service Worker aktiv, alle Dateien (auch Elternseite) im Cache', async () => {
  const w = await fresh();
  const reg = await w.navigator.serviceWorker.ready;
  await waitFor(() => reg.active && reg.active.state === 'activated', 'SW aktiviert');
  const sw = await (await fetch('/app/sw.js')).text();
  const list = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);
  assert.ok(list.length >= 18, `Precache-Liste (${list.length})`);
  assert.ok(list.includes('./eltern.html') && list.includes('./js/sync.js'));
  for (const f of ['eltern.webmanifest', 'icons/eltern-touch-icon.png', 'icons/eltern-icon-192.png', 'icons/eltern-icon-512.png', 'icons/eltern-icon.svg']) assert.ok(list.includes(`./${f}`), `${f} im Precache`);
  const build = sw.match(/const BUILD = '(\w+)'/)[1];
  assert.ok(build !== 'dev', 'Produktions-Build');
  const cache = await w.caches.open(`mathe-${build}`);
  const cached = (await cache.keys()).map((r) => new URL(r.url).pathname);
  for (const u of list) assert.ok(cached.includes(new URL(u, 'http://x/app/').pathname), `${u} im Cache`);
});

test('Offline: App startet, 50 Aufgaben lassen sich offline rechnen und werden lokal protokolliert', async () => {
  await fresh();
  const w0 = frames[0].contentWindow;
  await w0.navigator.serviceWorker.ready;
  await waitFor(() => w0.navigator.serviceWorker.controller, 'SW übernimmt die Seite');
  closeApps();
  await fetch('/__offline');
  let netDown = false;
  try {
    await fetch('/app/index.html', { cache: 'no-store' });
  } catch {
    netDown = true;
  }
  assert.ok(netDown, 'Testaufbau: Netzwerk ist wirklich weg');
  try {
    const w = await openApp();
    await waitFor(() => $(w, 'h1'), 'App-Oberfläche offline');
    assert.ok(w.navigator.serviceWorker.controller, 'Seite wird vom Service Worker bedient');
    click(w, '[data-op="div"]');
    finish(w);
    assert.eq([store().sessions, records()[0].status, records()[0].tasks.length], [1, 'abgeschlossen', 50]);
    for (const f of ['manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 'js/app.js', 'js/sync.js', 'eltern.html']) {
      assert.ok((await w.fetch(f)).ok, `${f} offline`);
    }
    const p = await openApp('/app/eltern.html');
    await waitFor(() => $(p, 'form[data-form="login"]'), 'Elternseite offline erreichbar (Anmeldung braucht Netz)');
  } finally {
    await fetch('/__online');
    closeApps();
  }
});

test('PWA-Update: neue Version übernimmt, alter Cache verschwindet, Daten und Offlinebetrieb bleiben', async () => {
  const w = await fresh();
  const reg = await w.navigator.serviceWorker.ready;
  await waitFor(() => w.navigator.serviceWorker.controller, 'SW übernimmt');
  const oldBuild = (await (await fetch('/app/sw.js')).text()).match(/const BUILD = '(\w+)'/)[1];
  click(w, '[data-op="add"]');
  solveN(w, 7);
  click(w, '[data-action="pause"]');
  const before = JSON.stringify(records());
  const progressBefore = localStorage.getItem('mathe.progress.v1');
  await w.caches.open('mathe-uralt'); // Überbleibsel einer sehr alten Version
  await fetch('/__swbuild?b=neuebuild1');
  await reg.update();
  await waitFor(async () => (await w.caches.keys()).includes('mathe-neuebuild1'), 'neuer Cache angelegt');
  await waitFor(async () => !(await w.caches.keys()).includes(`mathe-${oldBuild}`), 'alter Cache entfernt');
  const keys = await w.caches.keys();
  assert.eq(keys.filter((k) => k.startsWith('mathe-')), ['mathe-neuebuild1'], 'nur der neue Cache bleibt');
  assert.eq(JSON.stringify(records()), before, 'Lernprotokoll unverändert');
  assert.eq(localStorage.getItem('mathe.progress.v1'), progressBefore);
  closeApps();
  await fetch('/__offline');
  try {
    const w2 = await openApp();
    await waitFor(() => $(w2, 'h1'), 'App nach Update offline');
    assert.ok($(w2, '[data-action="resume"]').textContent.includes('7/50'), 'unterbrochene Übung nach Update fortsetzbar');
  } finally {
    await fetch('/__online');
    await fetch('/__swbuild?b=');
    closeApps();
  }
});

test('Eltern-Icon: eigenes Manifest und Touch-Icon, Kinder-App unverändert, alles offline verfügbar', async () => {
  const w = await fresh();
  const p = await openApp('/app/eltern.html');
  const link = (sel) => $(p, sel);
  assert.eq(link('link[rel="apple-touch-icon"]').getAttribute('href'), 'icons/eltern-touch-icon.png');
  assert.eq(link('meta[name="apple-mobile-web-app-title"]').content, 'Mathe Eltern');
  const m = await (await p.fetch(link('link[rel="manifest"]').href)).json();
  assert.eq([m.name, m.short_name, m.start_url, m.display], ['Mathe Eltern', 'Mathe Eltern', 'eltern.html', 'standalone']);
  assert.ok(new URL(m.start_url, link('link[rel="manifest"]').href).pathname.endsWith('/eltern.html'), 'Verknüpfung öffnet eltern.html');
  for (const i of m.icons) assert.ok((await p.fetch(new URL(i.src, link('link[rel="manifest"]').href))).ok, i.src);
  const img = await new Promise((res, rej) => Object.assign(new p.Image(), { onload() { res(this); }, onerror: rej, src: link('link[rel="apple-touch-icon"]').href }));
  assert.eq([img.naturalWidth, img.naturalHeight], [180, 180], 'Touch-Icon 180×180');
  // Kinder-App: Icon und Manifest unverändert
  assert.eq($(w, 'link[rel="apple-touch-icon"]').getAttribute('href'), 'icons/apple-touch-icon.png');
  assert.eq($(w, 'link[rel="manifest"]').getAttribute('href'), 'manifest.webmanifest');
  assert.eq($(w, 'meta[name="apple-mobile-web-app-title"]').content, 'Mathe-Trainer');
  assert.ok(!$(p, 'link[rel="manifest"]').href.endsWith('/manifest.webmanifest'), 'getrennte Manifeste');
});

// ---------- Regression: „Alle Lerndaten löschen“ (Elternübersicht) ----------

async function seedParentData() {
  await sbReset();
  await fetch('/__sbfnfail?fn=delete_all_data&status=0');
  const code = await sbCode();
  const dev = await (await fetch('/sb/rest/v1/rpc/redeem_pairing_code', { method: 'POST', headers: SBH('test-anon-key'), body: JSON.stringify({ p_code: code, p_label: 'Test' }) })).json();
  const rec = { v: 1, id: '33333333-3333-4333-8333-333333333333', rev: 1, start: '2026-10-30T09:00:00.000Z', last: '2026-10-30T09:00:00.000Z', end: null, op: 'add', level: 1, mode: 'op', total: 50, processed: 1, firstOk: 1, secondOk: 0, failed: 0, helps: 0, open: 49, status: 'unterbrochen', tasks: [] };
  await fetch('/sb/rest/v1/rpc/sync_push', { method: 'POST', headers: SBH('test-anon-key'), body: JSON.stringify({ p_token: dev.token, p_sessions: [rec] }) });
}
async function parentPage() {
  closeApps();
  const w = await openApp('/app/eltern.html');
  $(w, 'input[name=email]').value = 'eltern@test.de';
  $(w, 'input[name=password]').value = 'geheim123';
  $(w, 'form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => $(w, '[data-testid="sessions"]'), 'Übersicht');
  return w;
}
const wipeWith = (w, word) => {
  click(w, '[data-act="wipe"]');
  assert.ok($(w, '[data-testid="wipe-dialog"]'), 'Bestätigungsdialog erscheint auf der Seite (kein natives prompt)');
  $(w, '#wipeword').value = word;
  click(w, '[data-act="wipe-go"]');
};
const msgOf = (w) => ($(w, '[data-testid="msg"]') || { textContent: '' }).textContent;

for (const [name, word] of [
  ['exakt', 'LÖSCHEN'],
  ['mit Leerzeichen am Ende (iOS-Vorschlagsleiste)', 'LÖSCHEN '],
  ['Kleinbuchstaben', 'löschen'],
  ['zerlegtes Ö (Unicode NFD)', 'LO\u0308SCHEN'],
  ['ohne Umlaut', 'loeschen'],
]) {
  test(`Regression Löschen: Bestätigung ${name} löscht alle Lerndaten und zeigt das Ergebnis`, async () => {
    await seedParentData();
    const w = await parentPage();
    assert.eq((await sbState()).sessions.length, 1);
    wipeWith(w, word);
    await waitFor(() => msgOf(w).includes('gelöscht'), 'Erfolgsmeldung bleibt sichtbar');
    const st = await sbState();
    assert.eq([st.sessions.length, st.revoked], [0, 1], 'Server: keine Übungen mehr, Gerät getrennt');
    assert.ok(w.document.body.textContent.includes('Noch keine Übungen') && w.document.body.textContent.includes('getrennt'), 'Übersicht aktualisiert');
    assert.ok(!$(w, '[data-testid="wipe-dialog"]'), 'Dialog geschlossen');
  });
}

test('Regression Löschen: falsche Eingabe oder Abbrechen löscht nichts und sagt es deutlich', async () => {
  await seedParentData();
  const w = await parentPage();
  wipeWith(w, 'ABC');
  assert.ok(msgOf(w).includes('nichts gelöscht'), 'Hinweis bei falscher Eingabe: ' + msgOf(w));
  assert.ok($(w, '[data-testid="wipe-dialog"]'), 'Dialog bleibt offen für neuen Versuch');
  click(w, '[data-act="wipe-cancel"]');
  assert.ok(!$(w, '[data-testid="wipe-dialog"]'));
  assert.eq((await sbState()).sessions.length, 1);
});

test('Regression Löschen: Serverfehler wird angezeigt (Meldung wird nicht überschrieben), Daten bleiben, erneuter Versuch klappt', async () => {
  await seedParentData();
  const w = await parentPage();
  await fetch('/__sbfnfail?fn=delete_all_data&status=500');
  wipeWith(w, 'LÖSCHEN');
  await waitFor(() => msgOf(w).includes('fehlgeschlagen'), 'Fehlermeldung sichtbar');
  assert.ok(msgOf(w).includes('nichts gelöscht'));
  assert.eq((await sbState()).sessions.length, 1);
  assert.ok($(w, '[data-testid="sessions"]'), 'Übersicht zeigt weiterhin die Daten');
  await fetch('/__sbfnfail?fn=delete_all_data&status=0');
  wipeWith(w, 'LÖSCHEN');
  await waitFor(() => msgOf(w).includes('gelöscht und'), 'zweiter Versuch erfolgreich');
  assert.eq((await sbState()).sessions.length, 0);
});

test('Regression Löschen: abgelaufene Anmeldung führt zur Anmeldeseite mit Hinweis, nichts wird gelöscht', async () => {
  await seedParentData();
  const w = await parentPage();
  await fetch('/__sbfnfail?fn=delete_all_data&status=401');
  wipeWith(w, 'LÖSCHEN');
  await waitFor(() => $(w, 'form[data-form="login"]'), 'Anmeldeseite');
  assert.ok($(w, '[data-testid="loginmsg"]').textContent.includes('abgelaufen'));
  await fetch('/__sbfnfail?fn=delete_all_data&status=0');
  assert.eq((await sbState()).sessions.length, 1);
});
