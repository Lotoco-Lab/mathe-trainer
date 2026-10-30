// Oberfläche: ein Container, Bildschirme werden per innerHTML neu gezeichnet.
// Alle Texte stammen aus dem Code (keine Fremdeingaben), Ereignisse laufen über Delegation.
import { generateSet, taskText } from './generator.js';
import { explain, praise, tryAgain } from './explain.js';
import { pressDigit, backspace, toNumber } from './input.js';
import { Session } from './session.js';
import { Progress, createStorage } from './progress.js';
import { BUILD } from './version.js';

const OP_INFO = {
  add: { icon: '+', name: 'Plus' },
  sub: { icon: '−', name: 'Minus' },
  mul: { icon: '×', name: 'Mal' },
  div: { icon: '÷', name: 'Geteilt' },
  mix: { icon: '🎲', name: 'Gemischt' },
};
const LEVEL_NAMES = { 1: 'Leicht', 2: 'Mittel', 3: 'Schwer' };
const TASKS_PER_SESSION = 10;
const MAX_REPEATS = 3;

const root = document.getElementById('app');
const progress = new Progress(createStorage());
let screen = 'home';
let game = null; // { session, op, level, mode, input, praiseIdx }
let offlineReady = false;

const stars = (n, total = 3) => '★'.repeat(n) + '☆'.repeat(total - n);

// ---------- Bildschirme ----------

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
  return `<main class="home">
    <h1>Mathe-Trainer</h1>
    <p class="lead">Was möchtest du heute üben?</p>
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
  </main>`;
}

function renderGame() {
  const { session, input } = game;
  const task = session.current;
  const p = session.progress;
  const review = p.phase === 'review';
  const status = session.status;
  const locked = session.resolved;
  const label = review ? `Wiederholung ${p.n} von ${p.total}` : `Aufgabe ${p.n} von ${p.total}`;
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
      ${review ? '' : '<p class="tip">Diese Aufgabe üben wir gleich noch einmal.</p>'}`;
  }

  const key = (k, text, extra = '') =>
    `<button class="key ${extra}" data-key="${k}" ${locked && k !== 'ok' ? 'disabled' : ''} aria-label="${k === 'back' ? 'Löschen' : k === 'ok' ? (locked ? 'Weiter' : 'Fertig') : k}">${text}</button>`;
  const okDisabled = !locked && input === '' ? 'disabled' : '';

  return `<main class="game">
    <header>
      <button class="quit" data-action="quit" aria-label="Übung beenden">✕</button>
      <div class="count">${label}</div>
    </header>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
    <section class="card">
      ${task.repeat || review ? '<span class="tag">🔁 Zum Wiederholen</span>' : ''}
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
    summary.stars === 3 ? 'Fantastisch! 🏆' : summary.stars === 2 ? 'Sehr gut gemacht! 👏' : summary.stars === 1 ? 'Gut gemacht – bleib dran! 💪' : 'Übung macht die Meisterin! 🌱';
  const missed = summary.missed.length
    ? `<div class="missed"><h2>Das üben wir bald wieder:</h2><ul>${summary.missed
        .map((t) => `<li>${taskText(t)} = <b>${t.answer}</b></li>`)
        .join('')}</ul></div>`
    : '<p class="lead">Keine Fehler – wow! 🎉</p>';
  return `<main class="done">
    <h1>${msg}</h1>
    <div class="big-stars" aria-label="${summary.stars} von 3 Sternen">${stars(summary.stars)}</div>
    <p class="lead"><b>${summary.firstTry} von ${summary.total}</b> gleich beim ersten Mal richtig</p>
    ${missed}
    <div class="row col">
      <button class="primary" data-action="again">Noch eine Runde</button>
      <button class="secondary" data-action="home">Zum Start</button>
    </div>
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
    <button class="danger" data-action="reset">Fortschritt löschen</button>
    <p class="status">Version ${BUILD}${progress.storage.persistent === false ? ' · Speicher nur vorübergehend' : ''}</p>
  </main>`;
}

function render() {
  root.innerHTML = { home: renderHome, game: renderGame, result: renderResult, progress: renderProgress }[screen]();
}

// ---------- Aktionen ----------

function startGame(op, level, mode = 'op') {
  let tasks;
  if (mode === 'trouble') {
    tasks = progress.troubleTasks({ max: TASKS_PER_SESSION });
  } else {
    const repeats = progress.troubleTasks({ op, level, max: MAX_REPEATS });
    tasks = generateSet(op, level, TASKS_PER_SESSION, Math.random, repeats);
  }
  if (!tasks.length) return;
  game = { session: new Session(tasks), op, level, mode, input: '', praiseIdx: Math.floor(Math.random() * 6) };
  screen = 'game';
  render();
}

function finishGame() {
  const { session, op, level, mode } = game;
  const summary = session.summary();
  progress.recordSession({ mode, op, level, summary });
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
    } else if (game.input !== '') {
      s.submit(toNumber(game.input));
      if (s.status === 'hint') game.input = '';
    }
  } else if (!s.resolved) {
    game.input = k === 'back' ? backspace(game.input) : pressDigit(game.input, k);
  }
  render();
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
  progress() {
    screen = 'progress';
  },
  home() {
    screen = 'home';
  },
  again() {
    startGame(game.op, game.level, game.mode);
    return true;
  },
  quit() {
    if (!confirm('Übung abbrechen? Dein Ergebnis dieser Runde geht dann verloren.')) return true;
    screen = 'home';
  },
  reset() {
    if (!confirm('Wirklich den ganzen Fortschritt löschen?')) return true;
    progress.reset();
  },
};

root.addEventListener('click', (e) => {
  const keyEl = e.target.closest('[data-key]');
  if (keyEl && !keyEl.disabled) return pressKey(keyEl.dataset.key === 'back' || keyEl.dataset.key === 'ok' ? keyEl.dataset.key : Number(keyEl.dataset.key));
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const handled = actions[el.dataset.action](el); // true = hat bereits selbst gerendert bzw. nichts zu tun
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

render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => {
      offlineReady = true;
      if (screen === 'home') render();
    })
    .catch(() => {});
}
