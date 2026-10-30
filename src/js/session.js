// Ablauf einer Übungseinheit: bis zu zwei Versuche je Aufgabe, danach Lösung.
// Die Einheit besteht aus genau `tasks.length` bewerteten Aufgaben (Standard 50).
// Danach folgt eine unbewertete, gekennzeichnete Wiederholungsrunde mit den
// verfehlten Aufgaben (höchstens REVIEW_MAX). Der Zustand ist vollständig serialisierbar.
import { taskText } from './generator.js';

export const REVIEW_MAX = 10;

export function starsFor(firstTry, total) {
  const ratio = total ? firstTry / total : 0;
  return ratio >= 0.9 ? 3 : ratio >= 0.7 ? 2 : ratio >= 0.5 ? 1 : 0;
}

const isoNow = () => new Date().toISOString();

export class Session {
  constructor(tasks, { now = isoNow } = {}) {
    this.now = now;
    this.tasks = tasks.slice();
    this.queue = this.tasks.slice();
    this.phase = 'main'; // 'main' | 'review'
    this.pos = 0;
    this.status = this.queue.length ? 'asking' : 'done'; // asking | hint | solved | failed | done
    this.attempts = 0;
    this.given = []; // abgegebene Antworten der aktuellen Aufgabe
    this.results = []; // nur Hauptphase: { task, firstTry, failed }
    this.log = []; // je abgeschlossener Aufgabe (auch Wiederholung) ein Protokolleintrag
    this.reviewSolved = 0;
  }

  get current() {
    return this.status === 'done' ? null : this.queue[this.pos];
  }

  get progress() {
    return { n: this.pos + 1, total: this.queue.length, phase: this.phase };
  }

  get resolved() {
    return this.status === 'solved' || this.status === 'failed';
  }

  // Noch nicht erledigte Aufgaben der aktuellen Phase.
  get open() {
    if (this.status === 'done') return 0;
    return this.queue.length - this.pos - (this.resolved ? 1 : 0);
  }

  submit(value) {
    if (this.status !== 'asking' && this.status !== 'hint') return this.status;
    this.attempts += 1;
    this.given.push(value);
    if (value === this.current.answer) this.status = 'solved';
    else this.status = this.attempts === 1 ? 'hint' : 'failed';
    if (this.resolved) this._record();
    return this.status;
  }

  _record() {
    const task = this.current;
    const solved = this.status === 'solved';
    this.log.push({
      q: taskText(task),
      a: task.answer,
      g: this.given.slice(),
      n: this.attempts,
      h: this.attempts > 1, // Hilfestellung (Tipp bzw. Lösungsweg) war nötig
      ok: solved,
      p: this.phase,
      rep: !!task.repeat, // aus früheren Übungen wiederholte Aufgabe (zählt mit)
      t: this.now(),
    });
    if (this.phase === 'main') {
      this.results.push({ task, firstTry: solved && this.attempts === 1, failed: !solved });
    } else if (solved) {
      this.reviewSolved += 1;
    }
  }

  advance() {
    if (!this.resolved) return this.status;
    this.pos += 1;
    this.attempts = 0;
    this.given = [];
    if (this.pos >= this.queue.length) {
      const missed = this.results.filter((r) => !r.firstTry).map((r) => r.task);
      if (this.phase === 'main' && missed.length) {
        this.phase = 'review';
        this.queue = missed.slice(0, REVIEW_MAX);
        this.pos = 0;
      } else {
        this.status = 'done';
        return this.status;
      }
    }
    this.status = 'asking';
    return this.status;
  }

  summary() {
    const total = this.tasks.length;
    const firstTry = this.results.filter((r) => r.firstTry).length;
    const failed = this.results.filter((r) => r.failed).length;
    const later = this.results.length - firstTry - failed;
    return {
      total,
      processed: this.results.length,
      firstTry,
      failed,
      later,
      helps: this.log.filter((e) => e.p === 'main' && e.h).length,
      stars: starsFor(firstTry, total),
      missed: this.results.filter((r) => !r.firstTry).map((r) => r.task),
      results: this.results.slice(),
    };
  }

  toJSON() {
    const { tasks, queue, phase, pos, status, attempts, given, results, log, reviewSolved } = this;
    return { tasks, queue, phase, pos, status, attempts, given, results, log, reviewSolved };
  }

  static fromJSON(o, opts) {
    const okTask = (t) => t && typeof t.op === 'string' && Number.isInteger(t.a) && Number.isInteger(t.b) && Number.isInteger(t.answer);
    const arr = (x) => Array.isArray(x);
    if (!o || !arr(o.tasks) || !arr(o.queue) || !arr(o.results) || !arr(o.log) || !arr(o.given)) throw new Error('Ungültiger Übungsstand');
    if (!o.tasks.every(okTask) || !o.queue.every(okTask)) throw new Error('Ungültige Aufgaben');
    if (!['main', 'review'].includes(o.phase) || !['asking', 'hint', 'solved', 'failed', 'done'].includes(o.status)) throw new Error('Ungültiger Status');
    if (!Number.isInteger(o.pos) || o.pos < 0 || o.pos > o.queue.length) throw new Error('Ungültige Position');
    const s = new Session([], opts);
    Object.assign(s, {
      tasks: o.tasks,
      queue: o.queue,
      phase: o.phase,
      pos: o.pos,
      status: o.status,
      attempts: Number(o.attempts) || 0,
      given: o.given.filter(Number.isFinite),
      results: o.results,
      log: o.log,
      reviewSolved: Number(o.reviewSolved) || 0,
    });
    if (s.status !== 'done' && !s.current) throw new Error('Übungsstand unvollständig');
    return s;
  }
}
