// Aufgabengenerator (reine Funktionen, mit Seed testbar).
// Zahlenraum 3. Klasse: bis 100 bzw. bis 1000, kleines Einmaleins und Umkehrung.

export const OPS = ['add', 'sub', 'mul', 'div'];
export const LEVELS = [1, 2, 3];
export const SYMBOLS = { add: '+', sub: '−', mul: '·', div: ':' };

export function createRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, arr) => arr[int(rng, 0, arr.length - 1)];

export function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = int(rng, 0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function makeTask(op, a, b, level) {
  const answer = { add: a + b, sub: a - b, mul: a * b, div: a / b }[op];
  return { op, a, b, answer, level };
}

export const taskText = (t) => `${t.a} ${SYMBOLS[t.op]} ${t.b}`;
export const taskKey = (t) => `${t.op}|${t.a}|${t.b}`;

// Jeder Generator liefert [a, b].
const GEN = {
  add: {
    // bis 100, ohne Zehnerübergang
    1(rng) {
      const t1 = int(rng, 1, 8);
      const u1 = int(rng, 0, 8);
      const t2 = int(rng, 0, 9 - t1);
      const u2 = int(rng, 1, 9 - u1);
      return [t1 * 10 + u1, t2 * 10 + u2];
    },
    // bis 100, mit Zehnerübergang
    2(rng) {
      const t1 = int(rng, 1, 7);
      const u1 = int(rng, 1, 9);
      const t2 = int(rng, 0, 8 - t1);
      const u2 = int(rng, 10 - u1, 9);
      return [t1 * 10 + u1, t2 * 10 + u2];
    },
    // bis 1000
    3(rng) {
      const a = int(rng, 101, 899);
      const b = int(rng, 11, Math.min(999 - a, 899));
      return [a, b];
    },
  },
  sub: {
    // bis 100, ohne Zehnerübergang
    1(rng) {
      for (;;) {
        const t1 = int(rng, 1, 9);
        const u1 = int(rng, 0, 9);
        const t2 = int(rng, 0, t1);
        const u2 = int(rng, 0, u1);
        const a = t1 * 10 + u1;
        const b = t2 * 10 + u2;
        if (b >= 1 && b < a) return [a, b];
      }
    },
    // bis 100, mit Zehnerübergang
    2(rng) {
      const t1 = int(rng, 2, 9);
      const u1 = int(rng, 0, 8);
      const t2 = int(rng, 0, t1 - 1);
      const u2 = int(rng, u1 + 1, 9);
      return [t1 * 10 + u1, t2 * 10 + u2];
    },
    // bis 1000
    3(rng) {
      const a = int(rng, 200, 999);
      const b = int(rng, 11, a - 10);
      return [a, b];
    },
  },
  mul: {
    // Einmaleins mit 2, 5 und 10
    1(rng) {
      const f = pick(rng, [2, 5, 10]);
      const g = int(rng, 2, 10);
      return rng() < 0.5 ? [f, g] : [g, f];
    },
    // gesamtes kleines Einmaleins
    2(rng) {
      for (;;) {
        const a = int(rng, 2, 10);
        const b = int(rng, 2, 10);
        if ([a, b].some((x) => [3, 4, 6, 7, 8, 9].includes(x))) return [a, b];
      }
    },
    // zweistellig mal einstellig
    3(rng) {
      return [int(rng, 12, 30), int(rng, 3, 9)];
    },
  },
  div: {
    // Umkehrung von 2er-, 5er- und 10er-Reihe
    1(rng) {
      const d = pick(rng, [2, 5, 10]);
      return [d * int(rng, 2, 10), d];
    },
    // Umkehrung des kleinen Einmaleins
    2(rng) {
      const d = pick(rng, [3, 4, 6, 7, 8, 9]);
      return [d * int(rng, 2, 10), d];
    },
    // zweistellige Zahl durch einstellige Zahl, ohne Rest
    3(rng) {
      const d = int(rng, 3, 9);
      const q = int(rng, 11, Math.min(30, Math.floor(250 / d)));
      return [d * q, d];
    },
  },
};

export function generateTask(op, level, rng = Math.random) {
  const [a, b] = GEN[op][level](rng);
  return makeTask(op, a, b, level);
}

// Erzeugt `count` verschiedene Aufgaben. `extra` (z. B. Wiederholungsaufgaben)
// zählt mit und wird zufällig einsortiert. op = 'mix' mischt alle vier Rechenarten.
export function generateSet(op, level, count = 10, rng = Math.random, extra = []) {
  const tasks = extra.slice(0, count);
  const seen = new Set(tasks.map(taskKey));
  const need = count - tasks.length;
  const ops =
    op === 'mix'
      ? shuffle(rng, Array.from({ length: need }, (_, i) => OPS[i % OPS.length]))
      : Array(need).fill(op);
  for (const o of ops) {
    let t = generateTask(o, level, rng);
    for (let tries = 0; seen.has(taskKey(t)) && tries < 100; tries++) {
      t = generateTask(o, level, rng);
    }
    seen.add(taskKey(t));
    tasks.push(t);
  }
  return shuffle(rng, tasks);
}
