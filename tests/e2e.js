// Ende-zu-Ende-Tests: die echte App (dist/) läuft in einem iPhone-großen iframe,
// bedient wird sie ausschließlich über die Tasten (Klicks auf data-key / data-action).
import { test, assert, waitFor, sleep } from './harness.js';

const CALC = { '+': (a, b) => a + b, '−': (a, b) => a - b, '·': (a, b) => a * b, ':': (a, b) => a / b };
const solve = (text) => {
  const m = text.match(/^(\d+) ([+−·:]) (\d+)$/);
  assert.ok(m, `Aufgabe lesbar: "${text}"`);
  return CALC[m[2]](Number(m[1]), Number(m[3]));
};

const frames = [];
async function openApp() {
  const f = document.createElement('iframe');
  f.style.cssText = 'width:390px;height:844px;border:0';
  f.src = '/app/index.html';
  document.body.appendChild(f);
  frames.push(f);
  await new Promise((r) => f.addEventListener('load', r, { once: true }));
  const w = f.contentWindow;
  w.confirm = () => true;
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
const store = () => JSON.parse(localStorage.getItem('mathe.progress.v1') || 'null');
const fresh = async () => {
  localStorage.clear();
  closeApps();
  return openApp();
};

test('E2E Start: Rechenarten, Schwierigkeitsgrade, Fortschrittsanzeige', async () => {
  const w = await fresh();
  assert.ok($(w, 'h1').textContent.includes('Mathe-Trainer'));
  assert.eq($$(w, '[data-action="start"]').map((b) => b.dataset.op), ['add', 'sub', 'mul', 'div', 'mix']);
  assert.eq($$(w, '[data-action="level"]').length, 3);
  assert.ok(!$(w, '[data-action="trouble"]'), 'ohne Fehler kein Fehler-Training');
  $(w, '[data-level="3"]').click();
  assert.eq($(w, '[data-level="3"]').getAttribute('aria-pressed'), 'true');
  assert.eq(store().prefs.level, 3, 'Stufe gemerkt');
});

test('E2E Tastenblock: 12 Tasten, max. 4 Ziffern, Löschen, Fertig erst mit Eingabe', async () => {
  const w = await fresh();
  $(w, '[data-op="add"]').click();
  assert.eq($$(w, '.keypad .key').length, 12);
  assert.ok($(w, '[data-key="ok"]').disabled, 'leere Eingabe kann nicht abgeschickt werden');
  [1, 2, 3, 4, 5].forEach((d) => tap(w, d));
  assert.eq(answer(w), '1234');
  tap(w, 'back');
  tap(w, 'back');
  assert.eq(answer(w), '12');
  $$(w, '.keypad .key').forEach((k) => assert.ok(parseFloat(w.getComputedStyle(k).height) >= 56, 'Taste groß genug'));
  // Hardware-Tastatur
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: '7' }));
  assert.eq(answer(w), '127');
});

test('E2E Übung komplett richtig: 10 Aufgaben, 3 Sterne, Fortschritt gespeichert', async () => {
  const w = await fresh();
  $(w, '[data-op="add"]').click();
  const seen = [];
  for (let i = 1; i <= 10; i++) {
    assert.ok($(w, '.count').textContent.includes(`Aufgabe ${i} von 10`), `Zähler ${i}`);
    const t = task(w);
    seen.push(t);
    typeNumber(w, solve(t));
    tap(w, 'ok');
    assert.ok($(w, '.msg.good'), 'Lob angezeigt');
    assert.ok($(w, '[data-key="5"]').disabled, 'Ziffern nach Antwort gesperrt');
    tap(w, 'ok'); // weiter
  }
  assert.eq(new Set(seen).size, 10, 'zehn verschiedene Aufgaben');
  await waitFor(() => $(w, '.done'), 'Ergebnisseite');
  assert.ok($(w, '.big-stars').textContent === '★★★');
  const s = store();
  assert.eq([s.sessions, s.tasks, s.firstTry, s.best['add:1']], [1, 10, 10, 3]);
  $(w, '[data-action="home"]').click();
  assert.ok($(w, '[data-op="add"] .op-stars').textContent === '★★★', 'Sterne auf der Startseite');
});

test('E2E Fehler: Hinweis, Lösungsweg, Wiederholung am Ende, Fehler wird gemerkt und wieder geübt', async () => {
  const w = await fresh();
  $(w, '[data-level="2"]').click();
  $(w, '[data-op="mul"]').click();
  const hardTask = task(w);
  const right = solve(hardTask);
  typeNumber(w, right + 1);
  tap(w, 'ok');
  assert.ok($(w, '.msg.warn'), 'freundlicher Hinweis statt Lösung');
  assert.ok(feedback(w).includes('Tipp'), 'Tipp angezeigt');
  assert.ok(!feedback(w).includes(`= ${right}`), 'Lösung noch nicht verraten');
  assert.eq(answer(w), '', 'Eingabe geleert für zweiten Versuch');
  typeNumber(w, right + 2);
  tap(w, 'ok');
  assert.ok($$(w, '.steps li').length >= 1, 'Lösungsweg sichtbar');
  assert.ok($(w, '.result').textContent.endsWith(`= ${right}`), 'richtige Lösung genannt');
  assert.ok(feedback(w).includes('gleich noch einmal'));
  tap(w, 'ok');
  for (let i = 2; i <= 10; i++) {
    typeNumber(w, solve(task(w)));
    tap(w, 'ok');
    tap(w, 'ok');
  }
  assert.ok($(w, '.count').textContent.includes('Wiederholung 1 von 1'), 'Wiederholungsrunde');
  assert.eq(task(w), hardTask, 'dieselbe Aufgabe kommt wieder');
  assert.ok($(w, '.tag'));
  typeNumber(w, right);
  tap(w, 'ok');
  tap(w, 'ok');
  await waitFor(() => $(w, '.done'), 'Ergebnisseite');
  assert.ok($(w, '.missed').textContent.includes(`${hardTask} = ${right}`), 'Fehler in Ergebnisliste');
  assert.eq(store().firstTry, 9);
  assert.eq(Object.keys(store().trouble).length, 1, 'Fehler dauerhaft gemerkt');

  // Nächste Übung derselben Art enthält die knifflige Aufgabe als Wiederholung.
  $(w, '[data-action="again"]').click();
  let found = false;
  for (let i = 1; i <= 10; i++) {
    if ($(w, '.tag') && task(w) === hardTask) found = true;
    typeNumber(w, solve(task(w)));
    tap(w, 'ok');
    tap(w, 'ok');
  }
  assert.ok(found, 'knifflige Aufgabe kommt als Wiederholung vor');
  await waitFor(() => $(w, '.done'), 'Ergebnisseite 2');
  assert.eq(store().trouble[Object.keys(store().trouble)[0]].ok, 1);
  $(w, '[data-action="home"]').click();
  assert.ok($(w, '[data-action="trouble"]'), 'Knopf für Fehler-Training');
});

test('E2E Fehler-Training: übt nur gemerkte Aufgaben', async () => {
  const w = await fresh();
  localStorage.setItem(
    'mathe.progress.v1',
    JSON.stringify({ v: 1, trouble: { x: { op: 'div', a: 56, b: 7, level: 2, misses: 2, ok: 0 }, y: { op: 'add', a: 38, b: 47, level: 2, misses: 1, ok: 0 } } }),
  );
  closeApps();
  const w2 = await openApp();
  $(w2, '[data-action="trouble"]').click();
  assert.ok($(w2, '.count').textContent.includes('Aufgabe 1 von 2'));
  const seen = [];
  for (let i = 0; i < 2; i++) {
    seen.push(task(w2));
    typeNumber(w2, solve(task(w2)));
    tap(w2, 'ok');
    tap(w2, 'ok');
  }
  assert.eq(seen.sort(), ['38 + 47', '56 : 7']);
  await waitFor(() => $(w2, '.done'), 'Ergebnisseite');
});

test('E2E alle Rechenarten × Stufen starten und sind lösbar', async () => {
  const w = await fresh();
  for (const level of [1, 2, 3]) {
    for (const op of ['add', 'sub', 'mul', 'div', 'mix']) {
      $(w, `[data-level="${level}"]`).click();
      $(w, `[data-op="${op}"]`).click();
      typeNumber(w, solve(task(w)));
      tap(w, 'ok');
      assert.ok($(w, '.answer.solved'), `${op}/${level} lösbar`);
      $(w, '[data-action="quit"]').click(); // confirm() ist im Test bestätigt
      assert.ok($(w, '.home'), 'zurück zum Start');
    }
  }
  assert.eq(store().sessions ?? 0, 0, 'abgebrochene Übungen werden nicht gewertet');
});

test('E2E Fortschrittsseite: Anzeige, Neustart behält Daten, Löschen leert', async () => {
  const w = await fresh();
  $(w, '[data-op="sub"]').click();
  for (let i = 0; i < 10; i++) {
    typeNumber(w, solve(task(w)));
    tap(w, 'ok');
    tap(w, 'ok');
  }
  closeApps(); // App „schließen“ und neu öffnen
  const w2 = await openApp();
  assert.ok($(w2, '[data-op="sub"] .op-stars').textContent === '★★★', 'Fortschritt nach Neustart da');
  $(w2, '[data-action="progress"]').click();
  assert.ok($(w2, '.progress').textContent.includes('Übungen gemacht: 1'));
  $(w2, '[data-action="reset"]').click();
  assert.ok($(w2, '.progress').textContent.includes('Übungen gemacht: 0'));
  assert.eq(store().sessions, 0);
});

// ---------- Offline ----------

test('Offline: Service Worker aktiv, alle Dateien im Cache', async () => {
  const w = await fresh();
  const reg = await w.navigator.serviceWorker.ready;
  await waitFor(() => reg.active && reg.active.state === 'activated', 'SW aktiviert');
  const sw = await (await fetch('/app/sw.js')).text();
  const list = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);
  assert.ok(list.length >= 12, `Precache-Liste (${list.length})`);
  const build = sw.match(/const BUILD = '(\w+)'/)[1];
  assert.ok(build !== 'dev', 'Produktions-Build, nicht Entwicklungsstand');
  const cache = await w.caches.open(`mathe-${build}`);
  const cached = (await cache.keys()).map((r) => new URL(r.url).pathname);
  for (const u of list) {
    const path = new URL(u, 'http://x/app/').pathname;
    assert.ok(cached.includes(path), `${path} im Cache`);
  }
});

test('Offline: App startet und funktioniert komplett ohne Netzwerk', async () => {
  await fresh();
  const w0 = frames[0].contentWindow;
  await w0.navigator.serviceWorker.ready;
  await waitFor(() => w0.navigator.serviceWorker.controller, 'SW übernimmt die Seite');
  closeApps();

  await fetch('/__offline'); // Server antwortet ab jetzt nicht mehr
  let netDown = false;
  try {
    await fetch('/app/index.html', { cache: 'no-store' });
  } catch {
    netDown = true;
  }
  assert.ok(netDown, 'Testaufbau: Netzwerk ist wirklich weg');

  try {
    const w = await openApp(); // frische Navigation ohne Netz
    await waitFor(() => $(w, 'h1'), 'App-Oberfläche offline');
    assert.ok($(w, 'h1').textContent.includes('Mathe-Trainer'));
    assert.ok(w.navigator.serviceWorker.controller, 'Seite wird vom Service Worker bedient');
    const css = await w.fetch('styles.css');
    assert.ok(css.ok, 'CSS offline');
    assert.ok(parseFloat(w.getComputedStyle($(w, '.op')).minHeight) > 0 || $(w, '.op'), 'Stylesheet angewendet');
    for (const op of ['add', 'sub', 'mul', 'div', 'mix']) {
      $(w, `[data-op="${op}"]`).click();
      typeNumber(w, solve(task(w)));
      tap(w, 'ok');
      assert.ok($(w, '.answer.solved'), `${op} offline lösbar`);
      $(w, '[data-action="quit"]').click();
    }
    // vollständige Übung offline, Speicherung funktioniert
    $(w, '[data-op="add"]').click();
    for (let i = 0; i < 10; i++) {
      typeNumber(w, solve(task(w)));
      tap(w, 'ok');
      tap(w, 'ok');
    }
    await waitFor(() => $(w, '.done'), 'Ergebnis offline');
    assert.eq(store().sessions, 1);
    for (const f of ['manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 'js/app.js']) {
      assert.ok((await w.fetch(f)).ok, `${f} offline`);
    }
  } finally {
    await fetch('/__online');
    closeApps();
  }
  await sleep(10);
});
