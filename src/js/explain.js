// Rechenhilfen: kindgerechte Erklärung in kleinen Schritten.
// Jede Schrittzeile hat die Form "x ∘ y = z" (wird in den Tests nachgerechnet);
// Text in Klammern ist ein Zusatztipp.

const parts = (n) =>
  String(n)
    .split('')
    .map((d, i, arr) => Number(d) * 10 ** (arr.length - 1 - i))
    .filter((p) => p > 0);

function addStep(cur, p) {
  const next = cur + p;
  if (p < 10 && (cur % 10) + p > 10) {
    const fill = 10 - (cur % 10);
    return `${cur} + ${p} = ${next}  (erst ${cur} + ${fill} = ${cur + fill}, dann noch ${p - fill} dazu)`;
  }
  return `${cur} + ${p} = ${next}`;
}

function subStep(cur, p) {
  const next = cur - p;
  if (p < 10 && cur % 10 > 0 && cur % 10 < p) {
    const back = cur % 10;
    return `${cur} − ${p} = ${next}  (erst ${cur} − ${back} = ${cur - back}, dann noch ${p - back} weg)`;
  }
  return `${cur} − ${p} = ${next}`;
}

function explainAdd({ a, b, answer }) {
  const steps = [];
  let cur = a;
  for (const p of parts(b)) {
    steps.push(addStep(cur, p));
    cur += p;
  }
  return {
    hint: 'Tipp: Zerlege die zweite Zahl in Hunderter, Zehner und Einer und rechne Schritt für Schritt.',
    steps,
    result: `${a} + ${b} = ${answer}`,
  };
}

function explainSub({ a, b, answer }) {
  const steps = [];
  let cur = a;
  for (const p of parts(b)) {
    steps.push(subStep(cur, p));
    cur -= p;
  }
  return {
    hint: 'Tipp: Zerlege die zweite Zahl in Hunderter, Zehner und Einer und nimm sie Schritt für Schritt weg.',
    steps,
    result: `${a} − ${b} = ${answer}`,
  };
}

function explainMul({ a, b, answer }) {
  const result = `${a} · ${b} = ${answer}`;
  const hint = 'Tipp: Zerlege die Aufgabe in leichtere Teilaufgaben.';
  if (a === 10 || b === 10) {
    const other = a === 10 ? b : a;
    return {
      hint: 'Tipp: Mal 10 ist ganz leicht – hänge eine Null an.',
      steps: [`${other} · 10 = ${other * 10}  (eine Null anhängen)`],
      result,
    };
  }
  const big = Math.max(a, b);
  const small = Math.min(a, b);
  if (big <= 10) {
    if (small <= 5) {
      const sum = Array(small).fill(big).join(' + ');
      return { hint, steps: [`${sum} = ${answer}  (${small} mal die ${big})`], result };
    }
    const r = small - 5;
    return {
      hint,
      steps: [
        `Zerlege die ${small} in 5 und ${r}.`,
        `${big} · 5 = ${big * 5}`,
        `${big} · ${r} = ${big * r}`,
        `${big * 5} + ${big * r} = ${answer}`,
      ],
      result,
    };
  }
  // zweistellig mal einstellig
  const ps = parts(big);
  const steps = [`Zerlege die ${big} in ${ps.join(' und ')}.`];
  for (const p of ps) {
    steps.push(
      p % 10 === 0 && p > 10
        ? `${p} · ${small} = ${p * small}  (${p / 10} · ${small} = ${(p / 10) * small}, mal 10)`
        : `${p} · ${small} = ${p * small}`,
    );
  }
  if (ps.length > 1) steps.push(`${ps[0] * small} + ${ps[1] * small} = ${answer}`);
  return { hint, steps, result };
}

function explainDiv({ a, b, answer }) {
  const result = `${a} : ${b} = ${answer}`;
  const hint = `Tipp: Teilen ist die Umkehrung vom Malnehmen. Frage dich: Welche Zahl mal ${b} ergibt ${a}?`;
  const q10 = Math.floor(answer / 10) * 10;
  const first = q10 * b;
  const rest = a - first;
  if (answer <= 10 || rest === 0) {
    return {
      hint,
      steps: [`Malaufgabe: ? · ${b} = ${a}`, `${answer} · ${b} = ${a}`],
      result,
    };
  }
  return {
    hint,
    steps: [
      `Zerlege die ${a} in ${first} und ${rest}.`,
      `${first} : ${b} = ${q10}`,
      `${rest} : ${b} = ${answer - q10}`,
      `${q10} + ${answer - q10} = ${answer}`,
    ],
    result,
  };
}

export function explain(task) {
  return { add: explainAdd, sub: explainSub, mul: explainMul, div: explainDiv }[task.op](task);
}

const PRAISE = ['Super!', 'Richtig!', 'Toll gemacht!', 'Prima!', 'Klasse!', 'Genau so!'];
const TRY_AGAIN = ['Fast! Versuch es noch einmal.', 'Noch nicht ganz – du schaffst das!', 'Knapp daneben. Probier es nochmal!'];

export const praise = (i) => PRAISE[i % PRAISE.length];
export const tryAgain = (i) => TRY_AGAIN[i % TRY_AGAIN.length];
