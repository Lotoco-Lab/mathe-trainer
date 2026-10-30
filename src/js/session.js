// Ablauf einer Übungseinheit: bis zu zwei Versuche je Aufgabe, danach Lösung.
// Aufgaben, die nicht im ersten Versuch richtig waren, werden am Ende einmal wiederholt.

export function starsFor(firstTry, total) {
  const ratio = total ? firstTry / total : 0;
  return ratio >= 0.9 ? 3 : ratio >= 0.7 ? 2 : ratio >= 0.5 ? 1 : 0;
}

export class Session {
  constructor(tasks) {
    this.tasks = tasks.slice();
    this.queue = this.tasks.slice();
    this.phase = 'main'; // 'main' | 'review'
    this.pos = 0;
    this.status = this.queue.length ? 'asking' : 'done'; // asking | hint | solved | failed | done
    this.attempts = 0;
    this.results = []; // nur Hauptphase: { task, firstTry, failed }
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

  submit(value) {
    if (this.status !== 'asking' && this.status !== 'hint') return this.status;
    this.attempts += 1;
    if (value === this.current.answer) this.status = 'solved';
    else this.status = this.attempts === 1 ? 'hint' : 'failed';
    if (this.resolved) this._record();
    return this.status;
  }

  _record() {
    const solved = this.status === 'solved';
    if (this.phase === 'main') {
      this.results.push({
        task: this.current,
        firstTry: solved && this.attempts === 1,
        failed: !solved,
      });
    } else if (solved) {
      this.reviewSolved += 1;
    }
  }

  advance() {
    if (!this.resolved) return this.status;
    this.pos += 1;
    this.attempts = 0;
    if (this.pos >= this.queue.length) {
      const missed = this.results.filter((r) => !r.firstTry).map((r) => r.task);
      if (this.phase === 'main' && missed.length) {
        this.phase = 'review';
        this.queue = missed;
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
    return {
      total,
      firstTry,
      failed,
      later: total - firstTry - failed,
      stars: starsFor(firstTry, total),
      missed: this.results.filter((r) => !r.firstTry).map((r) => r.task),
      results: this.results.slice(),
    };
  }
}
