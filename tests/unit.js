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

test('Übungseinheit: genau 50 bewertete Aufgaben je Rechenart und Stufe, möglichst ohne Dubletten', () => {
  for (const op of [...OPS, 'mix']) {
    for (const level of LEVELS) {
      for (let seed = 1; seed <= 25; seed++) {
        const set = generateSet(op, level, 50, createRng(seed));
        assert.eq(set.length, 50, `${op}/${level}`);
        const unique = new Set(set.map(taskKey)).size;
        const small = (op === 'div' || op === 'mul') && level === 1; // kleiner Aufgabenvorrat (27–45 Möglichkeiten)
        assert.ok(unique >= (small ? 25 : 48), `zu viele Dubletten in ${op}/${level}/seed ${seed}: ${unique} verschieden`);
        if (op !== 'mix') assert.ok(set.every((t) => t.op === op && t.level === level));
      }
    }
  }
});

test('Gemischte Übung enthält alle vier Rechenarten', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const ops = new Set(generateSet('mix', 1, 50, createRng(seed)).map((t) => t.op));
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

// =====================================================================================
// V1.1: Lernprotokoll, Zwischenstand, Migration, Fehlerarten, Auswertung, Synchronisierung
// =====================================================================================
import { LearningLog, buildRecord, saveActive, loadActive, clearActive, newId, isUuid, STATUS } from '/app/js/log.js';
import { migrate, PROGRESS_KEY, BACKUP_KEY, META_KEY } from '/app/js/migrate.js';
import { Sync, BACKOFF_MS } from '/app/js/sync.js';
import { classifyError, parseQuestion } from '/app/js/errors.js';
import { overview, errorTypes, trend, toCsv, weakSpots, toRecords } from '/app/js/stats.js';
import { REVIEW_MAX } from '/app/js/session.js';

const tick = () => {
  let n = 0;
  return () => new Date(Date.UTC(2026, 9, 30, 10, 0, n++)).toISOString();
};
const tasks50 = (seed = 3) => generateSet('add', 1, 50, createRng(seed));

test('V1.1 Einheit: genau 50 bewertete Aufgaben, Wiederholung zusätzlich und höchstens ' + REVIEW_MAX, () => {
  const s = new Session(tasks50(), { now: tick() });
  assert.eq(s.progress, { n: 1, total: 50, phase: 'main' });
  for (let i = 0; i < 50; i++) {
    s.submit(-1);
    s.submit(-1); // alle falsch
    s.advance();
  }
  assert.eq(s.phase, 'review');
  assert.eq(s.progress.total, REVIEW_MAX, 'Wiederholungsrunde begrenzt');
  assert.eq(s.summary().total, 50);
  assert.eq(s.summary().processed, 50);
  assert.eq(s.summary().failed, 50);
  assert.eq(s.log.filter((e) => e.p === 'main').length, 50);
  for (let i = 0; i < REVIEW_MAX; i++) {
    s.submit(s.current.answer);
    s.advance();
  }
  assert.eq(s.status, 'done');
  assert.eq(s.summary().processed, 50, 'Wiederholung ändert die Wertung nicht');
  assert.eq(s.reviewSolved, REVIEW_MAX);
});

test('Protokolleintrag je Aufgabe: Aufgabe, Ergebnis, Antworten, Versuche, Hilfe, Zeitpunkt', () => {
  const s = new Session([makeTask('add', 34, 28, 2), makeTask('mul', 7, 8, 2), makeTask('sub', 90, 45, 1)], { now: tick() });
  s.submit(62);
  s.advance(); // 1. Versuch
  s.submit(54);
  s.submit(56);
  s.advance(); // 2. Versuch
  s.submit(1);
  s.submit(2);
  s.advance(); // verfehlt
  assert.eq(s.log.map((e) => [e.q, e.a, e.g, e.n, e.h, e.ok, e.p]), [
    ['34 + 28', 62, [62], 1, false, true, 'main'],
    ['7 · 8', 56, [54, 56], 2, true, true, 'main'],
    ['90 − 45', 45, [1, 2], 2, true, false, 'main'],
  ]);
  assert.ok(s.log.every((e) => /^2026-10-30T10:00:0\d\.000Z$/.test(e.t)), 'ISO-Zeitstempel');
  assert.ok(s.log[0].t < s.log[1].t && s.log[1].t < s.log[2].t, 'Zeit steigt');
  assert.eq(s.phase, 'review');
  assert.eq(s.summary().helps, 2);
});

test('Zwischenstand: Session ↔ JSON, danach geht es exakt weiter', () => {
  const ts = tasks50(9);
  const a = new Session(ts, { now: tick() });
  for (let i = 0; i < 18; i++) {
    if (i % 5 === 0) a.submit(-1);
    a.submit(a.current.answer);
    a.advance();
  }
  a.submit(-1); // mitten in einer Aufgabe, 1 Fehlversuch
  const b = Session.fromJSON(JSON.parse(JSON.stringify(a)), { now: tick() });
  assert.eq(b.progress, a.progress);
  assert.eq([b.status, b.attempts, b.given, b.results.length], [a.status, a.attempts, a.given, a.results.length]);
  for (const s of [a, b]) {
    s.submit(s.current.answer);
    s.advance();
  }
  assert.eq(JSON.stringify(a.summary()), JSON.stringify(b.summary()));
  assert.eq(b.log.length, 19);
});

test('Zwischenstand: ungültige Daten werden abgelehnt', () => {
  for (const bad of [null, {}, { tasks: [], queue: [], results: [], log: [], given: [], phase: 'x', status: 'asking', pos: 0 }, { ...new Session(quiz()).toJSON(), pos: 99 }, { ...new Session(quiz()).toJSON(), status: 'kaputt' }]) {
    let threw = false;
    try {
      Session.fromJSON(bad);
    } catch {
      threw = true;
    }
    assert.ok(threw, JSON.stringify(bad).slice(0, 60));
  }
});

test('Datensatz je Einheit: ID, Zeiten, Zähler und Status', () => {
  const clock = tick();
  const s = new Session(quiz(), { now: clock });
  const meta = { id: newId(), start: clock(), op: 'add', level: 1, mode: 'op', total: 3, rev: 1 };
  assert.ok(isUuid(meta.id));
  s.submit(3);
  s.advance();
  s.submit(1);
  s.submit(7);
  s.advance();
  let r = buildRecord(meta, s, STATUS.paused, '2026-10-30T10:30:00.000Z');
  assert.eq([r.status, r.processed, r.firstOk, r.secondOk, r.helps, r.open, r.end, r.last], ['unterbrochen', 2, 1, 1, 1, 1, null, '2026-10-30T10:30:00.000Z']);
  assert.eq([r.op, r.level, r.total, r.id, r.start], ['add', 1, 3, meta.id, meta.start]);
  s.submit(10);
  s.advance(); // Hauptteil fertig → Wiederholung der einen verfehlten Aufgabe
  assert.eq(s.phase, 'review');
  s.submit(7);
  s.advance();
  assert.eq(s.status, 'done');
  r = buildRecord(meta, s, STATUS.done, '2026-10-30T10:40:00.000Z');
  assert.eq([r.status, r.end, r.open], ['abgeschlossen', '2026-10-30T10:40:00.000Z', 0]);
  assert.eq(r.tasks.length, 4, '3 Aufgaben + 1 Wiederholung');
  assert.eq(r.tasks.filter((t) => t.p === 'review').length, 1);
  assert.eq(r.processed, 3, 'Wiederholung zählt nicht zu den bearbeiteten Aufgaben');
  const text = JSON.stringify(r);
  assert.ok(!/device|agent|lat|lon|name|mail/i.test(Object.keys(r).join(',')), 'keine personenbezogenen Felder: ' + Object.keys(r));
  assert.ok(text.length < 4000);
});

test('Protokoll-Speicher: speichern, aktualisieren, nur bestätigte alte Daten löschen', () => {
  const store = memStorage();
  const log = new LearningLog(store);
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const id = newId();
    ids.push(id);
    log.put({ v: 1, id, rev: 1, status: i === 0 ? 'aktiv' : 'unterbrochen', last: String(i), tasks: [] });
  }
  log.put({ v: 1, id: ids[1], rev: 2, status: 'abgeschlossen', last: '9', tasks: [] }); // Aktualisierung, kein Duplikat
  assert.eq(log.ids().length, 6);
  assert.eq(log.get(ids[1]).rev, 2);
  assert.eq(log.prune(2, () => false), 0, 'nichts löschen, solange nicht bestätigt');
  assert.eq(log.prune(2, (r) => r.id !== ids[3]), 2, 'ids[0] ist aktiv, ids[3] unbestätigt');
  assert.ok(log.get(ids[0]) && log.get(ids[3]), 'aktive und unbestätigte bleiben');
  store.setItem('mathe.s.' + ids[5], '{kaputt');
  assert.eq(log.get(ids[5]), null, 'beschädigter Datensatz wird ignoriert');
  log.deleteAll();
  assert.eq(log.ids(), []);
});

test('Zwischenstand speichern/laden und Schutz vor beschädigten Daten', () => {
  const store = memStorage();
  const s = new Session(quiz());
  s.submit(3);
  const meta = { id: newId(), start: 'x', op: 'add', level: 1, mode: 'op', total: 3, rev: 4 };
  assert.ok(saveActive(store, meta, s, '12'));
  const a = loadActive(store);
  assert.eq([a.meta.rev, a.input, a.session.status, a.session.log.length], [4, '12', 'solved', 1]);
  store.setItem('mathe.active.v1', '{"v":1,"meta":{"id":"kein-uuid"}}');
  assert.eq(loadActive(store), null);
  store.setItem('mathe.active.v1', 'kaputt');
  assert.eq(loadActive(store), null);
  clearActive(store);
  assert.eq(store.getItem('mathe.active.v1'), null);
});

// ---------- Migration von V1.0 ----------

const v1Data = () => {
  const store = memStorage();
  const p = new Progress(store, () => '2026-10-29');
  p.recordSession({ mode: 'op', op: 'mul', level: 2, summary: finishedSummary([makeTask('mul', 7, 8, 2), makeTask('mul', 3, 4, 2)], [0]) });
  p.setLevel(2);
  return { store, raw: store.getItem(PROGRESS_KEY) };
};

test('Migration: V1-Fortschritt bleibt erhalten, Sicherung wird angelegt', () => {
  const { store, raw } = v1Data();
  const before = JSON.parse(raw);
  assert.eq(migrate(store).status, 'migriert');
  assert.eq(JSON.parse(store.getItem(PROGRESS_KEY)), before, 'Fortschritt unverändert');
  assert.eq(store.getItem(BACKUP_KEY), raw, 'Sicherung = Original');
  assert.eq(JSON.parse(store.getItem(META_KEY)).schema, 2);
  const p = new Progress(store);
  assert.eq([p.state.sessions, p.state.prefs.level, p.troubleCount(), p.state.best['mul:2']], [1, 2, 1, 1]);
  assert.eq(migrate(store).status, 'ok', 'zweiter Start: nichts mehr zu tun');
});

test('Migration: Neuinstallation und ältere App-Version, die den Fortschritt weiterschreibt', () => {
  const fresh = memStorage();
  assert.eq(migrate(fresh).status, 'neu');
  assert.eq(fresh.getItem(BACKUP_KEY), null);
  const { store } = v1Data();
  migrate(store);
  const log = new LearningLog(store);
  const id = newId();
  log.put({ v: 1, id, rev: 1, status: 'aktiv', last: 'x', tasks: [] });
  new Progress(store, () => '2026-10-30').recordSession({ mode: 'op', op: 'add', level: 1, summary: finishedSummary([makeTask('add', 1, 1, 1)]) }); // „alte“ App speichert
  assert.eq(migrate(store).status, 'ok');
  assert.ok(log.get(id), 'neue Daten bleiben unberührt');
  assert.eq(new Progress(store).state.sessions, 2);
});

test('Migration: beschädigter Fortschritt wird aus der Sicherung wiederhergestellt', () => {
  const { store, raw } = v1Data();
  migrate(store);
  store.setItem(PROGRESS_KEY, '{kaputt');
  assert.eq(migrate(store).status, 'wiederhergestellt');
  assert.eq(store.getItem(PROGRESS_KEY), raw);
  const { store: s2 } = v1Data();
  s2.setItem(PROGRESS_KEY, 'Müll'); // schon vor der Migration defekt, keine Sicherung
  assert.eq(migrate(s2).status, 'verloren');
  assert.eq(new Progress(s2).state.sessions, 0, 'App startet trotzdem leer');
  assert.eq(migrate(memStorage()).status, 'neu');
  const broken = { getItem: () => 'x', setItem: () => { throw new Error('voll'); }, removeItem: () => {} };
  assert.eq(migrate(broken).status, 'verloren', 'Speicherfehler führen nicht zum Absturz');
});

// ---------- Fehlerarten und Auswertung ----------

test('Fehlerarten werden erkannt', () => {
  const c = (op, a, b, ans, g) => classifyError({ op, a, b }, ans, g);
  assert.eq(c('add', 34, 28, 62, 62), null);
  assert.eq(c('add', 34, 28, 62, 6), 'rechenzeichen'); // 34 − 28
  assert.eq(c('sub', 62, 28, 34, 90), 'rechenzeichen'); // 62 + 28
  assert.eq(c('add', 34, 28, 62, 52), 'zehnerfehler');
  assert.eq(c('add', 34, 28, 62, 63), 'einerfehler');
  assert.eq(c('add', 340, 280, 620, 520), 'hunderterfehler');
  assert.eq(c('mul', 7, 8, 56, 49), 'nachbaraufgabe'); // 7·7
  assert.eq(c('mul', 7, 8, 56, 64), 'nachbaraufgabe'); // 8·8
  assert.eq(c('sub', 91, 28, 63, 36), 'ziffernvertauscht');
  assert.eq(c('div', 56, 7, 8, 44), 'sonstiges');
  assert.eq(parseQuestion('34 + 28'), { op: 'add', a: 34, b: 28 });
  assert.eq(parseQuestion('abc'), null);
});

test('Auswertung für Eltern: Übersicht, Fehlerarten, Verlauf, Export', () => {
  const mk = (n, start, status, firstOk, g) => ({ id: newId(), start, last: start, end: null, op: 'add', level: 2, mode: 'op', total: 50, processed: n, firstOk, secondOk: 0, failed: 0, helps: n - firstOk, open: 50 - n, status, tasks: [{ q: '34 + 28', a: 62, g, n: g.length, h: g.length > 1, ok: true, p: 'main', t: start }] });
  const rows = [mk(50, '2026-10-30T10:00:00Z', 'abgeschlossen', 40, [52, 62]), mk(20, '2026-10-31T10:00:00Z', 'unterbrochen', 10, [6, 63, 62]), mk(5, '2026-11-01T10:00:00Z', 'aktiv', 5, [62])].map((data) => ({ data }));
  const recs = toRecords(rows);
  assert.eq(recs.map((r) => r.status), ['aktiv', 'unterbrochen', 'abgeschlossen'], 'neueste zuerst');
  assert.eq(overview(recs), { sessions: 3, done: 1, open: 2, processed: 75, firstRate: 73, helps: 20 });
  assert.eq(errorTypes(recs).map((e) => e.kind).sort(), ['einerfehler', 'rechenzeichen', 'zehnerfehler']);
  assert.ok(errorTypes(recs).every((e) => e.count === 1));
  assert.eq(trend(recs).map((t) => t.pct), [80, 50], 'nur Einheiten ab 10 Aufgaben, älteste zuerst');
  assert.ok(weakSpots(recs)[0].rate === 73);
  const csv = toCsv(recs);
  assert.eq(csv.split('\n').length, 4);
  assert.ok(csv.includes('"34 + 28";"62";"52 / 62"'));
});

// ---------- Synchronisierung (gegen den Fake-Dienst des Testservers, echtes HTTP) ----------

const SB = { supabaseUrl: '/sb', anonKey: 'test-anon-key' };
const hdr = (t) => ({ apikey: SB.anonKey, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
const sbReset = () => fetch('/__sbreset');
const sbState = async () => (await fetch('/__sbstate')).json();
const parentToken = async (email = 'eltern@test.de', pw = 'geheim123') =>
  (await (await fetch('/sb/auth/v1/token?grant_type=password', { method: 'POST', headers: hdr(SB.anonKey), body: JSON.stringify({ email, password: pw }) })).json()).access_token;
const rpcRaw = (fn, body, token = SB.anonKey) => fetch(`/sb/rest/v1/rpc/${fn}`, { method: 'POST', headers: hdr(token), body: JSON.stringify(body) });
const newCode = async (who) => (await rpcRaw('create_pairing_code', {}, await parentToken(...(who || [])))).json();
const getRows = async (path, token) => fetch(`/sb/rest/v1/${path}`, { headers: hdr(token) });

function mkSync(extra = {}) {
  const storage = memStorage();
  const log = new LearningLog(storage);
  const timers = [];
  const sync = new Sync({ storage, log, config: SB, setTimer: (f, ms) => (timers.push({ f, ms }), timers.length), clearTimer: () => {}, ...extra });
  return { storage, log, sync, timers };
}
function addRec(log, n, rev = 1, status = 'unterbrochen') {
  const id = newId();
  log.put({ v: 1, id, rev, start: '2026-10-30T10:00:00.000Z', last: `2026-10-30T10:${String(n).padStart(2, '0')}:00.000Z`, end: null, op: 'add', level: 1, mode: 'op', total: 50, processed: n, firstOk: n, secondOk: 0, failed: 0, helps: 0, open: 50 - n, status, tasks: [] });
  return id;
}
const pairedSync = async (extra) => {
  const t = mkSync(extra);
  await t.sync.pair(await newCode());
  return t;
};

test('Sync: ohne Konfiguration/Kopplung bleibt alles lokal, keine Anfragen', async () => {
  await sbReset();
  const calls = [];
  const off = mkSync({ config: { supabaseUrl: '', anonKey: '' }, fetchFn: (...a) => (calls.push(a), Promise.reject(new Error('x'))) });
  addRec(off.log, 1);
  assert.eq(off.sync.status(), 'aus');
  assert.eq(await off.sync.syncNow(), false);
  const unpaired = mkSync({ fetchFn: (...a) => (calls.push(a), Promise.reject(new Error('x'))) });
  assert.eq(unpaired.sync.status(), 'ungekoppelt');
  assert.eq(await unpaired.sync.syncNow(), false);
  assert.eq(calls.length, 0);
});

test('Sync Kopplung: Einmalcode, falscher/abgelaufener/wiederverwendeter Code, Begrenzung der Versuche', async () => {
  await sbReset();
  const { sync, storage } = mkSync();
  const code = await newCode();
  assert.ok(/^[A-HJ-NP-Z2-9]{8}$/.test(code), 'Code-Format ' + code);
  await sync.pair(code.toLowerCase().slice(0, 4) + '-' + code.slice(4)); // Schreibweise egal
  assert.ok(sync.paired);
  assert.ok(JSON.parse(storage.getItem('mathe.sync.v1')).device.token.length >= 32);
  const again = mkSync();
  let err = null;
  await again.sync.pair(code).catch((e) => (err = e));
  assert.eq(err && err.status, 400, 'Code nur einmal verwendbar');
  assert.ok(!again.sync.paired);
  const code2 = await newCode();
  await fetch('/__sbexpire');
  err = null;
  await again.sync.pair(code2).catch((e) => (err = e));
  assert.eq(err && err.status, 400, 'abgelaufener Code');
  err = null;
  await again.sync.pair('ABC').catch((e) => (err = e));
  assert.ok(err && !err.status, 'zu kurzer Code wird lokal abgelehnt');
  for (let i = 0; i < 20; i++) await again.sync.pair('AAAAAAAA').catch(() => {});
  err = null;
  await again.sync.pair('BBBBBBBB').catch((e) => (err = e));
  assert.eq(err && err.status, 429, 'Probieren wird gebremst');
});

test('Sync: Übertragung ist idempotent – keine verlorenen oder doppelten Einträge', async () => {
  await sbReset();
  const { sync, log, storage } = await pairedSync();
  const ids = [addRec(log, 1), addRec(log, 2), addRec(log, 3)];
  assert.eq(sync.pending().length, 3);
  assert.eq(sync.status(), 'wartet');
  assert.ok(await sync.syncNow());
  let st = await sbState();
  assert.eq(st.sessions.length, 3);
  assert.eq(sync.pending().length, 0);
  assert.eq(sync.status(), 'synchron');
  assert.eq(log.list().length, 3, 'lokale Daten bleiben erhalten');
  const pushes = st.pushes;
  assert.ok(await sync.syncNow());
  assert.eq((await sbState()).pushes, pushes, 'nichts Neues → keine Anfrage');
  // Bestätigung ging „verloren“ (z. B. App-Absturz): erneutes Senden darf nichts duplizieren
  const reloaded = new Sync({ storage, log, config: SB });
  reloaded.state.acked = {};
  assert.ok(await reloaded.syncNow());
  st = await sbState();
  assert.eq(st.sessions.length, 3);
  assert.eq(st.sessions.map((s) => s.id).sort(), ids.slice().sort());
});

test('Sync: Änderungen an bereits übertragenen Einheiten werden aktualisiert, ältere Stände überschreiben nie', async () => {
  await sbReset();
  const { sync, log } = await pairedSync();
  const id = addRec(log, 5, 1, 'aktiv');
  await sync.syncNow();
  const r = log.get(id);
  log.put({ ...r, rev: 2, processed: 20, status: 'unterbrochen' });
  assert.eq(sync.pending().length, 1);
  await sync.syncNow();
  let st = await sbState();
  assert.eq([st.sessions.length, st.sessions[0].rev, st.sessions[0].data.processed], [1, 2, 20]);
  const token = sync.state.device.token;
  const res = await (await rpcRaw('sync_push', { p_token: token, p_sessions: [{ ...r, rev: 1, processed: 1 }] })).json();
  assert.eq(res.acked, [{ id, rev: 2 }], 'Server meldet den neueren Stand');
  st = await sbState();
  assert.eq(st.sessions[0].data.processed, 20, 'alter Stand überschreibt nichts');
});

test('Sync: Netzwerkausfall – Wiederholversuche mit Wartezeit, nichts geht verloren', async () => {
  await sbReset();
  const { sync, log, timers } = await pairedSync();
  addRec(log, 1);
  addRec(log, 2);
  await fetch('/__sbfail?n=2');
  timers.length = 0;
  assert.eq(await sync.syncNow(), false);
  assert.eq(sync.status(), 'fehler');
  assert.eq(timers.filter((t) => BACKOFF_MS.includes(t.ms)).map((t) => t.ms), [BACKOFF_MS[0]]);
  assert.eq(sync.pending().length, 2, 'unbestätigte Daten bleiben vorgemerkt');
  assert.eq(log.list().length, 2);
  assert.eq(await sync.syncNow(), false);
  assert.ok(timers.some((t) => t.ms === BACKOFF_MS[1]), 'Wartezeit wächst');
  assert.eq((await sbState()).sessions.length, 0);
  assert.eq(await sync.syncNow(), true, 'danach klappt es');
  assert.eq(sync.status(), 'synchron');
  assert.eq((await sbState()).sessions.length, 2, 'genau zwei, keine Dubletten');
  assert.eq(sync.failures, 0);
});

test('Sync: ohne Verbindung wird nicht gesendet; nach Wiederkehr nachträglich übertragen', async () => {
  await sbReset();
  let online = false;
  const { sync, log } = await pairedSync({ online: () => online });
  addRec(log, 1);
  assert.eq(await sync.syncNow(), false);
  assert.eq(sync.status(), 'offline');
  assert.eq((await sbState()).pushes, 0);
  online = true;
  assert.eq(await sync.syncNow(), true);
  assert.eq((await sbState()).sessions.length, 1);
});

test('Sync: parallele Aufrufe senden nur einmal; große Rückstände in Paketen', async () => {
  await sbReset();
  const { sync, log } = await pairedSync();
  for (let i = 0; i < 25; i++) addRec(log, i % 50);
  await Promise.all([sync.syncNow(), sync.syncNow(), sync.syncNow()]);
  const st = await sbState();
  assert.eq(st.sessions.length, 25);
  assert.eq(st.pushes, 3, '10 + 10 + 5');
});

test('Sync: nach Bestätigung werden nur alte, bestätigte Datensätze lokal entfernt', async () => {
  await sbReset();
  const { sync, log } = await pairedSync();
  for (let i = 0; i < 105; i++) addRec(log, i % 50);
  await sync.syncNow();
  assert.eq(log.ids().length, 100);
  assert.eq((await sbState()).sessions.length, 105, 'Server behält alle');
  const keep = addRec(log, 7, 1, 'aktiv');
  for (let i = 0; i < 3; i++) addRec(log, 1);
  sync.state.device = { token: 'x'.repeat(32), at: '' };
  await sync.syncNow(); // ungültiges Token → nichts bestätigt
  assert.ok(log.get(keep));
  assert.ok(log.ids().length >= 104, 'unbestätigte Daten bleiben');
});

test('Sync: aufgehobene Kopplung stoppt Wiederholungen, lokale Daten bleiben', async () => {
  await sbReset();
  const { sync, log, timers } = await pairedSync();
  addRec(log, 1);
  await sync.syncNow();
  const pt = await parentToken();
  const devs = await (await getRows('devices?select=id', pt)).json();
  await rpcRaw('revoke_device', { p_id: devs[0].id }, pt);
  addRec(log, 2);
  timers.length = 0;
  assert.eq(await sync.syncNow(), false);
  assert.eq(sync.status(), 'widerrufen');
  assert.eq(timers.filter((t) => BACKOFF_MS.includes(t.ms)).length, 0, 'keine Wiederholungen');
  assert.eq(log.list().length, 2);
  const pushes = (await sbState()).pushes;
  assert.eq(await sync.syncNow(), false);
  assert.eq((await sbState()).pushes, pushes, 'keine weiteren Anfragen');
});

test('Zugriffsschutz: anonym nichts lesbar, Geräte nur schreibend, Eltern nur eigene Daten', async () => {
  await sbReset();
  const { sync, log } = await pairedSync();
  addRec(log, 3);
  await sync.syncNow();
  const t1 = await parentToken();
  const t2 = await parentToken('andere@test.de', 'pw-other');
  assert.ok(t1 && t2 && t1 !== t2);
  assert.eq((await getRows('sessions?select=*', SB.anonKey)).status, 401, 'anon-Schlüssel liest keine Ergebnisse');
  assert.eq((await getRows('devices?select=*', SB.anonKey)).status, 401);
  assert.eq((await getRows('sessions?select=*', sync.state.device.token)).status, 401, 'Geräte-Token liest nichts');
  assert.eq((await fetch('/sb/rest/v1/sessions', { headers: { Authorization: `Bearer ${t1}` } })).status, 401, 'ohne API-Schlüssel');
  assert.eq((await (await getRows('sessions?select=*', t1)).json()).length, 1, 'Eltern sehen eigene Daten');
  assert.eq((await (await getRows('sessions?select=*', t2)).json()).length, 0, 'andere Eltern sehen nichts');
  assert.eq((await (await getRows('devices?select=*', t2)).json()).length, 0);
  assert.eq((await rpcRaw('create_pairing_code', {}, SB.anonKey)).status, 401, 'Code erzeugen nur mit Eltern-Anmeldung');
  assert.eq((await rpcRaw('delete_all_data', {})).status, 401, 'Löschen nur mit Eltern-Anmeldung');
  assert.eq((await rpcRaw('sync_push', { p_token: 'falsch', p_sessions: [] })).status, 401);
  assert.eq((await rpcRaw('sync_push', { p_token: sync.state.device.token, p_sessions: [{ id: 'x', rev: -1 }] })).status, 400, 'ungültige Daten abgelehnt');
  const dev2 = await (await getRows('devices?select=id', t1)).json();
  await rpcRaw('revoke_device', { p_id: dev2[0].id }, t2); // fremdes Gerät trennen: wirkungslos
  assert.eq((await sbState()).revoked, 0);
  assert.eq((await fetch('/sb/auth/v1/token?grant_type=password', { method: 'POST', headers: hdr(SB.anonKey), body: JSON.stringify({ email: 'eltern@test.de', password: 'falsch' }) })).status, 400);
});

test('Datenschutz: Löschen entfernt alle Lerndaten und trennt Geräte (kein Wiederhochladen)', async () => {
  await sbReset();
  const { sync, log } = await pairedSync();
  addRec(log, 3);
  await sync.syncNow();
  const pt = await parentToken();
  assert.eq((await rpcRaw('delete_all_data', {}, pt)).status, 204);
  const st = await sbState();
  assert.eq([st.sessions.length, st.revoked], [0, 1]);
  addRec(log, 4);
  assert.eq(await sync.syncNow(), false);
  assert.eq(sync.status(), 'widerrufen');
  assert.eq((await sbState()).sessions.length, 0, 'nichts wieder hochgeladen');
});
