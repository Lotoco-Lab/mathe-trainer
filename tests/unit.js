// Unit-Tests: Rechenlogik, Rechenhilfen, Eingabe, Übungsablauf, Lernfortschritt.
import { test, assert } from './harness.js';
import { OPS, LEVELS, createRng, generateTask, generateSet, makeTask, taskText, taskKey } from '/app/js/generator.js';
import { explain } from '/app/js/explain.js';
import { pressDigit, backspace, toNumber, MAX_DIGITS } from '/app/js/input.js';
import { Session, starsFor } from '/app/js/session.js';
import { Progress, sanitize, emptyState, createStorage } from '/app/js/progress.js';

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), raw: m };
};
const SEEDS = 300;
const carryAdd = (t) => (t.a % 10) + (t.b % 10) >= 10;
const borrowSub = (t) => t.a % 10 < t.b % 10;

// ---------- Rechenlogik ----------

for (const op of OPS) {
  for (const level of LEVELS) {
    test(`Generator ${op} Stufe ${level}: Aufgaben gültig und Ergebnis stimmt (${SEEDS} Stichproben)`, () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const t = generateTask(op, level, createRng(seed));
        const expected = { add: t.a + t.b, sub: t.a - t.b, mul: t.a * t.b, div: t.a / t.b }[op];
        assert.eq(t.answer, expected, taskText(t));
        assert.ok(Number.isInteger(t.answer) && t.answer > 0, `Ergebnis ganzzahlig/positiv: ${taskText(t)}`);
        assert.ok(Number.isInteger(t.a) && Number.isInteger(t.b) && t.b > 0, `Operanden: ${taskText(t)}`);
        assert.ok(t.answer <= 1000, `Zahlenraum: ${taskText(t)}`);
        assert.ok(String(t.answer).length <= 4, 'Antwort passt in 4 Ziffern');
        if (op === 'add' && level === 1) assert.ok(!carryAdd(t) && t.answer < 100, `L1 ohne Übertrag ${taskText(t)}`);
        if (op === 'add' && level === 2) assert.ok(carryAdd(t) && t.answer <= 100, `L2 mit Übertrag ${taskText(t)}`);
        if (op === 'add' && level === 3) assert.ok(t.a > 100 && t.answer <= 1000, `L3 ${taskText(t)}`);
        if (op === 'sub' && level === 1) assert.ok(!borrowSub(t) && t.a < 100, `L1 ohne Übergang ${taskText(t)}`);
        if (op === 'sub' && level === 2) assert.ok(borrowSub(t) && t.a < 100, `L2 mit Übergang ${taskText(t)}`);
        if (op === 'sub' && level === 3) assert.ok(t.a >= 200 && t.a < 1000, `L3 ${taskText(t)}`);
        if (op === 'mul' && level === 1) assert.ok([t.a, t.b].some((x) => [2, 5, 10].includes(x)) && t.a <= 10 && t.b <= 10, `L1 ${taskText(t)}`);
        if (op === 'mul' && level === 2) assert.ok(t.a <= 10 && t.b <= 10, `L2 ${taskText(t)}`);
        if (op === 'mul' && level === 3) assert.ok(t.a >= 12 && t.a <= 30 && t.b >= 3 && t.b <= 9, `L3 ${taskText(t)}`);
        if (op === 'div' && level === 1) assert.ok([2, 5, 10].includes(t.b) && t.answer <= 10, `L1 ${taskText(t)}`);
        if (op === 'div' && level === 2) assert.ok(t.b >= 3 && t.b <= 9 && t.answer <= 10, `L2 ${taskText(t)}`);
        if (op === 'div' && level === 3) assert.ok(t.b >= 3 && t.b <= 9 && t.answer >= 11 && t.a <= 250, `L3 ${taskText(t)}`);
      }
    });
  }
}

test('Generator ist mit gleichem Seed reproduzierbar', () => {
  assert.eq(generateSet('mix', 2, 10, createRng(42)), generateSet('mix', 2, 10, createRng(42)));
});

test('Übungseinheit: 10 verschiedene Aufgaben je Rechenart und Stufe', () => {
  for (const op of [...OPS, 'mix']) {
    for (const level of LEVELS) {
      for (let seed = 1; seed <= 25; seed++) {
        const set = generateSet(op, level, 10, createRng(seed));
        assert.eq(set.length, 10, `${op}/${level}`);
        assert.eq(new Set(set.map(taskKey)).size, 10, `Duplikate in ${op}/${level}/seed ${seed}`);
        if (op !== 'mix') assert.ok(set.every((t) => t.op === op && t.level === level));
      }
    }
  }
});

test('Gemischte Übung enthält alle vier Rechenarten', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const ops = new Set(generateSet('mix', 1, 10, createRng(seed)).map((t) => t.op));
    assert.eq(ops.size, 4, `seed ${seed}`);
  }
});

test('Wiederholungsaufgaben werden eingemischt und nicht doppelt erzeugt', () => {
  const extra = [{ ...makeTask('mul', 6, 7, 2), repeat: true }];
  for (let seed = 1; seed <= 50; seed++) {
    const set = generateSet('mul', 2, 10, createRng(seed), extra);
    assert.eq(set.length, 10);
    assert.eq(set.filter((t) => t.a === 6 && t.b === 7).length, 1);
    assert.eq(new Set(set.map(taskKey)).size, 10);
  }
});

// ---------- Rechenhilfen ----------

test('Rechenhilfen: jede Schrittzeile ist rechnerisch korrekt und endet beim Ergebnis', () => {
  const sym = { '+': (x, y) => x + y, '−': (x, y) => x - y, '·': (x, y) => x * y, ':': (x, y) => x / y };
  let checked = 0;
  for (const op of OPS) {
    for (const level of LEVELS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const t = generateTask(op, level, createRng(seed));
        const ex = explain(t);
        assert.ok(ex.hint.length > 10 && ex.steps.length >= 1, `Erklärung vorhanden ${taskText(t)}`);
        assert.eq(ex.result, `${taskText(t)} = ${t.answer}`);
        for (const line of [...ex.steps, ex.result]) {
          const m = line.match(/^(\d+(?: [+·] \d+)*) ([+−·:]) (\d+) = (\d+)/);
          // "7 + 7 + 7 = 21" (Mehrfachsumme) wird als Ganzes geprüft
          if (m && !m[1].includes(' ')) {
            assert.eq(sym[m[2]](Number(m[1]), Number(m[3])), Number(m[4]), `Zeile "${line}" bei ${taskText(t)}`);
            checked++;
          } else if (/^\d+( \+ \d+)+ = \d+/.test(line)) {
            const [lhs, rhs] = line.split('=');
            assert.eq(lhs.split('+').reduce((s, x) => s + Number(x), 0), parseInt(rhs, 10), `Summe "${line}"`);
            checked++;
          }
        }
      }
    }
  }
  assert.ok(checked > 3000, `genug Zeilen geprüft (${checked})`);
});

test('Rechenhilfe Division nennt Umkehraufgabe', () => {
  const ex = explain(makeTask('div', 42, 6, 2));
  assert.ok(ex.hint.includes('Welche Zahl mal 6 ergibt 42'));
  assert.ok(ex.steps.includes('7 · 6 = 42'));
});

test('Rechenhilfe Übertrag: Zehner-Brücke wird erklärt', () => {
  assert.ok(explain(makeTask('add', 34, 28, 2)).steps.join('|').includes('erst 54 + 6 = 60'));
  assert.ok(explain(makeTask('sub', 62, 28, 2)).steps.join('|').includes('erst 42 − 2 = 40'));
});

// ---------- Eingabe ----------

test('Eingabe: Ziffern, Löschen, keine führende Null, maximal 4 Stellen', () => {
  let v = '';
  v = pressDigit(v, 0);
  assert.eq(v, '0');
  v = pressDigit(v, 0);
  assert.eq(v, '0');
  v = pressDigit(v, 7);
  assert.eq(v, '7');
  v = pressDigit(pressDigit(pressDigit(v, 1), 2), 3);
  assert.eq(v, '7123');
  assert.eq(v.length, MAX_DIGITS);
  assert.eq(pressDigit(v, 9), '7123', 'fünfte Ziffer wird ignoriert');
  assert.eq(backspace('7123'), '712');
  assert.eq(backspace(''), '');
  assert.eq(toNumber(''), null);
  assert.eq(toNumber('0'), 0);
  assert.eq(toNumber('0042'), 42);
});

// ---------- Übungsablauf ----------

const quiz = () => [makeTask('add', 1, 2, 1), makeTask('add', 3, 4, 1), makeTask('add', 5, 5, 1)];

test('Ablauf: alles im ersten Versuch richtig → 3 Sterne, keine Wiederholung', () => {
  const s = new Session(quiz());
  for (const t of quiz()) {
    assert.eq(s.submit(t.answer), 'solved');
    s.advance();
  }
  assert.eq(s.status, 'done');
  const sum = s.summary();
  assert.eq([sum.firstTry, sum.failed, sum.later, sum.stars], [3, 0, 0, 3]);
});

test('Ablauf: falsch → Hinweis → zweiter Versuch; zweimal falsch → Lösung; Fehler werden wiederholt', () => {
  const s = new Session(quiz());
  assert.eq(s.submit(99), 'hint');
  assert.eq(s.submit(99), 'failed'); // Aufgabe 1 verfehlt
  assert.eq(s.submit(5), 'failed', 'Eingabe nach Lösung wird ignoriert');
  s.advance();
  assert.eq(s.submit(1), 'hint'); // Aufgabe 2: erst falsch …
  assert.eq(s.submit(7), 'solved'); // … dann richtig
  s.advance();
  assert.eq(s.submit(10), 'solved'); // Aufgabe 3 sofort richtig
  s.advance();
  assert.eq(s.phase, 'review');
  assert.eq(s.progress, { n: 1, total: 2, phase: 'review' });
  assert.eq(s.current.answer, 3);
  s.submit(3);
  s.advance();
  s.submit(7);
  s.advance();
  assert.eq(s.status, 'done');
  const sum = s.summary();
  assert.eq([sum.firstTry, sum.failed, sum.later, sum.total], [1, 1, 1, 3]);
  assert.eq(sum.missed.map(taskText), ['1 + 2', '3 + 4']);
  assert.eq(s.reviewSolved, 2);
});

test('Ablauf: advance ohne Abschluss der Aufgabe ändert nichts', () => {
  const s = new Session(quiz());
  s.advance();
  assert.eq(s.progress.n, 1);
  assert.eq(s.status, 'asking');
});

test('Sterne-Schwellen bei 10 Aufgaben', () => {
  assert.eq([10, 9, 8, 7, 6, 5, 4, 0].map((n) => starsFor(n, 10)), [3, 3, 2, 2, 1, 1, 0, 0]);
});

// ---------- Lernfortschritt ----------

const finishedSummary = (tasks, wrongIdx = []) => {
  const s = new Session(tasks);
  tasks.forEach((t, i) => {
    if (wrongIdx.includes(i)) {
      s.submit(-1);
      s.submit(-1);
    } else s.submit(t.answer);
    s.advance();
  });
  return s.summary();
};

test('Fortschritt: Sitzung wird gespeichert und nach Neuladen wiedergefunden', () => {
  const store = memStorage();
  const p = new Progress(store, () => '2026-10-30');
  const tasks = generateSet('add', 1, 10, createRng(5));
  assert.ok(p.recordSession({ mode: 'op', op: 'add', level: 1, summary: finishedSummary(tasks, [0, 1]) }));
  const p2 = new Progress(store, () => '2026-10-30'); // „App neu gestartet"
  assert.eq(p2.state.sessions, 1);
  assert.eq(p2.state.tasks, 10);
  assert.eq(p2.state.firstTry, 8);
  assert.eq(p2.state.best['add:1'], 2);
  assert.eq(p2.state.played['add:1'], 1);
  assert.eq(p2.troubleCount(), 2);
  assert.eq(p2.state.history.length, 1);
});

test('Fortschritt: bestes Ergebnis wird nicht verschlechtert', () => {
  const p = new Progress(memStorage(), () => '2026-10-30');
  const tasks = generateSet('mul', 2, 10, createRng(1));
  p.recordSession({ mode: 'op', op: 'mul', level: 2, summary: finishedSummary(tasks) });
  p.recordSession({ mode: 'op', op: 'mul', level: 2, summary: finishedSummary(tasks, [0, 1, 2, 3, 4, 5, 6, 7]) });
  assert.eq(p.state.best['mul:2'], 3);
  assert.eq(p.state.played['mul:2'], 2);
});

test('Fortschritt: schwierige Aufgaben werden wiederholt und nach zweimal richtig entfernt', () => {
  const p = new Progress(memStorage(), () => '2026-10-30');
  const hard = makeTask('mul', 7, 8, 2);
  p.recordSession({ mode: 'op', op: 'mul', level: 2, summary: finishedSummary([hard], [0]) });
  assert.eq(p.troubleCount(), 1);
  const rep = p.troubleTasks({ op: 'mul', level: 2, max: 3 });
  assert.eq(rep.map(taskText), ['7 · 8']);
  assert.ok(rep[0].repeat && rep[0].answer === 56);
  assert.eq(p.troubleTasks({ op: 'add', level: 2, max: 3 }).length, 0, 'andere Rechenart: keine');
  assert.eq(p.troubleTasks({ op: 'mix', level: 2, max: 3 }).length, 1, 'gemischt: ja');
  assert.eq(p.troubleTasks({ op: 'mul', level: 3, max: 3 }).length, 0, 'andere Stufe: keine');
  p.recordSession({ mode: 'op', op: 'mul', level: 2, summary: finishedSummary([hard]) });
  assert.eq(p.troubleCount(), 1, 'erst einmal gekonnt');
  p.recordSession({ mode: 'op', op: 'mul', level: 2, summary: finishedSummary([hard], [0]) });
  p.recordSession({ mode: 'op', op: 'mul', level: 2, summary: finishedSummary([hard]) });
  assert.eq(p.troubleCount(), 1, 'Fehler setzt Zähler zurück');
  p.recordSession({ mode: 'op', op: 'mul', level: 2, summary: finishedSummary([hard]) });
  assert.eq(p.troubleCount(), 0, 'zweimal in Folge gekonnt → gelernt');
});

test('Fortschritt: Fehler-Training zählt nicht als Rechenart-Ergebnis', () => {
  const p = new Progress(memStorage(), () => '2026-10-30');
  p.recordSession({ mode: 'trouble', op: 'mix', level: 0, summary: finishedSummary([makeTask('add', 1, 1, 1)]) });
  assert.eq(p.state.best, {});
  assert.eq(p.state.sessions, 1);
});

test('Fortschritt: Tage-Serie', () => {
  let day = '2026-10-28';
  const p = new Progress(memStorage(), () => day);
  const rec = () => p.recordSession({ mode: 'op', op: 'add', level: 1, summary: finishedSummary([makeTask('add', 1, 1, 1)]) });
  rec();
  rec();
  assert.eq(p.state.streak.days, 1, 'gleicher Tag zählt einmal');
  day = '2026-10-29';
  rec();
  assert.eq(p.state.streak.days, 2);
  day = '2026-10-31'; // einen Tag ausgelassen
  rec();
  assert.eq(p.state.streak.days, 1);
  day = '2026-11-01';
  rec();
  assert.eq(p.state.streak.days, 2, 'Monatswechsel');
});

test('Fortschritt: Verlauf wird auf 30 Einträge begrenzt', () => {
  const p = new Progress(memStorage(), () => '2026-10-30');
  for (let i = 0; i < 45; i++) p.recordSession({ mode: 'op', op: 'add', level: 1, summary: finishedSummary([makeTask('add', 1, 1, 1)]) });
  assert.eq(p.state.history.length, 30);
  assert.eq(p.state.sessions, 45);
});

test('Fortschritt: beschädigte oder manipulierte Daten führen nicht zum Absturz', () => {
  for (const bad of ['{kaputt', 'null', '[]', '"x"', '{"v":2}', '{"v":1,"sessions":"abc","best":{"zzz":9},"trouble":{"x":{"op":"div","a":5,"b":0}}}']) {
    const store = memStorage();
    store.setItem('mathe.progress.v1', bad);
    const p = new Progress(store);
    assert.eq(p.state.best, {}, bad);
    assert.eq(p.troubleCount(), 0, bad);
    assert.ok(Number.isInteger(p.state.sessions));
  }
  const s = sanitize({ v: 1, best: { 'add:1': 99 }, trouble: { k: { op: 'div', a: 7, b: 2, level: 1, misses: 1, ok: 0 } } });
  assert.eq(s.best['add:1'], 3, 'Sterne begrenzt');
  assert.eq(Object.keys(s.trouble).length, 0, 'Division mit Rest verworfen');
});

test('Fortschritt: Zurücksetzen löscht alles; defekter Speicher stürzt nicht ab', () => {
  const store = memStorage();
  const p = new Progress(store, () => '2026-10-30');
  p.recordSession({ mode: 'op', op: 'add', level: 1, summary: finishedSummary([makeTask('add', 1, 1, 1)]) });
  p.reset();
  assert.eq(new Progress(store).state, emptyState());
  const broken = { getItem: () => { throw new Error('gesperrt'); }, setItem: () => { throw new Error('voll'); } };
  const pb = new Progress(broken);
  assert.eq(pb.state, emptyState());
  assert.eq(pb.recordSession({ mode: 'op', op: 'add', level: 1, summary: finishedSummary([makeTask('add', 1, 1, 1)]) }), false);
});

test('Speicher: createStorage liefert nutzbaren Speicher', () => {
  const s = createStorage();
  s.setItem('mathe.test', '1');
  assert.eq(s.getItem('mathe.test'), '1');
  s.removeItem('mathe.test');
  assert.eq(s.getItem('mathe.test'), null);
});
