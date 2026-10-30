// Oberfläche: ein Container, Bildschirme werden per innerHTML neu gezeichnet.
// Alle Texte stammen aus dem Code (keine Fremdeingaben), Ereignisse laufen über Delegation.
import { generateSet, taskText } from './generator.js';
import { explain, praise, tryAgain } from './explain.js';
import { pressDigit, backspace, toNumber } from './input.js';
import { Session } from './session.js';
import { Progress, createStorage } from './progress.js';
import { LearningLog, buildRecord, saveActive, loadActive, clearActive, newId, STATUS } from './log.js';
import { migrate } from './migrate.js';
import { Sync } from './sync.js';
import { CONFIG } from './config.js';
import { BUILD } from './version.js';

const OP_INFO = {
  add: { icon: '+', name: 'Plus' },
  sub: { icon: '−', name: 'Minus' },
  mul: { icon: '×', name: 'Mal' },
  div: { icon: '÷', name: 'Geteilt' },
  mix: { icon: '🎲', name: 'Gemischt' },
  trouble: { icon: '🔁', name: 'Knifflige Aufgaben' },
};
const LEVEL_NAMES = { 0: '', 1: 'Leicht', 2: 'Mittel', 3: 'Schwer' };
// Eine Einheit = genau 50 bewertete Aufgaben. Davon dürfen bis zu 5 knifflige Aufgaben aus früheren
// Übungen sein (gekennzeichnet). Danach folgt eine unbewertete Wiederholungsrunde (höchstens 10 Aufgaben).
const TASKS_PER_SESSION = 50;
const MAX_REPEATS = 5;
const SHOWN_MISSED = 10;

const root = document.getElementById('app');
const storage = createStorage();
const migration = migrate(storage);
const progress = new Progress(storage);
const log = new LearningLog(storage);
const nowIso = () => new Date().toISOString();
const sync = new Sync({ storage, log, config: CONFIG, onChange: updateSyncBadges });

let screen = 'home';
let game = null; // { session, meta, op, level, mode, input, praiseIdx }
let offlineReady = false;
let updateAvailable = false;
let pairMsg = '';

const stars = (n, total = 3) => '★'.repeat(n) + '☆'.repeat(total - n);
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');

// ---------- Zwischenstand / Protokoll ----------

function persist(status) {
  const { meta, session } = game;
  meta.rev += 1;
  log.put(buildRecord(meta, session, status, nowIso()));
  if (status === STATUS.done) clearActive(storage);
  else saveActive(storage, meta, session, game.input);
  sync.trigger(status === STATUS.active ? 8000 : 500);
}

function loadPaused() {
  const a = loadActive(storage);
  if (!a) return null;
  // Eine beim Start noch als aktiv vermerkte Einheit gilt als unterbrochen (z. B. App beendet).
  const rec = log.get(a.meta.id);
  if (!rec || rec.status === STATUS.active) {
    a.meta.rev = Math.max(a.meta.rev, rec ? rec.rev : 0) + 1;
    log.put(buildRecord(a.meta, a.session, STATUS.paused, nowIso()));
    saveActive(storage, a.meta, a.session, a.input);
  }
  return a;
}
let paused = loadPaused();

// ---------- Bildschirme ----------

function syncText() {
  const labels = {
    synchron: '☁︎ Gesichert',
    sendet: '☁︎ Wird gesichert …',
    wartet: `☁︎ ${sync.pending().length} warten auf Sicherung`,
    offline: '☁︎ Offline – wird später gesichert',
    fehler: '☁︎ Sicherung später',
    widerrufen: '☁︎ Kopplung beendet',
  };
  return labels[sync.status()] || '';
}

function updateSyncBadges() {
  for (const el of document.querySelectorAll('[data-sync]')) el.textContent = syncText();
}

function renderHome() {
  const level = progress.state.prefs.level;
  const trouble = progress.troubleCount();
  const streak = progress.state.streak;
  const opButton = (op) => {
    const best = progress.state.best[`${op}:${level}`] || 0;
    return `<button class="op op-${op}" data-action="start" data-op="${op}">
      <span class="op-icon">${OP_INFO[op].icon}</span>
      <span class="op-name">${OP_INFO[op].name}</span>
      <span class="op-stars" aria-label="${best} von 3 Sternen">${stars(best)}</span>
    </button>`;
  };
  const resume = paused
    ? `<div class="resume">
        <button class="primary" data-action="resume">▶ Weiter üben: ${OP_INFO[paused.meta.op].name}${LEVEL_NAMES[paused.meta.level] ? ' · ' + LEVEL_NAMES[paused.meta.level] : ''} (${paused.session.progress.phase === 'main' ? paused.session.results.length : paused.session.tasks.length}/${paused.session.tasks.length})</button>
        <button class="link" data-action="discard">verwerfen</button>
      </div>`
    : '';
  return `<main class="home">
    <h1>Mathe-Trainer</h1>
    <p class="lead">Was möchtest du heute üben?</p>
    ${resume}
    <div class="levels" role="group" aria-label="Schwierigkeit">
      ${[1, 2, 3]
        .map(
          (l) => `<button class="level" data-action="level" data-level="${l}" aria-pressed="${l === level}">
            <span class="level-stars">${'★'.repeat(l)}</span>${LEVEL_NAMES[l]}</button>`,
        )
        .join('')}
    </div>
    <div class="ops">${['add', 'sub', 'mul', 'div'].map(opButton).join('')}</div>
    ${opButton('mix').replace('class="op ', 'class="op op-wide ')}
    <div class="row">
      ${trouble ? `<button class="secondary" data-action="trouble">🔁 Knifflige Aufgaben (${trouble})</button>` : ''}
      <button class="secondary" data-action="progress">📊 Mein Fortschritt</button>
    </div>
    <p class="status">${streak.days > 1 ? `🔥 ${streak.days} Tage in Folge geübt! · ` : ''}${offlineReady ? '✓ Funktioniert auch ohne Internet' : 'Offline-Modus wird vorbereitet …'}</p>
    <p class="status"><span data-sync>${syncText()}</span> <button class="link" data-action="settings">⚙︎ Eltern</button></p>
  </main>`;
}

function renderGame() {
  const { session, input } = game;
  const task = session.current;
  const p = session.progress;
  const review = p.phase === 'review';
  const status = session.status;
  const locked = session.resolved;
  const label = review ? `Wiederholung ${p.n}/${p.total}` : `Aufgabe ${p.n}/${p.total}`;
  const pct = Math.round(((p.n - 1 + (locked ? 1 : 0)) / p.total) * 100);

  let feedback = '<p class="msg">Tippe das Ergebnis ein.</p>';
  if (status === 'hint') {
    feedback = `<p class="msg warn">${tryAgain(game.praiseIdx)}</p><p class="tip">${explain(task).hint}</p>`;
  } else if (status === 'solved') {
    const second = session.attempts > 1;
    feedback = `<p class="msg good">${second ? 'Prima, beim zweiten Mal geschafft! 🎉' : `${praise(game.praiseIdx)} 🎉`}</p>`;
  } else if (status === 'failed') {
    const ex = explain(task);
    feedback = `<p class="msg info">Das war knifflig – so geht's:</p>
      <ol class="steps">${ex.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
      <p class="result">${ex.result}</p>
      ${review ? '' : '<p class="tip">Diese Aufgabe üben wir am Ende noch einmal.</p>'}`;
  }

  const key = (k, text, extra = '') =>
    `<button class="key ${extra}" data-key="${k}" ${locked && k !== 'ok' ? 'disabled' : ''} aria-label="${k === 'back' ? 'Löschen' : k === 'ok' ? (locked ? 'Weiter' : 'Fertig') : k}">${text}</button>`;
  const okDisabled = !locked && input === '' ? 'disabled' : '';
  const tag = review ? '<span class="tag">🔁 Wiederholung (zählt nicht mit)</span>' : task.repeat ? '<span class="tag">🔁 Aus früheren Übungen</span>' : '';

  return `<main class="game">
    <header>
      <button class="quit" data-action="pause" aria-label="Pause – später weiterüben">⏸</button>
      <div class="count">${label}</div>
    </header>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
    <section class="card">
      ${tag}
      <div class="task"><span data-testid="task">${taskText(task)}</span> =</div>
      <div class="answer ${status}" data-testid="answer" aria-live="polite">${input || '&nbsp;'}</div>
    </section>
    <section class="feedback" data-testid="feedback">${feedback}</section>
    <div class="keypad" role="group" aria-label="Zahlentasten">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => key(d, d)).join('')}
      ${key('back', '⌫', 'key-back')}
      ${key(0, 0)}
      <button class="key key-ok ${locked ? 'next' : ''}" data-key="ok" ${okDisabled} aria-label="${locked ? 'Weiter' : 'Fertig'}">${locked ? '➜' : '✓'}</button>
    </div>
  </main>`;
}

function renderResult() {
  const { summary } = game.result;
  const msg =
    summary.stars === 3 ? 'Fantastisch! 🏆' : summary.stars === 2 ? 'Sehr gut gemacht! 👏' : summary.stars === 1 ? 'Gut gemacht – bleib dran! 💪' : 'Übung macht die Meisterin oder den Meister! 🌱';
  const shown = summary.missed.slice(0, SHOWN_MISSED);
  const more = summary.missed.length - shown.length;
  const missed = summary.missed.length
    ? `<div class="missed"><h2>Das üben wir bald wieder:</h2><ul>${shown.map((t) => `<li>${taskText(t)} = <b>${t.answer}</b></li>`).join('')}</ul>${more > 0 ? `<p class="tip">… und ${more} weitere</p>` : ''}</div>`
    : '<p class="lead">Keine Fehler – wow! 🎉</p>';
  return `<main class="done">
    <h1>${msg}</h1>
    <div class="big-stars" aria-label="${summary.stars} von 3 Sternen">${stars(summary.stars)}</div>
    <p class="lead"><b>${summary.firstTry} von ${summary.total}</b> gleich beim ersten Mal richtig</p>
    <ul class="facts">
      <li>Beim zweiten Versuch richtig: <b>${summary.later}</b></li>
      <li>Rechenhilfe gebraucht: <b>${summary.helps}</b>×</li>
      <li>Noch nicht gekonnt: <b>${summary.failed}</b></li>
    </ul>
    ${missed}
    <div class="row col">
      <button class="primary" data-action="again">Noch eine Runde</button>
      <button class="secondary" data-action="home">Zum Start</button>
    </div>
    <p class="status" data-sync>${syncText()}</p>
  </main>`;
}

function renderProgress() {
  const s = progress.state;
  const rows = ['add', 'sub', 'mul', 'div', 'mix']
    .map(
      (op) => `<tr><th scope="row">${OP_INFO[op].icon} ${OP_INFO[op].name}</th>${[1, 2, 3]
        .map((l) => `<td><span class="stars" aria-label="${s.best[`${op}:${l}`] || 0} von 3 Sternen">${stars(s.best[`${op}:${l}`] || 0)}</span><small>${s.played[`${op}:${l}`] || 0}×</small></td>`)
        .join('')}</tr>`,
    )
    .join('');
  const quote = s.tasks ? Math.round((s.firstTry / s.tasks) * 100) : 0;
  return `<main class="progress">
    <header><button class="quit" data-action="home" aria-label="Zurück">←</button><div class="count">Mein Fortschritt</div></header>
    <table>
      <thead><tr><th></th><th>Leicht</th><th>Mittel</th><th>Schwer</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <ul class="facts">
      <li>Übungen gemacht: <b>${s.sessions}</b></li>
      <li>Aufgaben gerechnet: <b>${s.tasks}</b></li>
      <li>Gleich richtig: <b>${quote} %</b></li>
      <li>Tage in Folge: <b>${s.streak.days}</b></li>
      <li>Knifflige Aufgaben: <b>${progress.troubleCount()}</b></li>
    </ul>
    <p class="status">Version ${BUILD}${progress.storage.persistent === false ? ' · Speicher nur vorübergehend' : ''}</p>
  </main>`;
}

function renderSettings() {
  const st = sync.status();
  let body;
  if (!sync.configured) {
    body = '<p>Die Sicherung in der Cloud ist (noch) nicht eingerichtet. Die App funktioniert vollständig lokal.</p>';
  } else if (!sync.paired || st === 'widerrufen') {
    body = `<p>Mit dem Eltern-Konto koppeln: Die Eltern erzeugen in der Elternübersicht einen Code und geben ihn hier ein.</p>
      <input id="code" class="code" inputmode="text" autocapitalize="characters" autocomplete="off" maxlength="9" placeholder="CODE" aria-label="Kopplungscode">
      <button class="primary" data-action="pair">Koppeln</button>
      <p class="msg" data-testid="pairmsg">${pairMsg}</p>`;
  } else {
    body = `<p>Gekoppelt seit ${fmtTime(sync.state.device.at)}. Letzte Sicherung: ${fmtTime(sync.state.lastOk)}.</p>
      <p data-sync data-testid="syncstate">${syncText()}</p>
      <button class="secondary" data-action="syncnow">Jetzt sichern</button>
      <button class="danger" data-action="unpair">Kopplung lösen (Elternfrage)</button>`;
  }
  return `<main class="settings">
    <header><button class="quit" data-action="home" aria-label="Zurück">←</button><div class="count">Für Eltern</div></header>
    <section class="panel">${body}</section>
    <section class="panel">
      <p><a href="eltern.html" class="secondary linkbtn">Elternübersicht öffnen</a></p>
      <button class="danger" data-action="wipe">Alle Daten auf diesem Gerät löschen (Elternfrage)</button>
    </section>
    <p class="status">Version ${BUILD} · Datenspeicher: ${migration.status}</p>
  </main>`;
}

function render() {
  root.innerHTML = { home: renderHome, game: renderGame, result: renderResult, progress: renderProgress, settings: renderSettings }[screen]();
  if (screen === 'home' && updateAvailable) location.reload();
}

// ---------- Aktionen ----------

function begin(session, meta, op, level, mode) {
  game = { session, meta, op, level, mode, input: '', praiseIdx: Math.floor(Math.random() * 6) };
  screen = 'game';
  persist(STATUS.active);
  render();
}

function startGame(op, level, mode = 'op') {
  let tasks;
  if (mode === 'trouble') {
    tasks = progress.troubleTasks({ max: TASKS_PER_SESSION });
  } else {
    const repeats = progress.troubleTasks({ op, level, max: MAX_REPEATS });
    tasks = generateSet(op, level, TASKS_PER_SESSION, Math.random, repeats);
  }
  if (!tasks.length) return;
  if (paused && !confirm('Es gibt eine unterbrochene Übung. Neu starten und die alte verwerfen?')) return;
  if (paused) {
    clearActive(storage);
    paused = null;
  }
  const meta = { id: newId(), start: nowIso(), op, level: mode === 'trouble' ? 0 : level, mode, total: tasks.length, rev: 0 };
  begin(new Session(tasks), meta, op, level, mode);
}

function finishGame() {
  const { session, op, level, mode } = game;
  const summary = session.summary();
  progress.recordSession({ mode, op, level, summary });
  persist(STATUS.done);
  game.result = { summary, op, level, mode };
  screen = 'result';
}

function pressKey(k) {
  if (screen !== 'game') return;
  const s = game.session;
  if (k === 'ok') {
    if (s.resolved) {
      s.advance();
      game.input = '';
      game.praiseIdx += 1;
      if (s.status === 'done') finishGame();
      else persist(STATUS.active);
    } else if (game.input !== '') {
      s.submit(toNumber(game.input));
      if (s.status === 'hint') game.input = '';
      persist(STATUS.active);
    }
  } else if (!s.resolved) {
    game.input = k === 'back' ? backspace(game.input) : pressDigit(game.input, k);
  }
  render();
}

// Einfache Elternfrage vor destruktiven Aktionen (kein Sicherheitsmerkmal, nur Schutz vor Versehen).
function parentGate() {
  const a = 13 + Math.floor(Math.random() * 7);
  const b = 13 + Math.floor(Math.random() * 7);
  const reply = prompt(`Elternfrage: Wie viel ist ${a} × ${b}?`);
  return reply !== null && Number(reply) === a * b;
}

const actions = {
  level(el) {
    progress.setLevel(Number(el.dataset.level));
  },
  start(el) {
    startGame(el.dataset.op, progress.state.prefs.level);
    return true;
  },
  trouble() {
    startGame('mix', 0, 'trouble');
    return true;
  },
  resume() {
    const { meta, session, input } = paused;
    paused = null;
    game = { session, meta, op: meta.op, level: meta.level, mode: meta.mode, input, praiseIdx: 0 };
    screen = 'game';
    persist(STATUS.active);
  },
  discard() {
    if (!confirm('Unterbrochene Übung wirklich verwerfen?')) return true;
    clearActive(storage);
    paused = null;
  },
  progress() {
    screen = 'progress';
  },
  settings() {
    pairMsg = '';
    screen = 'settings';
  },
  home() {
    screen = 'home';
  },
  again() {
    startGame(game.op, game.level, game.mode);
    return true;
  },
  pause() {
    persist(STATUS.paused);
    paused = { meta: game.meta, session: game.session, input: game.input };
    game = null;
    screen = 'home';
  },
  async pair() {
    const code = document.getElementById('code').value;
    pairMsg = 'Koppeln …';
    root.querySelector('[data-testid="pairmsg"]').textContent = pairMsg;
    try {
      await sync.pair(code);
      pairMsg = '';
    } catch (e) {
      pairMsg = e.status === 429 ? 'Zu viele Versuche. Bitte später erneut.' : e.status ? 'Der Code ist ungültig oder abgelaufen.' : e.message === 'Failed to fetch' || e.name === 'TypeError' || e.name === 'AbortError' ? 'Keine Verbindung. Bitte online erneut versuchen.' : e.message;
    }
    render();
    return true;
  },
  syncnow() {
    sync.syncNow();
    return true;
  },
  unpair() {
    if (!parentGate()) return true;
    sync.unpair();
  },
  wipe() {
    if (!parentGate()) return true;
    log.deleteAll();
    clearActive(storage);
    paused = null;
    progress.reset();
    sync.state.acked = {};
    sync.save();
    screen = 'home';
  },
};

root.addEventListener('click', async (e) => {
  const keyEl = e.target.closest('[data-key]');
  if (keyEl && !keyEl.disabled) return pressKey(keyEl.dataset.key === 'back' || keyEl.dataset.key === 'ok' ? keyEl.dataset.key : Number(keyEl.dataset.key));
  const el = e.target.closest('[data-action]');
  if (!el) return;
  let handled = actions[el.dataset.action](el); // true = hat bereits selbst gerendert bzw. nichts zu tun
  if (handled && typeof handled.then === 'function') handled = await handled; // nur asynchrone Aktionen warten
  if (!handled) render();
});

document.addEventListener('keydown', (e) => {
  if (screen !== 'game' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^[0-9]$/.test(e.key)) pressKey(Number(e.key));
  else if (e.key === 'Backspace') pressKey('back');
  else if (e.key === 'Enter') pressKey('ok');
});

// Doppeltipp-Zoom auf iOS verhindern (Tasten sollen schnell reagieren).
document.addEventListener('gesturestart', (e) => e.preventDefault());

// Synchronisieren: beim Start, bei wiederhergestellter Verbindung und beim Zurückkehren in die App.
window.addEventListener('online', () => sync.trigger(0));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') sync.trigger(0);
});

render();
sync.trigger(1000);

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // erste Installation
    updateAvailable = true; // neue Version: beim Start-Bildschirm neu laden, nie mitten in einer Übung
    if (screen === 'home') location.reload();
  });
  navigator.serviceWorker
    .register('sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => {
      offlineReady = true;
      if (screen === 'home') render();
    })
    .catch(() => {});
}
